/**
 * DS Context Intelligence - Main Plugin Code
 * Figma Plugin for Design System Quality Checks
 */

import { ComponentAnalyzer } from './component-analyzer';
import { SuggestionGenerator } from './suggestion-generator';
import { FixApplier } from './fix-applier';
import { ContextEvaluator } from './context-evaluator';
import {
  MaturityEngine,
  signalsFromVariable,
  signalsFromStyle,
  signalsFromComponent,
  type MaturityResult,
  type MCPEnrichmentInput,
  type NotionRuleComplianceInput,
} from './maturity-engine';
import { validateToken, validateStyle, getTokenTierLabel, type TokenInput, type StyleInput, type NamingViolation } from './ds-naming-validator';
import type { RulesConfig } from './rule-engine';
import type { ComponentAudit, ScanConfig, Issue } from './types';
import {
  buildReverseIndex,
  scoreToken,
  type ScoringWeights,
  type ReverseIndex,
  type ComponentLibraryJSON,
} from './token-scorer';
import { getDesktopBridge, startDesktopBridge } from './bridge';
import { runPipeline, rawInputFromAudits } from './ds-maturity-engine';
import {
  scoreDSContextMaturity,
  type DSVariable,
  type DSCollection,
  type DSStyle,
  type DSContextInput,
} from './ds-context-scorer';

// ── Setup Wizard (Foundation Onboarding) ─────────────────────────────────────
import {
  generateTonalPalette,
  generateShadeScale,
  applyFullConfiguration as wizardApplyFullConfig,
  readFontFamiliesFromCore,
  detectFileArchitecture,
  type WizardConfig,
} from './setup-wizard';
import {
  isBreakpointTypographyStyleName,
  snapshotTextStyle,
  getBreakpointTypographyTokenOptions,
  groupTypographyTokensByStyle,
  enrichBreakpointTextStyleSnapshots,
  resolveVariableValueDisplay,
  formatTypographicFloatDisplay,
} from './wizard-breakpoint-styles';

// ── RADD System Detector + Architecture Rules ────────────────────────────────
import { detectRADDSystem, systemLabel, type SystemInfo } from './system-detector';
import { runFoundationRules, type FigmaVarSlim, type FigmaCollectionSlim, type RuleViolation } from './foundation-rules';

// ── Foundations Onboarding Wizard ────────────────────────────────────────────
import type { OnboardingDraft, CommitProgress } from './onboarding/state/types';
import { loadDraft as onbLoadDraft, saveDraft as onbSaveDraft, clearDraft as onbClearDraft } from './onboarding/state/storage';
import { emptyDraft as onbEmptyDraft } from './onboarding/state/defaults';
import { autoPlace as onbAutoPlace, parseHexList as onbParseHexList } from './onboarding/lib/autoPlace';
import { generateMirrorSuggestions as onbMirrorSuggestions } from './onboarding/lib/mirrorSuggestions';
import { validateAll as onbValidateAll } from './onboarding/lib/validation';
import { runCommit as onbRunCommit } from './onboarding/commit/commitOrchestrator';

// ── Foundation Description Generator ─────────────────────────────────────────
import {
  generateFoundationDescriptions,
  generateFoundationDescription,
  validateDescription as validateFoundationDescription,
  buildRunReport,
  type FoundationVariable,
} from './generator/foundationDescriptionGenerator';

// ── Usage Description Generator ──────────────────────────────────────────────
import { buildVariableRegistry } from './scanner/variableRegistry';
import { walkDocument } from './scanner/documentWalker';
import { buildUsageProfiles } from './scanner/usageProfiler';
import { generateRuleBasedDescription } from './generator/ruleEngine';
import { shouldUseAI } from './generator/aiCandidates';
import { writeDescriptions } from './writer/descriptionWriter';
import { getCachedUsageScan, saveUsageScanCache } from './cache/clientStorage';
import type { ScanPayload, DescriptionCandidate } from './usage-types';

// Default rules: bundled sample-rules.json (used when clientStorage is empty or invalid)
import defaultRulesConfig from './sample-rules.json';

// ── Progressive Learning Layer ───────────────────────────────────────────────
import { StorageAdapter } from './learning/StorageAdapter';
import { KnowledgeBase } from './learning/KnowledgeBase';
import { PatternExtractor } from './learning/PatternExtractor';
import { RuleDeriver } from './learning/RuleDeriver';
import { ScoreAggregator } from './learning/ScoreAggregator';
import { LearningEngine } from './learning/LearningEngine';
import { ContextBuilder } from './learning/ContextBuilder';
import { AIAnalysisModule } from './learning/AIAnalysisModule';
import { FeedbackProcessor } from './learning/FeedbackProcessor';
import { SyncAdapter, DEFAULT_GITHUB_PATHS } from './learning/SyncAdapter';
import type { SyncConfig } from './learning/SyncAdapter';
import { DSKnowledgeSeeder } from './learning/DSKnowledgeSeeder';
import type { MCPKnowledgeResult } from './learning/types';

// ============================================================================
// Plugin Initialization
// ============================================================================

const PLUGIN_UI_WIDTH = 500;
const PLUGIN_UI_HEIGHT_MIN = 300;
const PLUGIN_UI_HEIGHT_MAX = 900;
const PLUGIN_UI_HEIGHT_DEFAULT = 750;

figma.showUI(__html__, {
  width: PLUGIN_UI_WIDTH,
  height: PLUGIN_UI_HEIGHT_DEFAULT,
  themeColors: true,
  title: 'DS Context Intelligence',
});

// Start embedded Desktop Bridge so MCP can run while the plugin is open
startDesktopBridge();

// Initialize modules
let componentAnalyzer: ComponentAnalyzer;
let suggestionGenerator: SuggestionGenerator | null = null;
let fixApplier: FixApplier | null = null;
const contextEvaluator = new ContextEvaluator();
const maturityEngine = new MaturityEngine();
let scanCancelled = false;

// ── Progressive Learning Layer — module initialization ───────────────────
const learningStorage = new StorageAdapter();
const knowledgeBase = new KnowledgeBase(learningStorage);
const learningEngine = new LearningEngine(
  new PatternExtractor(),
  new RuleDeriver(),
  new ScoreAggregator(),
  knowledgeBase
);
const contextBuilder = new ContextBuilder(knowledgeBase);
const aiAnalysisModule = new AIAnalysisModule(contextBuilder);
const feedbackProcessor = new FeedbackProcessor(knowledgeBase);
const dsKnowledgeSeeder = new DSKnowledgeSeeder();

// ── MCP Integration State ────────────────────────────────────────────────
let mcpConnected = false;
let mcpEndpoint = '';
let mcpEnrichRequestId = 0;
const mcpEnrichmentCache = new Map<string, any>();
const mcpPendingEnrichments = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

// ── Maturity Scoring State ────────────────────────────────────────────────
let currentRubric: ScoringWeights | null = null;
let reverseIndexCache: ReverseIndex | null = null;

// ── DS Context Maturity Cache (file-level scoring) ───────────────────────
let cachedDSVars: DSVariable[] | null = null;
let cachedDSCollections: DSCollection[] | null = null;
let cachedDSStyles: DSStyle[] | null = null;

/** Baked rules cache; invalidated when SAVE_BAKED_RULES is called. Used for context maturity. */
let cachedBakedRules: { pattern: string; meaning: string }[] | null = null;

/** When false, getBakedRules returns [] so baked rules are not used in scan. Set per RUN_SCAN. */
let includeContextRulesInScan = true;

async function getBakedRules(): Promise<{ pattern: string; meaning: string }[]> {
  if (!includeContextRulesInScan) return [];
  if (cachedBakedRules) return cachedBakedRules;
  const raw = await figma.clientStorage.getAsync('dsccBakedRules');
  const list = raw ? JSON.parse(raw) : [];
  cachedBakedRules = (Array.isArray(list) ? list : [])
    .map((r: { pattern?: string; meaning?: string }) => ({ pattern: r.pattern ?? '', meaning: r.meaning ?? '' }))
    .filter((r: { pattern: string; meaning: string }) => r.pattern || r.meaning);
  return cachedBakedRules;
}

// ── Notion Rule Integration State ────────────────────────────────────────
let notionEnrichedRules: any[] = [];
let notionComplianceRequestId = 0;
const notionPendingCompliance = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

/**
 * Request MCP enrichment from the UI layer (which has fetch access).
 * Posts a message to UI, UI queries MCP server, and posts results back.
 * Returns a map of entity names → enrichment data.
 */
async function requestMCPEnrichment(
  entities: Array<{ name: string; filePath?: string }>
): Promise<Record<string, any>> {
  if (!mcpConnected || entities.length === 0) return {};

  const requestId = 'mcp-enrich-' + (++mcpEnrichRequestId);

  return new Promise((resolve, reject) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      mcpPendingEnrichments.delete(requestId);
      resolve({}); // Don't block scan on MCP timeout
    }, 15000);

    mcpPendingEnrichments.set(requestId, {
      resolve: (val: any) => {
        clearTimeout(timeout);
        resolve(val);
      },
      reject: (err: any) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    // Ask UI to fetch from MCP
    figma.ui.postMessage({
      type: 'MCP_ENRICH_REQUEST',
      requestId,
      entities,
    });
  });
}

/**
 * Convert MCP enrichment data into the MCPEnrichmentInput format
 * expected by MaturityEngine.run().
 */
function toMCPEnrichmentInput(data: any): MCPEnrichmentInput | undefined {
  if (!data || typeof data !== 'object') return undefined;
  return {
    reliabilityScore: data.reliabilityScore || 0,
    extractedPurpose: data.extractedPurpose || null,
    purposeFromGit: data.purposeFromGit || false,
    purposeConfidence: data.purposeConfidence || 0,
    commitCount: Array.isArray(data.commits) ? data.commits.length : 0,
    dependencyCount: Array.isArray(data.dependencies) ? data.dependencies.length : 0,
  };
}

/**
 * Request Notion rule compliance verification from the UI layer.
 * The UI uses the MCP bridge to verify whether entities follow Notion rules.
 * Returns a map of entity names → NotionRuleComplianceInput.
 */
async function requestNotionCompliance(
  entities: Array<{ name: string; entityType: string; description: string; filePath?: string }>
): Promise<Record<string, NotionRuleComplianceInput>> {
  if (notionEnrichedRules.length === 0 || entities.length === 0) return {};

  const requestId = 'notion-comply-' + (++notionComplianceRequestId);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      notionPendingCompliance.delete(requestId);
      resolve({}); // Don't block scan on timeout
    }, 20000);

    notionPendingCompliance.set(requestId, {
      resolve: (val: any) => {
        clearTimeout(timeout);
        resolve(val);
      },
      reject: () => {
        clearTimeout(timeout);
        resolve({});
      },
    });

    figma.ui.postMessage({
      type: 'NOTION_VERIFY_COMPLIANCE',
      requestId,
      entities,
      activeFilePath: figma.root.name || '',
    });
  });
}

/**
 * Convert raw compliance data from UI into NotionRuleComplianceInput.
 */
function toNotionComplianceInput(data: any): NotionRuleComplianceInput | undefined {
  if (!data || typeof data !== 'object') return undefined;
  if (data.applicableRuleCount === 0) return undefined; // No rules applied
  return {
    complianceRatio: data.complianceRatio ?? 1.0,
    weightedPenalty: data.weightedPenalty ?? 0,
    violatedCount: data.violatedCount ?? 0,
    bestRationale: data.bestRationale || null,
  };
}

/**
 * Yield to the event loop so queued messages (e.g. CANCEL_SCAN) can be processed.
 * Without this, the single-threaded plugin runtime never processes incoming UI
 * messages while a long-running async scan is executing.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Minimal config so we never crash when rules are missing or invalid */
const EMPTY_RULES_CONFIG: RulesConfig = {
  meta: { version: '1.0', system: 'DS Context Intelligence' },
  rules: []
};

function ensureRulesConfig(raw: unknown): RulesConfig {
  if (raw && typeof raw === 'object' && 'meta' in raw && 'rules' in raw && Array.isArray((raw as RulesConfig).rules)) {
    return raw as RulesConfig;
  }
  return EMPTY_RULES_CONFIG;
}

// Load rules configuration (clientStorage first, then bundled sample-rules.json, then empty)
async function loadRulesConfig() {
  try {
    const rulesData = await figma.clientStorage.getAsync('rulesConfig');
    let rulesConfig: RulesConfig;

    if (rulesData && typeof rulesData === 'string') {
      try {
        rulesConfig = ensureRulesConfig(JSON.parse(rulesData));
      } catch {
        rulesConfig = ensureRulesConfig(defaultRulesConfig);
        console.warn('⚠️ Stored rules invalid, using bundled sample-rules.json');
      }
    } else {
      rulesConfig = ensureRulesConfig(defaultRulesConfig);
      if (rulesConfig.rules.length > 0) {
        console.log('✅ Using bundled sample-rules.json (no stored config)');
      }
    }

    componentAnalyzer = new ComponentAnalyzer(rulesConfig);
    suggestionGenerator = new SuggestionGenerator(rulesConfig);
    fixApplier = new FixApplier();
    return true;
  } catch (error: unknown) {
    console.error('Error loading rules config:', error);
    const fallback = ensureRulesConfig(defaultRulesConfig);
    componentAnalyzer = new ComponentAnalyzer(fallback);
    suggestionGenerator = new SuggestionGenerator(fallback);
    fixApplier = new FixApplier();
    return false;
  }
}

// Initialize on startup
loadRulesConfig().then(() => {
  // Send data to UI as soon as plugin is ready so the UI has something to work with
  setTimeout(() => {
    figma.ui.postMessage({
      type: 'INIT',
      data: { ready: true, source: 'launch' },
      currentSize: { width: PLUGIN_UI_WIDTH, height: PLUGIN_UI_HEIGHT_DEFAULT },
    });
  }, 0);
});

// Load rubric: try cache first (24 h TTL), then remote, then fall back to null (uses defaults)
figma.clientStorage.getAsync('cachedRubric').then((cachedRubric: string | undefined) => {
  return figma.clientStorage.getAsync('cachedRubricTs').then((cachedTs: string | undefined) => {
    const now = Date.now();
    const tsNum = cachedTs ? parseInt(cachedTs, 10) : 0;
    if (cachedRubric && (now - tsNum) < 86400000) {
      try {
        currentRubric = JSON.parse(cachedRubric).weights as ScoringWeights;
      } catch (_e) { /* leave null — scoreToken uses built-in defaults */ }
    } else {
      fetch('https://raw.githubusercontent.com/PLACEHOLDER/main/rubrics/token-rubric.json')
        .then(r => r.json())
        .then((data: { weights: ScoringWeights }) => {
          currentRubric = data.weights;
          figma.clientStorage.setAsync('cachedRubric', JSON.stringify(data)).catch(() => {});
          figma.clientStorage.setAsync('cachedRubricTs', String(Date.now())).catch(() => {});
        })
        .catch(() => { currentRubric = null; });
    }
  });
}).catch(() => { currentRubric = null; });

// ============================================================================
// TOKEN EXPORT — helper functions (ported from JSON Exporter plugin)
// ============================================================================

function _jex_stripIcons(name: string): string {
  if (!name) return name;
  return name.replace(/\p{Extended_Pictographic}/gu, '').replace(/[\u{FE00}-\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
}

function _jex_normalizeVariableName(name: string, collectionName: string): string {
  if (!name) return '';
  let normalized = name.replace(/^(Light|Dark)\//i, '');
  if (collectionName && collectionName.startsWith('.')) {
    const base = collectionName.substring(1);
    normalized = normalized.replace(new RegExp('^' + base + '/', 'i'), '');
  }
  return normalized;
}

function _jex_pathToNestedObject(path: string, value: any): any {
  if (!path) return {};
  const parts = path.split('/').filter(p => p.length > 0);
  const result: any = {};
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = current[parts[i]] || {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return result;
}

function _jex_deepMerge(target: any, source: any): void {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      _jex_deepMerge(target[key], source[key]);
    } else { target[key] = source[key]; }
  }
}

function _jex_formatValue(value: any, type: string): any {
  if (type === 'COLOR' && value && typeof value === 'object' && value.r !== undefined) {
    const r = Math.round(value.r * 255), g = Math.round(value.g * 255), b = Math.round(value.b * 255);
    const a = value.a !== undefined ? value.a : 1;
    return a === 1
      ? '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
      : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + parseFloat(a.toFixed(2)) + ')';
  }
  return value;
}

function _jex_findParentCollection(collections: any[], modeCollectionName: string): string | null {
  const candidates: string[] = [];
  collections.forEach(col => {
    if (col.name === modeCollectionName) return;
    const hasBaseModes = col.modes.some((mode: any) => !mode.parentModeId);
    if (hasBaseModes) {
      if (col.name.match(/Schemes|Neutral/i)) candidates.unshift(_jex_stripIcons(col.name));
      else candidates.push(_jex_stripIcons(col.name));
    }
  });
  return candidates.length > 0 ? candidates[0] : null;
}

function _jex_buildAliasPath(aliasedVar: any, aliasedVarCollection: string | null, currentCollectionName: string, collections: any[]): string {
  if (!aliasedVar) return '';
  let normalized = aliasedVar.name.replace(/^(Light|Dark|light|dark)\//i, '');
  if (normalized.match(/^(core-colours|dimension|shadow-colours|shadows)\//)) {
    return normalized.replace(/\//g, '.');
  }
  if (currentCollectionName === '.mode') {
    const parentName = _jex_findParentCollection(collections, currentCollectionName);
    if (parentName) return parentName + '.' + normalized.replace(/\//g, '.');
    return normalized.replace(/\//g, '.');
  }
  if (aliasedVarCollection && aliasedVarCollection.startsWith('.')) {
    const baseName = aliasedVarCollection.substring(1);
    normalized = normalized.replace(new RegExp('^' + baseName + '/', 'i'), '');
    return baseName + '.' + normalized.replace(/\//g, '.');
  }
  return normalized.replace(/\//g, '.');
}

async function _jex_resolveAliasChainValue(initialValue: any): Promise<any> {
  let currentVal = initialValue;
  let maxDepth = 16;
  const seen = new Set<string>();
  while (currentVal && currentVal.type === 'VARIABLE_ALIAS' && maxDepth-- > 0) {
    const aliasId = (currentVal as { id?: string }).id;
    if (!aliasId || seen.has(aliasId)) return null;
    seen.add(aliasId);
    const nextVar = await figma.variables.getVariableByIdAsync(aliasId);
    if (!nextVar) return null;
    const nextModes = Object.keys(nextVar.valuesByMode || {});
    if (nextModes.length === 0) return null;
    currentVal = (nextVar.valuesByMode as Record<string, any>)[nextModes[0]] ?? null;
  }
  return currentVal;
}

async function _jex_extractCollectionsForUI(): Promise<any[]> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  const variableIdToCollection = new Map<string, string>();
  collections.forEach(col => {
    col.variableIds.forEach(vid => variableIdToCollection.set(vid, _jex_stripIcons(col.name)));
  });

  const sampleVarId = collections[0]?.variableIds[0];
  let hasAsyncMethod = false;
  if (sampleVarId) {
    const v = await figma.variables.getVariableByIdAsync(sampleVarId);
    hasAsyncMethod = !!(v && typeof (v as any).valuesByModeForCollectionAsync === 'function');
  }

  const colResults = await Promise.all(collections.map(async col => {
    const isExtended = !!(col as any).isExtension || !!(col as any).parentVariableCollectionId || !!(col as any).rootVariableCollectionId;
    const varPairs: { variable: Variable; collectionValues: Record<string, any> }[] = [];

    await Promise.all(col.variableIds.map(async vid => {
      const variable = await figma.variables.getVariableByIdAsync(vid);
      if (!variable) return;
      let collectionValues: Record<string, any>;
      if (isExtended && hasAsyncMethod) {
        collectionValues = await (variable as any).valuesByModeForCollectionAsync(col);
      } else if (isExtended && (col as any).variableOverrides) {
        const overridesForVar = (col as any).variableOverrides[variable.id];
        const merged: Record<string, any> = {};
        col.modes.forEach(mode => {
          const parentValues = variable.valuesByMode as Record<string, any>;
          if ((mode as any).parentModeId && overridesForVar?.[mode.modeId] !== undefined) {
            merged[mode.modeId] = overridesForVar[mode.modeId];
          } else if ((mode as any).parentModeId && parentValues[(mode as any).parentModeId] !== undefined) {
            merged[mode.modeId] = parentValues[(mode as any).parentModeId];
          }
        });
        collectionValues = merged;
      } else {
        collectionValues = variable.valuesByMode as Record<string, any>;
      }
      varPairs.push({ variable, collectionValues });
    }));

    const variables: any[] = [];
    const resolvePromises: Promise<void>[] = [];

    varPairs.forEach(pair => {
      const valuesByMode: Record<string, any> = {};
      const resolvedValuesByMode: Record<string, any> = {};
      const aliasInfo: Record<string, any> = {};

      Object.entries(pair.collectionValues).forEach(([mId, val]: [string, any]) => {
        valuesByMode[mId] = val;
        if (val && val.type === 'VARIABLE_ALIAS') {
          resolvePromises.push(
            figma.variables.getVariableByIdAsync(val.id).then(async aliasedVar => {
              if (aliasedVar) {
                const aliasedVarCollection = variableIdToCollection.get(aliasedVar.id);
                const aliasPath = _jex_buildAliasPath(aliasedVar, aliasedVarCollection || null, col.name, collections as any[]);
                aliasInfo[mId] = { isAlias: true, aliasPath, aliasedVarId: aliasedVar.id, aliasedVarCollection };
              }
              resolvedValuesByMode[mId] = await _jex_resolveAliasChainValue(val);
            })
          );
        } else {
          resolvedValuesByMode[mId] = val;
        }
      });

      variables.push({
        id: pair.variable.id,
        name: pair.variable.name,
        type: pair.variable.resolvedType,
        valuesByMode,
        resolvedValuesByMode,
        aliasInfo,
        codeSyntax: (pair.variable as any).codeSyntax ?? {}
      });
    });

    await Promise.all(resolvePromises);
    return { name: col.name, modes: col.modes, variables };
  }));

  return colResults;
}

function _jex_transformToFinalFormat(rawData: any): { tokens: any; count: number } {
  const output: any = {};
  let tokenCounter = 0;
  const modeMap = new Map<string, { name: string; collectionName: string; parentModeId: any }>();

  rawData.collections.forEach((col: any) => {
    col.modes.forEach((mode: any) => {
      modeMap.set(mode.modeId, {
        name: _jex_stripIcons(mode.name),
        collectionName: _jex_stripIcons(col.name),
        parentModeId: mode.parentModeId
      });
    });
  });

  // Build dot-path → variable lookup for codeSyntax resolution
  const variableMap: Record<string, any> = {};
  rawData.collections.forEach((c: any) => {
    c.variables.forEach((v: any) => {
      if (!v.name) return;
      let normalized = v.name.replace(/^(Light|Dark|light|dark)\//i, '');
      let exportPath: string;
      if (normalized.match(/^(core-colours|dimension|shadow-colours|shadows)\//)) {
        exportPath = normalized.replace(/\//g, '.');
      } else if (c.name.startsWith('.')) {
        const baseName = c.name.substring(1);
        normalized = normalized.replace(new RegExp('^' + baseName + '/', 'i'), '');
        exportPath = baseName + '.' + normalized.replace(/\//g, '.');
      } else {
        exportPath = normalized.replace(/\//g, '.');
      }
      variableMap[exportPath] = v;
    });
  });

  rawData.collections.forEach((c: any) => {
    c.variables.forEach((v: any) => {
      if (!v.name || !v.type) return;
      const tokenPath = _jex_normalizeVariableName(v.name, c.name);
      const vType = v.type.toLowerCase();
      const finalType = vType === 'float' ? 'number' : vType;
      const isTypography = /^typography\//i.test(tokenPath);
      let typographyWritten = false;

      Object.entries(v.valuesByMode).forEach(([modeId, _]: [string, any]) => {
        const mInfo = modeMap.get(modeId);
        if (!mInfo) return;
        if (isTypography) { if (typographyWritten) return; typographyWritten = true; }

        if (!output[mInfo.collectionName]) output[mInfo.collectionName] = {};
        if (!isTypography && !output[mInfo.collectionName][mInfo.name]) output[mInfo.collectionName][mInfo.name] = {};

        const resolvedVal = v.resolvedValuesByMode[modeId];
        const aliasData = v.aliasInfo && v.aliasInfo[modeId];
        let tokenValue: any;
        if (aliasData && aliasData.isAlias) {
          tokenValue = '{' + aliasData.aliasPath + '}';
        } else {
          tokenValue = _jex_formatValue(resolvedVal, v.type);
        }

        const token: any = { type: finalType, value: tokenValue };
        const csKeys = v.codeSyntax ? Object.keys(v.codeSyntax) : [];
        if (csKeys.length > 0) token.codeSyntax = v.codeSyntax;
        if (!token.codeSyntax && typeof tokenValue === 'string' && tokenValue.charAt(0) === '{' && tokenValue.charAt(tokenValue.length - 1) === '}') {
          const sourcePath = tokenValue.slice(1, -1);
          const sourceVar = variableMap[sourcePath];
          if (sourceVar?.codeSyntax && Object.keys(sourceVar.codeSyntax).length > 0) token.codeSyntax = sourceVar.codeSyntax;
        }

        const dest = isTypography ? output[mInfo.collectionName] : output[mInfo.collectionName][mInfo.name];
        _jex_deepMerge(dest, _jex_pathToNestedObject(tokenPath, token));
        tokenCounter++;
      });
    });
  });

  return { tokens: output, count: tokenCounter };
}

// ============================================================================
// TOKEN EXPORT — Token Studio format transformer (ported from JSON Exporter)
// ============================================================================

function _jex_normalizeFontWeightLiteral(v: any): any {
  const FONT_WEIGHT_NAME_TO_NUM: Record<string, string> = {
    thin:'100', extralight:'200', ultralight:'200', light:'300', regular:'400', normal:'400',
    medium:'500', semibold:'600', demibold:'600', bold:'700', extrabold:'800', black:'900', heavy:'900'
  };
  if (v === undefined || v === null) return v;
  if (typeof v === 'number' && !isNaN(v)) return String(Math.round(v));
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return String(Math.round(parseFloat(t)));
  const compact = t.replace(/\s+/g, '').toLowerCase();
  if (FONT_WEIGHT_NAME_TO_NUM[compact] !== undefined) return FONT_WEIGHT_NAME_TO_NUM[compact];
  const alpha = t.replace(/[^a-zA-Z]/g, '').toLowerCase();
  if (alpha && FONT_WEIGHT_NAME_TO_NUM[alpha] !== undefined) return FONT_WEIGHT_NAME_TO_NUM[alpha];
  return v;
}

function _jex_formatFloatForExport(value: number): string {
  if (typeof value !== 'number' || isNaN(value)) return String(value);
  const rounded = Math.round(value * 100000) / 100000;
  let s = rounded.toString();
  if (s.indexOf('e') !== -1 || s === 'NaN') s = String(+parseFloat(value.toPrecision(12)));
  return s;
}

function _jex_normalizeFontFamilyAliasSegments(str: string): string {
  return str
    .replace(/\{font-family\.([^}]+)\}/gi, (_: string, seg: string) => '{font-family.' + seg.toLowerCase() + '}')
    .replace(/\{fontFamilies\.([^}]+)\}/gi, (_: string, seg: string) => '{fontFamilies.' + seg.toLowerCase() + '}');
}

function _jex_fixAliasPaths(obj: any): any {
  if (typeof obj === 'string') {
    const s = obj.replace(/\{\.core\./g, '{').replace(/\{core\./g, '{');
    return _jex_normalizeFontFamilyAliasSegments(s);
  }
  if (Array.isArray(obj)) return obj;
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const k of Object.keys(obj)) result[k] = _jex_fixAliasPaths(obj[k]);
    return result;
  }
  return obj;
}

function _jex_fixKeyOrder(obj: any): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (Object.prototype.hasOwnProperty.call(obj, 'value') && Object.prototype.hasOwnProperty.call(obj, 'type')) {
    const r: any = { value: obj.value, type: obj.type };
    for (const k of Object.keys(obj)) if (k !== 'value' && k !== 'type') r[k] = obj[k];
    return r;
  }
  const result: any = {};
  for (const k of Object.keys(obj)) result[k] = _jex_fixKeyOrder(obj[k]);
  return result;
}

function _jex_getFoundationTokenType(pathParts: string[]): string | null {
  const first = pathParts[0];
  if (first === 'spacing') return 'spacing';
  if (first === 'sizing') return 'sizing';
  if (first === 'radius') return 'borderRadius';
  if (first === 'strokes') return 'sizing';
  if (first === 'colours') return 'color';
  if (pathParts.some(p => p.indexOf('colour') !== -1)) return 'color';
  return null;
}

function _jex_fixFoundationTokens(obj: any, pathParts: string[] = []): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (Object.prototype.hasOwnProperty.call(obj, 'value') && Object.prototype.hasOwnProperty.call(obj, 'type')) {
    let tokenType = _jex_getFoundationTokenType(pathParts) || obj.type;
    let tokenValue = obj.value;
    if (pathParts[0] === 'radius' && tokenValue === 999) tokenValue = '999';
    const r: any = { value: tokenValue, type: tokenType };
    for (const k of Object.keys(obj)) if (k !== 'value' && k !== 'type') r[k] = obj[k];
    return r;
  }
  const out: any = {};
  for (const k of Object.keys(obj)) out[k] = _jex_fixFoundationTokens(obj[k], [...pathParts, k]);
  return out;
}

function _jex_fixCoreTokens(obj: any, pathParts: string[] = []): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (Object.prototype.hasOwnProperty.call(obj, 'value') && Object.prototype.hasOwnProperty.call(obj, 'type')) {
    const first = pathParts[0];
    let cType = obj.type;
    let cValue = obj.value;
    if (first === 'dimension') { cType = 'dimension'; cValue = typeof cValue === 'number' ? _jex_formatFloatForExport(cValue) : String(cValue); }
    else if (first === 'letterSpacing') cType = 'letterSpacing';
    else if (first === 'letter-spacing') cType = 'number';
    else if (first === 'lineHeights') cType = 'lineHeights';
    else if (first === 'line-heights') cType = 'number';
    else if (first === 'textCase' || first === 'text-case') cType = 'textCase';
    else if (first === 'textDecoration' || first === 'text-decoration') cType = 'textDecoration';
    else if (first === 'fontFamilies') cType = 'fontFamilies';
    else if (first === 'font-family') cType = 'text';
    else if (first === 'fontSize') cType = 'fontSizes';
    else if (first === 'font-sizes') cType = 'number';
    else if (first === 'fontWeights') cType = 'fontWeights';
    else if (first === 'font-weights') cType = 'number';
    else if (first === 'paragraphSpacing') cType = 'paragraphSpacing';
    else if (first === 'paragraph-spacing') cType = 'number';
    else if (first === 'paragraphIndent') cType = 'paragraphIndent';
    else if (first === 'paragraph-indents') cType = 'number';
    else if (first && first.startsWith('viewport-')) cType = 'sizing';
    if (first === 'font-weights' && cValue !== undefined && cValue !== null) cValue = _jex_normalizeFontWeightLiteral(cValue);
    if (cType === 'number' && typeof cValue === 'number') cValue = _jex_formatFloatForExport(cValue);
    else if (cType === 'number' && typeof cValue === 'string' && /^-?\d+\.\d+$/.test(String(cValue).trim())) {
      const cn = parseFloat(cValue); if (!isNaN(cn)) cValue = _jex_formatFloatForExport(cn);
    }
    const res: any = { value: cValue, type: cType };
    for (const k of Object.keys(obj)) if (k !== 'value' && k !== 'type') res[k] = obj[k];
    return res;
  }
  const out: any = {};
  for (const k of Object.keys(obj)) {
    let outKey = k;
    if (pathParts.length === 1 && (pathParts[0] === 'font-family' || pathParts[0] === 'fontFamilies')) outKey = k.toLowerCase();
    out[outKey] = _jex_fixCoreTokens(obj[k], [...pathParts, k]);
  }
  return out;
}

function _jex_fixBreakpointTypes(obj: any, pathParts: string[] = []): any {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  if (Object.prototype.hasOwnProperty.call(obj, 'value') && Object.prototype.hasOwnProperty.call(obj, 'type')) {
    const first = pathParts[0];
    let t = obj.type, v = obj.value;
    if (first === 'spacing') t = 'spacing';
    else if (first === 'sizing') t = 'sizing';
    else if (t === 'string') t = 'text';
    const lastSeg = pathParts[pathParts.length - 1];
    if (lastSeg === 'weight' || first === 'font-weights' || first === 'fontWeights') { v = _jex_normalizeFontWeightLiteral(v); t = 'number'; }
    if (t === 'number' && typeof v === 'number') v = _jex_formatFloatForExport(v);
    return { value: v, type: t };
  }
  const result: any = {};
  for (const k of Object.keys(obj)) result[k] = _jex_fixBreakpointTypes(obj[k], [...pathParts, k]);
  return result;
}

function _jex_addTypographyComposite(scaleObj: any, scaleName: string): any {
  if (!scaleObj || typeof scaleObj !== 'object') return scaleObj;
  const cv: any = {};
  const addProp = (cvKey: string, scaleKey: string) => {
    const prop = scaleObj[scaleKey];
    if (prop && prop.value !== undefined) {
      const pv = prop.value;
      cv[cvKey] = typeof pv === 'number' ? _jex_formatFloatForExport(pv) : String(pv);
    }
  };
  addProp('fontFamily', 'font-family');
  addProp('fontWeight', 'weight');
  addProp('lineHeight', 'line-height');
  addProp('fontSize', 'size');
  addProp('letterSpacing', 'letter-spacing');
  addProp('paragraphSpacing', 'paragraph-spacing');
  addProp('paragraphIndent', 'paragraph-indent');
  if (cv.fontWeight !== undefined) cv.fontWeight = _jex_normalizeFontWeightLiteral(cv.fontWeight);
  cv.textCase = '{textCase.none}';
  cv.textDecoration = '{textDecoration.none}';
  const rebuilt: any = {};
  rebuilt[scaleName] = { value: cv, type: 'typography' };
  for (const propKey of ['size','line-height','weight','letter-spacing','font-family','paragraph-spacing','paragraph-indent','text-case','text-decoration']) {
    if (scaleObj[propKey]) rebuilt[propKey] = scaleObj[propKey];
  }
  if (!rebuilt['text-case'] && scaleObj.textCase) rebuilt['text-case'] = scaleObj.textCase;
  if (!rebuilt['text-decoration'] && scaleObj.textDecoration) rebuilt['text-decoration'] = scaleObj.textDecoration;
  if (rebuilt.weight && rebuilt.weight.value !== undefined) rebuilt.weight = { value: _jex_normalizeFontWeightLiteral(rebuilt.weight.value), type: 'number' };
  if (!rebuilt['font-family'] && cv.fontFamily) rebuilt['font-family'] = { value: cv.fontFamily, type: 'text' };
  if (!rebuilt['paragraph-spacing'] && cv.paragraphSpacing) rebuilt['paragraph-spacing'] = { value: cv.paragraphSpacing, type: 'number' };
  if (!rebuilt['paragraph-indent'] && cv.paragraphIndent) rebuilt['paragraph-indent'] = { value: cv.paragraphIndent, type: 'number' };
  if (!rebuilt['text-case']) rebuilt['text-case'] = { value: '{textCase.none}', type: 'textCase' };
  if (!rebuilt['text-decoration']) rebuilt['text-decoration'] = { value: '{textDecoration.none}', type: 'textDecoration' };
  return rebuilt;
}

function _jex_fixBreakpointTypography(typObj: any): any {
  if (!typObj || typeof typObj !== 'object') return typObj;
  const result: any = {};
  for (const scaleName of Object.keys(typObj)) result[scaleName] = _jex_addTypographyComposite(typObj[scaleName], scaleName);
  return result;
}

function _jex_buildElevationComposite(aliasBase: string): any {
  return { value: { color: '{' + aliasBase + '.colour}', type: 'dropShadow', x: '{' + aliasBase + '.x}', y: '{' + aliasBase + '.y}', blur: '{' + aliasBase + '.blur}', spread: '{' + aliasBase + '.spread}' }, type: 'boxShadow' };
}

function _jex_addElevationComposites(elevationObj: any, elevPrefix: string): any {
  elevPrefix = elevPrefix || 'scheme.elevation';
  for (const level of ['level-0','level-1','level-2','level-3','level-4','level-5','level-6']) {
    if (!elevationObj[level]) continue;
    const composite = _jex_buildElevationComposite(elevPrefix + '.' + level);
    const rebuilt: any = {};
    rebuilt[level] = composite;
    for (const k of Object.keys(elevationObj[level])) if (k !== level) rebuilt[k] = elevationObj[level][k];
    elevationObj[level] = rebuilt;
  }
  for (const entry of ['app-bar-top','app-bar-bottom']) {
    if (!elevationObj[entry]) continue;
    for (const variant of ['flat','raised']) {
      if (!elevationObj[entry][variant]) continue;
      const composite = _jex_buildElevationComposite(elevPrefix + '.' + entry + '.' + variant);
      const rebuilt: any = {}; rebuilt[variant] = composite;
      for (const k of Object.keys(elevationObj[entry][variant])) if (k !== variant) rebuilt[k] = elevationObj[entry][variant][k];
      elevationObj[entry][variant] = rebuilt;
    }
  }
  if (elevationObj['FAB']) {
    for (const variant of ['standard','hovered','pressed']) {
      if (!elevationObj['FAB'][variant]) continue;
      const composite = _jex_buildElevationComposite(elevPrefix + '.FAB.' + variant);
      const rebuilt: any = {}; rebuilt[variant] = composite;
      for (const k of Object.keys(elevationObj['FAB'][variant])) if (k !== variant) rebuilt[k] = elevationObj['FAB'][variant][k];
      elevationObj['FAB'][variant] = rebuilt;
    }
  }
  return elevationObj;
}

function _jex_applyElevationIfPresent(obj: any, elevPrefix: string): any {
  if (!obj || typeof obj !== 'object' || !obj.elevation) return obj;
  const result: any = {};
  for (const k of Object.keys(obj)) result[k] = obj[k];
  result.elevation = _jex_addElevationComposites(result.elevation, elevPrefix);
  return result;
}

function _jex_applyDimensionBaseExpressions(core: any): any {
  if (!core || !core.dimension || !core.dimension.base) return core;
  const baseTok = core.dimension.base;
  const baseVal = parseFloat(String(baseTok.value));
  if (isNaN(baseVal) || baseVal === 0) return core;
  for (const k of Object.keys(core.dimension)) {
    if (k === 'base' || k === '0') continue;
    const tok = core.dimension[k];
    if (!tok || tok.type !== 'dimension') continue;
    const num = parseFloat(String(tok.value));
    if (isNaN(num)) continue;
    const mult = num / baseVal;
    const rounded = Math.round(mult);
    if (Math.abs(mult - rounded) < 1e-6) tok.value = rounded + '*{dimension.base}';
  }
  return core;
}

function _jex_ensureCoreTextCaseAndDecoration(core: any): any {
  if (!core || typeof core !== 'object') return core;
  if (!core.textCase) core.textCase = {};
  if (!core.textCase.none) core.textCase.none = { value: 'none', type: 'textCase' };
  if (!core.textDecoration) core.textDecoration = {};
  if (!core.textDecoration.none) core.textDecoration.none = { value: 'none', type: 'textDecoration' };
  return core;
}

const _NATO_TS_DEFAULT_LINE_HEIGHTS: Record<string, any> = {
  '0': { value: '100%', type: 'lineHeights' }, '1': { value: '130%', type: 'lineHeights' },
  '2': { value: '120%', type: 'lineHeights' }, '3': { value: '125%', type: 'lineHeights' }
};
const _NATO_LINE_HEIGHT_KEBAB_TO_SEMANTIC: Record<string, string> = { '100':'0', '130':'1', '120':'2', '125':'3' };
const _NATO_TS_DEFAULT_LETTER_SPACING: Record<string, any> = {
  '0': { value: '-5%', type: 'letterSpacing' }, '1': { value: '-4%', type: 'letterSpacing' },
  '2': { value: '-3%', type: 'letterSpacing' }, '3': { value: '-2.5%', type: 'letterSpacing' },
  '4': { value: '-2%', type: 'letterSpacing' }, '5': { value: '-0.5%', type: 'letterSpacing' },
  '6': { value: '-1%', type: 'letterSpacing' }, '7': { value: '0%', type: 'letterSpacing' },
  '8': { value: '0.5%', type: 'letterSpacing' }
};

function _jex_coerceToPercent(raw: any): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (/%$/.test(s)) return s;
  const n = parseFloat(s.replace(/,/g, '.'));
  if (isNaN(n)) return s;
  return n + '%';
}

function _jex_ensureCoreLineHeightsLetterSpacing(core: any): any {
  if (!core || typeof core !== 'object') return core;
  const lhExisting = core.lineHeights;
  const hasLh0123 = lhExisting && typeof lhExisting === 'object' && lhExisting['0'] && lhExisting['1'] && lhExisting['2'] && lhExisting['3'];
  if (!hasLh0123) {
    const kebab = core['line-heights'];
    const partial: any = {};
    if (kebab && typeof kebab === 'object') {
      for (const multKey of Object.keys(kebab)) {
        const sem = _NATO_LINE_HEIGHT_KEBAB_TO_SEMANTIC[multKey];
        if (sem === undefined) continue;
        const tok = kebab[multKey];
        if (!tok || tok.value === undefined) continue;
        const pct = _jex_coerceToPercent(tok.value);
        if (pct) partial[sem] = { value: pct, type: 'lineHeights' };
      }
    }
    const out: any = {};
    for (const k of ['0','1','2','3']) {
      if (partial[k] && partial[k].value !== undefined) out[k] = { value: _jex_coerceToPercent(partial[k].value) || partial[k].value, type: 'lineHeights' };
      else if (lhExisting && lhExisting[k] && lhExisting[k].value !== undefined) out[k] = { value: _jex_coerceToPercent(lhExisting[k].value) || lhExisting[k].value, type: 'lineHeights' };
      else if (_NATO_TS_DEFAULT_LINE_HEIGHTS[k]) out[k] = { value: _NATO_TS_DEFAULT_LINE_HEIGHTS[k].value, type: 'lineHeights' };
    }
    core.lineHeights = out;
  } else {
    for (const k of ['0','1','2','3']) {
      const t = lhExisting[k];
      if (t && t.value !== undefined && !/%$/.test(String(t.value))) { t.value = _jex_coerceToPercent(t.value); t.type = 'lineHeights'; }
    }
  }
  const lsExisting = core.letterSpacing;
  const lsKeys = lsExisting && typeof lsExisting === 'object' ? Object.keys(lsExisting) : [];
  if (lsKeys.length < 9) {
    const out: any = {};
    for (const k of Object.keys(_NATO_TS_DEFAULT_LETTER_SPACING)) {
      if (lsExisting && lsExisting[k] && lsExisting[k].value !== undefined) out[k] = { value: _jex_coerceToPercent(lsExisting[k].value) || String(lsExisting[k].value), type: 'letterSpacing' };
      else out[k] = { value: _NATO_TS_DEFAULT_LETTER_SPACING[k].value, type: 'letterSpacing' };
    }
    core.letterSpacing = out;
  } else {
    for (const k of Object.keys(lsExisting)) {
      const t = lsExisting[k];
      if (t && t.value !== undefined && !/%$/.test(String(t.value))) { t.value = _jex_coerceToPercent(t.value); t.type = 'letterSpacing'; }
    }
  }
  return core;
}

function _jex_generateHashFromId(id: string): string {
  const str = String(id);
  const chars = '0123456789abcdef';
  let seed = 0;
  for (let i = 0; i < str.length; i++) seed = (Math.imul(31, seed) + str.charCodeAt(i)) | 0;
  if (seed === 0) seed = 1;
  seed = Math.abs(seed);
  function mulberry32(a: number) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(seed);
  let hash = '';
  for (let j = 0; j < 40; j++) hash += chars[Math.floor(rand() * 16)];
  return hash;
}

function _jex_stripVariableIdPrefix(id: string): string {
  let cleanId = id;
  if (id.indexOf('/') !== -1) cleanId = id.split('/')[1] || id;
  return _jex_generateHashFromId(cleanId);
}

function _jex_generateThemeId(): string {
  const chars = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 40; i++) id += chars[Math.floor(Math.random() * 16)];
  return id;
}

function _jex_getCollectionByNameLoose(map: Record<string, any>, primary: string): any {
  if (map[primary]) return map[primary];
  const lower = primary.toLowerCase();
  for (const k of Object.keys(map)) if (k.toLowerCase() === lower) return map[k];
  return undefined;
}

const _JEX_TOKEN_STUDIO_SET_ORDER = [
  'core','foundation','mode/light','mode/dark','scheme/neutral','scheme/inverted','scheme/white',
  'scheme/black','scheme/brand','scheme/secondary','secondary/amber','secondary/aqua','secondary/ice',
  'secondary/dandelion','secondary/egg','secondary/frog','secondary/guacamole','secondary/hummingbird',
  'secondary/iguana','secondary/jacuzzi','secondary/kingfisher','secondary/lagoon','secondary/macaw',
  'secondary/nebula','secondary/orchid','white','black','brand','restrictions/unrestricted',
  'restrictions/to-neutral','restrictions/to-neutral-and-brand','restrictions/to-neutral-and-secondary',
  'breakpoint/mobile','breakpoint/tablet','breakpoint/laptop','breakpoint/desktop','breakpoint/large-desktop','layout/layout'
];

function _jex_buildTokenSetOrder(out: any): string[] {
  const order: string[] = [];
  for (const k of _JEX_TOKEN_STUDIO_SET_ORDER) if (out[k] !== undefined) order.push(k);
  for (const k of Object.keys(out)) if (k.charAt(0) !== '$' && order.indexOf(k) === -1) order.push(k);
  return order;
}

function _jex_buildThemes(rawData: any, tokenSetNames: string[]): any[] {
  if (!rawData || !Array.isArray(rawData.collections)) return [];
  const collectionMap: Record<string, any> = {};
  rawData.collections.forEach((col: any) => { collectionMap[col.name] = col; });

  function generateHashFromId(id: string) { return _jex_generateHashFromId(id); }
  function formatStyleId(id: string) { const cleanId = String(id).replace(/^S:/, ''); return 'S:' + generateHashFromId(cleanId) + ','; }
  function toTokenStudioCase(name: string) {
    const parts = name.replace(/\s+/g, '-').split('-');
    return parts.map((p: string) => (p.length === 1 && /[A-Z]/.test(p)) ? p : p.toLowerCase()).join('-');
  }

  function buildStyleRefsForTheme(themeName: string, themeGroup: string | null): Record<string, string> {
    const refs: Record<string, string> = {};
    if (!rawData.styles) return refs;
    if (themeGroup === 'layout') return {};
    if (themeName === 'foundation' && (!themeGroup || themeGroup === '')) {
      // Foundation style refs
      const shortLevel: any[] = [], typoEntries: any[] = [], longLevel: any[] = [], appBarFab: any[] = [], fallback: any[] = [];
      if (rawData.styles.effectStyles) {
        rawData.styles.effectStyles.forEach((style: any) => {
          const lowerParts = style.name.split('/').map((p: string) => toTokenStudioCase(p));
          const basePath = lowerParts.join('.');
          const lastSeg = lowerParts[lowerParts.length - 1];
          const id = formatStyleId(style.id);
          const lm = basePath.match(/^elevation\.level-(\d+)$/i);
          if (lm) { const n = parseInt(lm[1]); longLevel.push({ n, key: 'elevation.level-'+n+'.level-'+n, id }); if (n >= 1) shortLevel.push({ n, key: 'elevation.level-'+n, id }); return; }
          if (basePath.indexOf('elevation.') === 0 && lowerParts.length >= 2) { appBarFab.push({ key: basePath + '.' + lastSeg, id }); return; }
          fallback.push({ key: basePath, id });
        });
      }
      if (rawData.styles.textStyles) {
        rawData.styles.textStyles.forEach((style: any) => {
          const nameParts = style.name.split('/');
          const id = formatStyleId(style.id);
          let tokenPath: string;
          if (nameParts.length >= 2) { const lp = nameParts.map((p: string) => toTokenStudioCase(p)); tokenPath = lp.join('.') + '.' + lp[lp.length - 1]; }
          else { const converted = toTokenStudioCase(style.name); tokenPath = 'typography.' + converted + '.' + converted; }
          typoEntries.push({ key: tokenPath, id });
        });
      }
      shortLevel.sort((a: any, b: any) => a.n - b.n);
      longLevel.sort((a: any, b: any) => a.n - b.n);
      shortLevel.forEach((e: any) => { refs[e.key] = e.id; });
      typoEntries.forEach((e: any) => { refs[e.key] = e.id; });
      longLevel.forEach((e: any) => { refs[e.key] = e.id; });
      appBarFab.forEach((e: any) => { refs[e.key] = e.id; });
      fallback.forEach((e: any) => { refs[e.key] = e.id; });
      return refs;
    }
    if (themeGroup === '.breakpoint') {
      if (rawData.styles.textStyles) {
        rawData.styles.textStyles.forEach((style: any) => {
          const nameParts = style.name.split('/');
          let tokenPath: string;
          if (nameParts.length >= 2) { const lp = nameParts.map((p: string) => toTokenStudioCase(p)); tokenPath = 'breakpoint.' + lp.join('.') + '.' + lp[lp.length - 1]; }
          else { const converted = toTokenStudioCase(style.name); tokenPath = 'breakpoint.typography.' + converted + '.' + converted; }
          refs[tokenPath] = formatStyleId(style.id);
        });
      }
      return refs;
    }
    // Other themes: effect styles + text styles
    if (rawData.styles.effectStyles) {
      rawData.styles.effectStyles.forEach((style: any) => {
        const nameParts = style.name.split('/');
        let tokenPath: string;
        if (nameParts.length >= 2) { const lp = nameParts.map((p: string) => toTokenStudioCase(p)); tokenPath = lp.join('.') + '.' + lp[lp.length - 1]; }
        else tokenPath = style.name.replace(/\//g, '.');
        refs[tokenPath] = formatStyleId(style.id);
      });
    }
    if (rawData.styles.textStyles) {
      rawData.styles.textStyles.forEach((style: any) => {
        const nameParts = style.name.split('/');
        let tokenPath: string;
        if (nameParts.length >= 2) { const lp = nameParts.map((p: string) => toTokenStudioCase(p)); tokenPath = lp.join('.') + '.' + lp[lp.length - 1]; }
        else { const converted = toTokenStudioCase(style.name); tokenPath = 'typography.' + converted + '.' + converted; }
        refs[tokenPath] = formatStyleId(style.id);
      });
    }
    return refs;
  }

  const themeConfigs: any[] = [];

  if (tokenSetNames.indexOf('foundation') !== -1) {
    const foundationCol = collectionMap['foundation'];
    if (foundationCol && foundationCol.modes.length > 0) {
      themeConfigs.push({ name: 'foundation', group: null, selectedTokenSets: { 'foundation': 'enabled', 'core': 'source' }, collection: foundationCol, modeIndex: 0 });
    }
  }

  if (tokenSetNames.indexOf('core') !== -1) {
    const coreCol = collectionMap['.core'] || collectionMap['core'];
    if (coreCol && coreCol.modes.length > 0) {
      themeConfigs.push({ name: '.core', group: null, selectedTokenSets: { 'core': 'enabled' }, collection: coreCol, modeIndex: 0 });
    }
  }

  for (const name of ['white','black','brand']) {
    if (tokenSetNames.indexOf(name) !== -1) {
      const col = collectionMap['.' + name] || collectionMap[name];
      if (col && col.modes.length > 0) {
        const ss: any = { 'core': 'source' }; ss[name] = 'enabled';
        themeConfigs.push({ name: '.' + name, group: null, selectedTokenSets: ss, collection: col, modeIndex: 0 });
      }
    }
  }

  const modeCol = collectionMap['.mode'];
  if (modeCol) {
    modeCol.modes.forEach((mode: any, idx: number) => {
      const modeName = mode.name.toLowerCase();
      const tokenSetKey = 'mode/' + modeName;
      if (tokenSetNames.indexOf(tokenSetKey) !== -1) {
        const ss: any = {}; ss[tokenSetKey] = 'enabled';
        if (tokenSetNames.indexOf('restrictions/unrestricted') !== -1) ss['restrictions/unrestricted'] = 'source';
        themeConfigs.push({ name: modeName, group: '.mode', selectedTokenSets: ss, collection: modeCol, modeIndex: idx });
      }
    });
  }

  const schemeNames = ['neutral','inverted','white','black','brand','secondary'];
  schemeNames.forEach(schemeName => {
    const tokenSetKey = 'scheme/' + schemeName;
    if (tokenSetNames.indexOf(tokenSetKey) === -1) return;
    let schemeCol: any = null, schemeModeIdx = -1;
    Object.keys(collectionMap).forEach(colName => {
      const col = collectionMap[colName];
      col.modes.forEach((mode: any, idx: number) => {
        const ml = mode.name.toLowerCase();
        if (ml === schemeName || ml.indexOf(schemeName) !== -1) { schemeCol = col; schemeModeIdx = idx; }
      });
    });
    if (schemeCol && schemeModeIdx >= 0) {
      const ss: any = {}; ss[tokenSetKey] = 'enabled';
      themeConfigs.push({ name: schemeName, group: '.scheme', selectedTokenSets: ss, collection: schemeCol, modeIndex: schemeModeIdx });
    }
  });

  const secondaryCol = collectionMap['.secondary'];
  if (secondaryCol) {
    secondaryCol.modes.forEach((mode: any, idx: number) => {
      const modeName = mode.name.toLowerCase();
      if (schemeNames.indexOf(modeName) !== -1) return;
      const tokenSetKey = 'secondary/' + modeName;
      if (tokenSetNames.indexOf(tokenSetKey) !== -1) {
        const ss: any = {}; ss[tokenSetKey] = 'enabled';
        themeConfigs.push({ name: modeName, group: '.secondary', selectedTokenSets: ss, collection: secondaryCol, modeIndex: idx });
      }
    });
  }

  const restrictedCol = collectionMap['_restricted'];
  if (restrictedCol) {
    restrictedCol.modes.forEach((mode: any, idx: number) => {
      const modeName = mode.name.toLowerCase().replace(/\s+/g, '-');
      const tokenSetKey = 'restrictions/' + modeName;
      if (tokenSetNames.indexOf(tokenSetKey) !== -1) {
        const ss: any = {}; ss[tokenSetKey] = 'enabled';
        themeConfigs.push({ name: modeName, group: '.restrictions', selectedTokenSets: ss, collection: restrictedCol, modeIndex: idx });
      }
    });
  }

  const breakpointCol = collectionMap['.breakpoint'];
  const bpMap: Record<string, string> = { 's-mobile':'mobile','m-tablet':'tablet','l-laptop':'laptop','xl-desktop':'desktop','xxl-large-desktop':'large-desktop' };
  if (breakpointCol) {
    breakpointCol.modes.forEach((mode: any, idx: number) => {
      const modeLower = mode.name.toLowerCase().replace(/\s+/g, '-');
      const tokenSetSlug = bpMap[modeLower] || modeLower.split('-').slice(1).join('-') || modeLower;
      const tokenSetKey = 'breakpoint/' + tokenSetSlug;
      if (tokenSetNames.indexOf(tokenSetKey) !== -1) {
        const ss: any = {}; ss[tokenSetKey] = 'enabled'; ss['core'] = 'source';
        themeConfigs.push({ name: mode.name, group: '.breakpoint', selectedTokenSets: ss, collection: breakpointCol, modeIndex: idx });
      }
    });
  }

  const layoutCol = _jex_getCollectionByNameLoose(collectionMap, 'layout');
  if (layoutCol) {
    layoutCol.modes.forEach((mode: any, idx: number) => {
      const tokenSetKey = 'layout/layout';
      if (tokenSetNames.indexOf(tokenSetKey) !== -1) {
        const ss: any = {}; ss[tokenSetKey] = 'enabled';
        themeConfigs.push({ name: mode.name.toLowerCase(), group: 'layout', selectedTokenSets: ss, collection: layoutCol, modeIndex: idx });
      }
    });
  }

  const themes: any[] = [];
  themeConfigs.forEach(config => {
    const theme: any = { id: _jex_generateThemeId(), name: config.name };
    if (config.group) theme.group = config.group;
    theme.selectedTokenSets = config.selectedTokenSets;
    const styleRefs = buildStyleRefsForTheme(config.name, config.group);
    if (config.group === 'layout') theme['$figmaStyleReferences'] = {};
    else if (Object.keys(styleRefs).length > 0) theme['$figmaStyleReferences'] = styleRefs;
    const figmaVarRefs: Record<string, string> = {};
    if (config.collection && config.collection.variables) {
      const varPrefixMap: Record<string, string> = { '.mode':'mode.', '.scheme':'scheme.', '.breakpoint':'breakpoint.', '.secondary':'secondary.', '.restrictions':'restrictions.' };
      let varPrefix = varPrefixMap[config.group] || '';
      if (config.name === '.white') varPrefix = 'white.';
      else if (config.name === '.black') varPrefix = 'black.';
      else if (config.name === '.brand') varPrefix = 'brand.';
      config.collection.variables.forEach((v: any) => {
        if (v.name && v.id) {
          const varName = v.name.replace(/\//g, '.');
          if (varPrefix && varName.toLowerCase().startsWith(varPrefix.slice(0, -1).toLowerCase() + '.')) figmaVarRefs[varName] = _jex_stripVariableIdPrefix(v.id);
          else figmaVarRefs[varPrefix + varName] = _jex_stripVariableIdPrefix(v.id);
        }
      });
    }
    if (Object.keys(figmaVarRefs).length > 0) theme['$figmaVariableReferences'] = figmaVarRefs;
    if (config.collection) {
      theme['$figmaCollectionId'] = config.collection.id;
      if (config.collection.modes[config.modeIndex]) theme['$figmaModeId'] = config.collection.modes[config.modeIndex].modeId;
    }
    themes.push(theme);
  });
  return themes;
}

function _jex_toTokenStudioFormat(native: any, rawData: any): any {
  let out: any = {};
  const BP_KEY_ORDER = ['spacing','sizing','typography','grid','stretch-grid','overflow-grid','fixed-grid','columns','layout','breakpoint-string'];
  const FOUNDATION_KEY_ORDER = ['spacing','sizing','radius','colours','typography','strokes','grid','elevation','variant'];
  const bpMap: Record<string, string> = { 'S Mobile':'mobile','M Tablet':'tablet','L Laptop':'laptop','XL Desktop':'desktop','XXL Large Desktop':'large-desktop' };
  const modeElevPrefixMap: Record<string, any> = { 'light': { main:'white.elevation', inverted:'black.elevation' }, 'dark': { main:'black.elevation', inverted:'white.elevation' } };
  const schemeElevPrefixMap: Record<string, string> = { 'neutral':'mode.elevation','inverted':'mode-inverted.elevation','white':'white.elevation','black':'black.elevation','brand':'brand.elevation','secondary':'secondary.elevation' };

  // core
  if (native['.core'] && native['.core']['.core']) {
    out['core'] = _jex_fixCoreTokens(native['.core']['.core']);
    _jex_applyDimensionBaseExpressions(out['core']);
  }
  if (!out['core']) out['core'] = {};
  _jex_ensureCoreTextCaseAndDecoration(out['core']);
  _jex_ensureCoreLineHeightsLetterSpacing(out['core']);

  // foundation
  if (native['foundation'] && native['foundation']['foundation']) out['foundation'] = native['foundation']['foundation'];
  if (out['foundation']) out['foundation'] = _jex_fixFoundationTokens(out['foundation']);
  else out['foundation'] = {};
  if (out['foundation']['elevation']) out['foundation']['elevation'] = _jex_addElevationComposites(out['foundation']['elevation'], 'scheme.elevation');
  if (!out['foundation']['variant']) out['foundation']['variant'] = {};
  out['foundation']['variant']['breakpoint'] = { value: '{breakpoint.breakpoint-string}', type: 'text' };

  // foundation typography aliases
  const typScales = ['display','title-L','title-M','title-S','subtitle','paragraph','body-L','body-M-bold','body-M-regular','link-M-bold','link-M-regular','body-S-bold','body-S-regular','link-S-regular','microcopy-bold','microcopy-regular'];
  const typProps = [
    { name: null, type: 'typography' }, { name: 'size', type: 'number' }, { name: 'line-height', type: 'number' },
    { name: 'weight', type: 'number' }, { name: 'letter-spacing', type: 'number' }, { name: 'font-family', type: 'text' },
    { name: 'paragraph-spacing', type: 'number' }, { name: 'paragraph-indent', type: 'number' },
    { name: 'text-case', type: 'textCase' }, { name: 'text-decoration', type: 'textDecoration' }
  ];
  const foundTypography: any = {};
  typScales.forEach(scale => {
    foundTypography[scale] = {};
    typProps.forEach(prop => {
      const propKey = prop.name !== null ? prop.name : scale;
      foundTypography[scale][propKey] = { value: '{breakpoint.typography.' + scale + '.' + propKey + '}', type: prop.type };
    });
  });
  out['foundation']['typography'] = foundTypography;
  const orderedFoundation: any = {};
  FOUNDATION_KEY_ORDER.forEach(k => { if (out['foundation'][k] !== undefined) orderedFoundation[k] = out['foundation'][k]; });
  Object.keys(out['foundation']).forEach(k => { if (orderedFoundation[k] === undefined) orderedFoundation[k] = out['foundation'][k]; });
  out['foundation'] = orderedFoundation;

  // mode
  if (native['.mode']) {
    Object.keys(native['.mode']).forEach(name => {
      const content = native['.mode'][name];
      const modeInverted = content['mode-inverted'];
      const rest: any = {};
      Object.keys(content).forEach(k => { if (k !== 'mode-inverted') rest[k] = content[k]; });
      const elevPrefixes = modeElevPrefixMap[name] || { main:'mode.elevation', inverted:'mode-inverted.elevation' };
      const setContent: any = { mode: _jex_applyElevationIfPresent(rest, elevPrefixes.main) };
      if (modeInverted) setContent['mode-inverted'] = _jex_applyElevationIfPresent(modeInverted, elevPrefixes.inverted);
      out['mode/' + name] = setContent;
    });
  }

  // scheme
  if (native['.scheme']) {
    Object.keys(native['.scheme']).forEach(name => {
      const elevPrefix = schemeElevPrefixMap[name] || (name + '.elevation');
      out['scheme/' + name] = { scheme: _jex_applyElevationIfPresent(native['.scheme'][name], elevPrefix) };
    });
  }

  // secondary
  if (native['.secondary']) {
    Object.keys(native['.secondary']).forEach(name => {
      out['secondary/' + name] = { secondary: _jex_applyElevationIfPresent(native['.secondary'][name], 'secondary.elevation') };
    });
  }

  // white, black, brand
  for (const key of ['.white','.black','.brand']) {
    if (native[key]) {
      const clean = key.slice(1);
      const inner = native[key][key] !== undefined ? native[key][key] : native[key][clean];
      if (inner !== undefined) { out[clean] = {}; out[clean][clean] = _jex_applyElevationIfPresent(inner, clean + '.elevation'); }
      else out[clean] = native[key];
    }
  }

  // restrictions
  if (native['_restricted']) {
    Object.keys(native['_restricted']).forEach(name => { out['restrictions/' + name] = native['_restricted'][name]; });
  }

  // breakpoints
  if (native['.breakpoint']) {
    const collectionLevelTypography = native['.breakpoint'].typography;
    Object.keys(native['.breakpoint']).forEach(name => {
      if (!bpMap[name]) return;
      const slug = bpMap[name];
      let content = _jex_fixBreakpointTypes(native['.breakpoint'][name], []);
      if (!content.typography && collectionLevelTypography) {
        const typProcessed = _jex_fixBreakpointTypes(collectionLevelTypography, ['typography']);
        const merged: any = {};
        Object.keys(content).forEach(k => { merged[k] = content[k]; });
        merged.typography = typProcessed;
        content = merged;
      }
      if (content.typography) {
        const withTypo: any = {};
        Object.keys(content).forEach(k => { withTypo[k] = content[k]; });
        withTypo.typography = _jex_fixBreakpointTypography(content.typography);
        content = withTypo;
      }
      const orderedContent: any = {};
      BP_KEY_ORDER.forEach(k => { if (content[k] !== undefined) orderedContent[k] = content[k]; });
      Object.keys(content).forEach(k => { if (orderedContent[k] === undefined) orderedContent[k] = content[k]; });
      out['breakpoint/' + slug] = { breakpoint: orderedContent };
    });
  }

  // layout
  const layoutRoot = native['layout'] || native['Layout'];
  if (layoutRoot && layoutRoot['columns']) {
    const layoutMode = layoutRoot['columns'];
    const layoutContent = layoutMode['columns'] || layoutMode;
    const fixedContent: any = {};
    const walkLayout = (obj: any): any => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
      if (Object.prototype.hasOwnProperty.call(obj, 'value') && Object.prototype.hasOwnProperty.call(obj, 'type')) return { value: obj.value, type: 'sizing' };
      const r: any = {}; for (const k of Object.keys(obj)) r[k] = walkLayout(obj[k]); return r;
    };
    out['layout/layout'] = { columns: walkLayout(layoutContent) };
  }

  // $themes
  const tokenSetNames = Object.keys(out).filter(k => k !== '$themes');
  out['$themes'] = _jex_buildThemes(rawData, tokenSetNames);

  // finalize
  out = _jex_fixKeyOrder(out);
  out = _jex_fixAliasPaths(out);
  out['$metadata'] = { tokenSetOrder: _jex_buildTokenSetOrder(out) };
  return out;
}

// ============================================================================
// DESKTOP BRIDGE — Helper functions & init
// ============================================================================

function _dbSerializeVariable(v: Variable) {
  return {
    id: v.id, name: v.name, key: v.key,
    resolvedType: v.resolvedType, valuesByMode: v.valuesByMode,
    variableCollectionId: v.variableCollectionId, scopes: v.scopes,
    description: v.description, hiddenFromPublishing: v.hiddenFromPublishing
  };
}

function _dbSerializeCollection(c: VariableCollection) {
  return {
    id: c.id, name: c.name, key: c.key,
    modes: c.modes, defaultModeId: c.defaultModeId, variableIds: c.variableIds
  };
}

function _dbHexToRGB(hex: string): { r: number; g: number; b: number; a: number } {
  hex = hex.replace(/^#/, '');
  if (!/^[0-9A-Fa-f]+$/.test(hex)) throw new Error('Invalid hex color: ' + hex);
  let r: number, g: number, b: number, a = 1;
  if (hex.length === 3) {
    r = parseInt(hex[0]+hex[0],16)/255; g = parseInt(hex[1]+hex[1],16)/255; b = parseInt(hex[2]+hex[2],16)/255;
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0,2),16)/255; g = parseInt(hex.substring(2,4),16)/255; b = parseInt(hex.substring(4,6),16)/255;
  } else if (hex.length === 8) {
    r = parseInt(hex.substring(0,2),16)/255; g = parseInt(hex.substring(2,4),16)/255; b = parseInt(hex.substring(4,6),16)/255; a = parseInt(hex.substring(6,8),16)/255;
  } else {
    throw new Error('Invalid hex format: ' + hex);
  }
  return { r, g, b, a };
}

// Send initial variables snapshot to UI on startup (consumed by the WebSocket bridge)
(async () => {
  try {
    const _vars = await figma.variables.getLocalVariablesAsync();
    const _colls = await figma.variables.getLocalVariableCollectionsAsync();
    figma.ui.postMessage({
      type: 'VARIABLES_DATA',
      data: {
        success: true, timestamp: Date.now(), fileKey: figma.fileKey || null,
        variables: _vars.map(_dbSerializeVariable),
        variableCollections: _colls.map(_dbSerializeCollection)
      }
    });
  } catch (e) {
    figma.ui.postMessage({ type: 'ERROR', error: e instanceof Error ? e.message : String(e) });
  }
})();

// ============================================================================
// DS settings persistence (logo PNG is stored separately — large data URLs do not fit one postMessage with the rest of the config)
// ============================================================================

const DS_SETTINGS_STORAGE_KEY = 'dscc-ds-settings';
const DS_LOGO_PNG_STORAGE_KEY = 'dscc-ds-settings-logo-png';

let _dsSettingsSaveChain: Promise<void> = Promise.resolve();

function enqueueDsSettingsSaveStep(step: () => Promise<void>): void {
  _dsSettingsSaveChain = _dsSettingsSaveChain
    .then(step)
    .catch((e: unknown) => {
      const err = e instanceof Error ? e.message : String(e);
      figma.ui.postMessage({ type: 'DS_SETTINGS_SAVED', error: err });
    })
    .then(() => undefined);
}

// ============================================================================
// Message Handler
// ============================================================================

figma.ui.onmessage = async (msg) => {
  console.log('Received message:', msg.type);

  // -------------------------------------------------------------------------
  // BRIDGE (MCP → plugin: execute code, get node, screenshot, etc.)
  // -------------------------------------------------------------------------
  if (msg.type && String(msg.type).startsWith('BRIDGE_')) {
    const handled = await getDesktopBridge().handleMessage(msg);
    if (handled) return;
  }

  // -------------------------------------------------------------------------
  // UI READY (Preact UI bootstrap)
  // -------------------------------------------------------------------------
  if (msg.type === 'UI_READY') {
    figma.ui.postMessage({
      type: 'INIT',
      data: { ready: true, source: 'ui_ready' },
      currentSize: { width: PLUGIN_UI_WIDTH, height: PLUGIN_UI_HEIGHT_DEFAULT },
    });
    const bridgeStatus = getDesktopBridge().getStatus();
    figma.ui.postMessage({
      type: 'BRIDGE_STATUS',
      status: bridgeStatus.isRunning ? 'connected' : 'disconnected',
      mode: bridgeStatus.mode || 'embedded',
    });
    return;
  }

  if (msg.type === 'RESIZE_UI') {
    const h = Math.round(Number((msg as { height?: number }).height));
    if (h >= PLUGIN_UI_HEIGHT_MIN && h <= PLUGIN_UI_HEIGHT_MAX) {
      figma.ui.resize(PLUGIN_UI_WIDTH, h);
    }
    return;
  }

  // -------------------------------------------------------------------------
  // CANCEL SCAN
  // -------------------------------------------------------------------------
  if (msg.type === 'CANCEL_SCAN') {
    scanCancelled = true;
    if (componentAnalyzer) componentAnalyzer.cancelled = true;
    console.log('⛔ Scan cancelled by user');
    return;
  }

  // -------------------------------------------------------------------------
  // RUN SCAN
  // -------------------------------------------------------------------------
  if (msg.type === 'RUN_SCAN') {
    scanCancelled = false;
    if (componentAnalyzer) componentAnalyzer.cancelled = false;
    includeContextRulesInScan = msg.includeContextRules !== false;
    const target = msg.target as 'components' | 'variables' | 'styles' | undefined;
    const selection = figma.currentPage.selection;

    // Variables and styles scan the whole document - no selection required
    if (target === 'variables') {
      await scanDocumentVariables();
      return;
    }
    if (target === 'styles') {
      await scanDocumentStyles();
      return;
    }

    // Components require selection
    if (selection.length === 0) {
      figma.notify('⚠️ Please select one or more layers in Figma to scan');
      figma.ui.postMessage({ type: 'EMPTY_SELECTION' });
      return;
    }
    let config: ScanConfig;
    if (target) {
      config = targetToConfig(target);
    } else if (msg.config) {
      config = msg.config as ScanConfig;
    } else {
      config = { scanStyles: true, scanVariables: true, scanPageNames: true, scanStructure: true };
    }
    await scanSelection(config);
  }
  
  // -------------------------------------------------------------------------
  // APPLY FIX
  // -------------------------------------------------------------------------
  else if (msg.type === 'APPLY_FIX') {
    try {
      const { issueId, nodeId, nodeType, propertyPath, value } = msg;
      
      console.log('Applying fix:', { issueId, nodeId, nodeType, propertyPath });
      
      // === HANDLE VARIABLES (not SceneNodes) ===
      if (nodeType === 'Variable') {
        const variable = await figma.variables.getVariableByIdAsync(nodeId);
        
        if (!variable) {
          console.error('Variable not found:', nodeId);
          figma.ui.postMessage({
            type: 'FIX_APPLIED',
            issueId: issueId,
            success: false,
            error: 'Variable not found'
          });
          return;
        }
        
        // Apply fix based on property path
        if (propertyPath === 'description') {
          variable.description = value;
          console.log('Variable description updated:', value);
        } else if (propertyPath === 'scopes') {
          variable.scopes = value;
          console.log('Variable scopes updated:', value);
        }
        
        figma.ui.postMessage({
          type: 'FIX_APPLIED',
          issueId: issueId,
          success: true
        });
        
        figma.notify('✅ Variable updated!');
        return;
      }

      // === HANDLE STYLES (Paint, Text, Effect) ===
      if (nodeType === 'PAINT' || nodeType === 'TEXT' || nodeType === 'EFFECT') {
        const style = await figma.getStyleByIdAsync(nodeId);
        
        if (!style) {
          console.error('Style not found:', nodeId);
          figma.ui.postMessage({
            type: 'FIX_APPLIED',
            issueId: issueId,
            success: false,
            error: 'Style not found'
          });
          return;
        }
        
        if (propertyPath === 'description') {
          style.description = value;
          console.log('Style description updated:', value);
        }
        
        figma.ui.postMessage({
          type: 'FIX_APPLIED',
          issueId: issueId,
          success: true
        });
        
        figma.notify('✅ Style updated!');
        return;
      }
      
      // === HANDLE REGULAR SCENE NODES ===
      const node = await figma.getNodeByIdAsync(nodeId);
      
      if (!node) {
        console.error('Node not found:', nodeId);
        figma.ui.postMessage({
          type: 'FIX_APPLIED',
          issueId: issueId,
          success: false,
          error: 'Node not found'
        });
        return;
      }
      
      console.log('Found node:', node.name, node.type);
      
      // Apply fix based on property path (description exists only on some node types)
      if (propertyPath === 'description' && 'description' in node) {
        (node as { description: string }).description = value;
        console.log('Node description updated:', value);
      }
      else if (propertyPath === 'documentationLinks') {
        if ('documentationLinks' in node) {
          node.documentationLinks = value;
          console.log('Documentation links updated:', value);
        }
      }
      else if (propertyPath === 'name') {
        node.name = value;
        console.log('Node name updated:', value);
      }
      
      figma.ui.postMessage({
        type: 'FIX_APPLIED',
        issueId: issueId,
        success: true
      });
      
      figma.notify('✅ Fix applied successfully!');
      
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Error applying fix:', error);
      figma.ui.postMessage({
        type: 'FIX_APPLIED',
        issueId: msg.issueId,
        success: false,
        error: errMsg
      });
      figma.notify('❌ Error: ' + errMsg);
    }
  }
  
  // -------------------------------------------------------------------------
  // GENERATE SUGGESTION (on-demand for Sparkles / AI fill)
  // -------------------------------------------------------------------------
  else if (msg.type === 'GENERATE_SUGGESTION') {
    const issue = msg.issue as { id: string; nodeId: string; nodeType?: string; nodeName?: string; suggestionConfig?: unknown };
    if (!issue || !issue.nodeId) {
      figma.ui.postMessage({
        type: 'SUGGESTION_GENERATED',
        issueId: issue?.id ?? '',
        success: false,
        formatted: '',
        value: null
      });
      return;
    }

    // === HANDLE VARIABLES (not SceneNodes) ===
    if (issue.nodeType === 'Variable') {
      try {
        const variable = await figma.variables.getVariableByIdAsync(issue.nodeId);
        if (variable) {
          // Find collection name
          const collections = await figma.variables.getLocalVariableCollectionsAsync();
          const collection = collections.find(c => c.id === variable.variableCollectionId);
          const collName = collection ? collection.name : 'Unknown';
          const desc = generateVariableDescription(variable, collName);
          figma.ui.postMessage({
            type: 'SUGGESTION_GENERATED',
            issueId: issue.id,
            success: true,
            formatted: desc,
            value: desc
          });
        } else {
          figma.ui.postMessage({
            type: 'SUGGESTION_GENERATED',
            issueId: issue.id,
            success: false,
            formatted: '',
            value: null
          });
        }
      } catch (e) {
        console.error('Error generating variable suggestion:', e);
        figma.ui.postMessage({
          type: 'SUGGESTION_GENERATED',
          issueId: issue.id,
          success: false,
          formatted: '',
          value: null
        });
      }
      return;
    }

    // === HANDLE STYLES (Paint, Text, Effect) ===
    if (issue.nodeType === 'PAINT' || issue.nodeType === 'TEXT' || issue.nodeType === 'EFFECT') {
      try {
        const style = await figma.getStyleByIdAsync(issue.nodeId);
        if (style) {
          const desc = generateStyleDescription(style);
          figma.ui.postMessage({
            type: 'SUGGESTION_GENERATED',
            issueId: issue.id,
            success: true,
            formatted: desc,
            value: desc
          });
        } else {
          figma.ui.postMessage({
            type: 'SUGGESTION_GENERATED',
            issueId: issue.id,
            success: false,
            formatted: '',
            value: null
          });
        }
      } catch (e) {
        console.error('Error generating style suggestion:', e);
        figma.ui.postMessage({
          type: 'SUGGESTION_GENERATED',
          issueId: issue.id,
          success: false,
          formatted: '',
          value: null
        });
      }
      return;
    }

    // === HANDLE REGULAR SCENE NODES ===
    const node = await figma.getNodeByIdAsync(issue.nodeId);
    if (!node || !('type' in node) || node.type === 'DOCUMENT') {
      figma.ui.postMessage({
        type: 'SUGGESTION_GENERATED',
        issueId: issue.id,
        success: false,
        formatted: '',
        value: null
      });
      return;
    }
    if (!suggestionGenerator) {
      figma.ui.postMessage({
        type: 'SUGGESTION_GENERATED',
        issueId: issue.id,
        success: false,
        formatted: '',
        value: null
      });
      return;
    }
    const suggestion = suggestionGenerator.generateSuggestion(
      issue as Issue,
      node as SceneNode
    );
    figma.ui.postMessage({
      type: 'SUGGESTION_GENERATED',
      issueId: issue.id,
      success: !!suggestion,
      formatted: suggestion?.formatted ?? '',
      value: suggestion?.value ?? null
    });
  }

  // -------------------------------------------------------------------------
  // SELECT NODE
  // -------------------------------------------------------------------------
  else if (msg.type === 'SELECT_NODE') {
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node && 'type' in node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  }

  // -------------------------------------------------------------------------
  // PERSIST SCAN SCORES (for Overall Context Score)
  // -------------------------------------------------------------------------
  else if (msg.type === 'SAVE_SCAN_SCORES') {
    try {
      await figma.clientStorage.setAsync('dsccScanScores', JSON.stringify(msg.scores));
    } catch (e) { /* non-fatal */ }
  }
  else if (msg.type === 'LOAD_SCAN_SCORES') {
    try {
      const raw = await figma.clientStorage.getAsync('dsccScanScores');
      const scores = raw ? JSON.parse(raw) : null;
      figma.ui.postMessage({ type: 'SCAN_SCORES_LOADED', scores: scores });
    } catch (e) {
      figma.ui.postMessage({ type: 'SCAN_SCORES_LOADED', scores: null });
    }
  }
  
  // -------------------------------------------------------------------------
  // LOAD RULES CONFIG (from any source)
  // -------------------------------------------------------------------------
  else if (msg.type === 'LOAD_RULES_CONFIG') {
    try {
      const config = ensureRulesConfig(msg.config ?? {});
      await figma.clientStorage.setAsync('rulesConfig', JSON.stringify(config));
      await loadRulesConfig();
      
      figma.notify('✅ Rules config loaded successfully!');
      figma.ui.postMessage({
        type: 'RULES_CONFIG_LOADED',
        success: true,
        ruleCount: config.rules.length
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Error loading rules config:', error);
      figma.notify('❌ Failed to load rules config');
      figma.ui.postMessage({
        type: 'RULES_CONFIG_LOADED',
        success: false,
        error: errMsg
      });
    }
  }

  // -------------------------------------------------------------------------
  // SAVE CONNECTOR CONFIG (persist source settings)
  // -------------------------------------------------------------------------
  else if (msg.type === 'SAVE_CONNECTOR_CONFIG') {
    try {
      await figma.clientStorage.setAsync('connectorConfig', JSON.stringify(msg.config));
      figma.ui.postMessage({ type: 'CONNECTOR_CONFIG_SAVED', success: true });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      figma.ui.postMessage({ type: 'CONNECTOR_CONFIG_SAVED', success: false, error: errMsg });
    }
  }

  // -------------------------------------------------------------------------
  // GET CONNECTOR CONFIG (load on UI init)
  // -------------------------------------------------------------------------
  else if (msg.type === 'GET_CONNECTOR_CONFIG') {
    try {
      const raw = await figma.clientStorage.getAsync('connectorConfig');
      const config = raw ? JSON.parse(raw) : null;
      figma.ui.postMessage({ type: 'CONNECTOR_CONFIG_LOADED', config });
    } catch {
      figma.ui.postMessage({ type: 'CONNECTOR_CONFIG_LOADED', config: null });
    }
  }

  // -------------------------------------------------------------------------
  // DESCRIPTION API KEY (for AI-generated descriptions from rules + scan context)
  // -------------------------------------------------------------------------
  else if (msg.type === 'SAVE_DESCRIPTION_API_KEY') {
    try {
      const key = (msg as { apiKey?: string }).apiKey;
      await figma.clientStorage.setAsync('descriptionApiKey', key ?? '');
      figma.ui.postMessage({ type: 'DESCRIPTION_API_KEY_SAVED', success: true });
      if (key) figma.notify('✅ API key saved');
    } catch (e) {
      figma.ui.postMessage({ type: 'DESCRIPTION_API_KEY_SAVED', success: false });
    }
  }
  else if (msg.type === 'GET_DESCRIPTION_API_CONFIG') {
    try {
      const apiKey = await figma.clientStorage.getAsync('descriptionApiKey');
      figma.ui.postMessage({
        type: 'DESCRIPTION_API_CONFIG_LOADED',
        apiKey: apiKey || '',
        hasKey: !!(apiKey && apiKey.length > 0)
      });
    } catch {
      figma.ui.postMessage({ type: 'DESCRIPTION_API_CONFIG_LOADED', apiKey: '', hasKey: false });
    }
  }

  // -------------------------------------------------------------------------
  // GET RULES + CONTEXT FOR AI DESCRIPTION (UI calls API with this payload)
  // -------------------------------------------------------------------------
  else if (msg.type === 'GET_RULES_AND_CONTEXT_FOR_DESCRIPTION') {
    const issue = (msg as { issue?: Issue }).issue;
    if (!issue || !issue.nodeId) {
      figma.ui.postMessage({ type: 'RULES_AND_CONTEXT', error: 'Missing issue', rules: null, issueContext: null });
      return;
    }
    try {
      const rulesData = await figma.clientStorage.getAsync('rulesConfig');
      const rulesConfig = rulesData ? ensureRulesConfig(JSON.parse(rulesData)) : EMPTY_RULES_CONFIG;
      const rules = rulesConfig.rules || [];
      const rulesSummary = JSON.stringify({ meta: rulesConfig.meta, ruleCount: rules.length, rules: rules.slice(0, 50) }, null, 0);

      let issueContext: Record<string, unknown> = {
        entityType: issue.nodeType || 'unknown',
        name: issue.nodeName,
        currentDescription: (issue as any).currentValue ?? '',
        nodePath: issue.nodePath,
        message: issue.message,
        suggestion: issue.suggestion
      };

      if (issue.nodeType === 'Variable') {
        const variable = await figma.variables.getVariableByIdAsync(issue.nodeId);
        if (variable) {
          const collections = await figma.variables.getLocalVariableCollectionsAsync();
          const coll = collections.find(c => c.id === variable.variableCollectionId);
          let valuePreview: string | undefined;
          if (variable.resolvedType === 'COLOR' && variable.valuesByMode) {
            const firstMode = Object.keys(variable.valuesByMode)[0];
            const v = (variable.valuesByMode as any)[firstMode];
            if (v && typeof v === 'object' && 'r' in v) valuePreview = rgbaToHex(v as { r: number; g: number; b: number; a?: number });
          }
          issueContext = {
            ...issueContext,
            entityType: 'variable',
            name: variable.name,
            type: variable.resolvedType,
            currentDescription: variable.description ?? '',
            collectionName: coll ? coll.name : undefined,
            valuePreview
          };

          // ── Foundation: inject formula rules + alias/value metadata ──────
          if (coll?.name === 'foundation') {
            const allVars = await figma.variables.getLocalVariablesAsync();
            const varMap: Record<string, typeof variable> = {};
            for (const v of allVars) varMap[v.id] = v;

            // Resolve alias target (one hop)
            const modeId = Object.keys(variable.valuesByMode)[0];
            const modeVal = (variable.valuesByMode as any)[modeId];
            let aliasTarget: string | null = null;
            let leafValue: number | null = null;
            if (modeVal && typeof modeVal === 'object' && modeVal.type === 'VARIABLE_ALIAS') {
              const target = varMap[modeVal.id];
              aliasTarget = target?.name ?? modeVal.id;
              // follow to leaf
              let cur: any = target;
              for (let d = 0; d < 10 && cur; d++) {
                const mid = Object.keys(cur.valuesByMode)[0];
                const val = (cur.valuesByMode as any)[mid];
                if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS') {
                  cur = varMap[val.id];
                } else {
                  if (typeof val === 'number') leafValue = val;
                  break;
                }
              }
            } else if (typeof modeVal === 'number') {
              leafValue = modeVal;
            }

            const group = variable.name.split('/')[0];
            const conformanceErrors: string[] = (issue as any).foundationConformanceErrors ?? [];

            issueContext = {
              ...issueContext,
              isFoundation: true,
              group,
              aliasTarget,
              resolvedValuePx:
                leafValue !== null
                  ? formatTypographicFloatDisplay(variable.name, Math.round(leafValue * 100) / 100)
                  : null,
              scopes: (variable as any).scopes ?? [],
              conformanceErrors,
            };
          }
        }
      } else if (issue.nodeType === 'PAINT' || issue.nodeType === 'TEXT' || issue.nodeType === 'EFFECT') {
        const style = await figma.getStyleByIdAsync(issue.nodeId);
        if (style) {
          issueContext = {
            ...issueContext,
            entityType: 'style',
            name: style.name,
            type: style.type,
            currentDescription: (style as BaseStyle & { description?: string }).description ?? ''
          };
        }
      } else {
        const node = await figma.getNodeByIdAsync(issue.nodeId);
        if (node && 'type' in node) {
          const desc = ('description' in node && typeof (node as any).description === 'string') ? (node as any).description : '';
          issueContext = {
            ...issueContext,
            entityType: node.type,
            name: (node as SceneNode).name,
            currentDescription: desc
          };
        }
      }

      // For foundation variables, override rules with the 4-slot formula spec so
      // the AI generates a structurally correct description rather than a paraphrase.
      const isFoundation = (issueContext as any).isFoundation === true;
      const rulesPayload = isFoundation
        ? `FOUNDATION VARIABLE DESCRIPTION FORMULA — follow exactly, no paraphrasing.

Output up to 4 sentences in this fixed order. Each sentence is mandatory or conditional as stated.

S1 (ALWAYS): Semantic role — state what the token *is*, never repeat its name or the word "foundation".
S2 (conditional): Resolved value with unit. e.g. "24px base." — omit for colours and typography.
S3 (if aliased): MUST start with "Aliases " then the exact alias path, then the tag in brackets.
  - responsive tokens → "(responsive)"  e.g. "Aliases breakpoint/spacing/component/7 (responsive)."
  - mode-adaptive tokens → "(light/dark adaptive)"  e.g. "Aliases Mode/colours/basic/background (light/dark adaptive)."
S4 (ALWAYS): 2–4 specific UI element names. e.g. "Use for internal component gaps: icon-to-label, input padding, list-item rows."

Group rules:
- spacing: S1 = "[Zero|Smallest|Extra-small|Small|Medium|Standard|Large|Extra-large|Largest] [component|layout] spacing step." S3 tag = (responsive)
- sizing: S3 tag = (responsive). S4 names specific control types.
- radius: S1 includes the resolved px inline. S3 tag = none (raw) or exact alias name.
- colours: omit S2 entirely. S3 tag = (light/dark adaptive). Add pairing sentence for basic/background* and basic/text* only.
- typography: S1 = "[Property label] for [scale-level] text style." Omit S2. S3 tag = (responsive).
- elevation: S1 = "[shadow component] for [metaphor] elevation ([level] level)." Omit S2 for colour property. S3 tag = (light/dark adaptive).
- strokes: S1 = "[n]px border width." S3 = "Aliases X." or "Raw value."
- grid: append final sentence "Not directly bindable in Figma — reference value for layout code and grid plugins only."

Output ONLY the description. No quotes, no preamble.`
        : rulesSummary;

      figma.ui.postMessage({
        type: 'RULES_AND_CONTEXT',
        rules: rulesPayload,
        issueContext
      });
    } catch (e) {
      console.error('GET_RULES_AND_CONTEXT_FOR_DESCRIPTION error:', e);
      figma.ui.postMessage({
        type: 'RULES_AND_CONTEXT',
        error: e instanceof Error ? e.message : String(e),
        rules: null,
        issueContext: null
      });
    }
  }

  // -------------------------------------------------------------------------
  // RESET RULES TO DEFAULT
  // -------------------------------------------------------------------------
  else if (msg.type === 'RESET_RULES_DEFAULT') {
    try {
      await figma.clientStorage.deleteAsync('rulesConfig');
      await figma.clientStorage.deleteAsync('connectorConfig');
      await loadRulesConfig();
      figma.notify('✅ Rules reset to defaults');
      figma.ui.postMessage({ type: 'RULES_RESET', success: true });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      figma.ui.postMessage({ type: 'RULES_RESET', success: false, error: errMsg });
    }
  }
  
  // -------------------------------------------------------------------------
  // MCP CONFIG: Save endpoint & settings
  // -------------------------------------------------------------------------
  else if (msg.type === 'SAVE_MCP_CONFIG') {
    try {
      await figma.clientStorage.setAsync('mcpConfig', JSON.stringify(msg.config));
      figma.ui.postMessage({ type: 'MCP_CONFIG_SAVED', success: true });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      figma.ui.postMessage({ type: 'MCP_CONFIG_SAVED', success: false, error: errMsg });
    }
  }

  // -------------------------------------------------------------------------
  // MCP CONFIG: Load saved endpoint & settings
  // -------------------------------------------------------------------------
  else if (msg.type === 'GET_MCP_CONFIG') {
    try {
      const raw = await figma.clientStorage.getAsync('mcpConfig');
      const config = raw ? JSON.parse(raw) : null;
      figma.ui.postMessage({ type: 'MCP_CONFIG_LOADED', config });
    } catch {
      figma.ui.postMessage({ type: 'MCP_CONFIG_LOADED', config: null });
    }
  }

  // -------------------------------------------------------------------------
  // NOTION ENRICHED RULES: Store enriched rules from Notion (with weights)
  // -------------------------------------------------------------------------
  else if (msg.type === 'NOTION_ENRICHED_RULES') {
    notionEnrichedRules = msg.rules || [];
    console.log(`[Notion] Received ${notionEnrichedRules.length} enriched rules`);
    const matching = notionEnrichedRules.filter((r: any) => r.matchesActiveFile).length;
    const highWeight = notionEnrichedRules.filter((r: any) => r.contextWeight >= 0.6).length;
    figma.notify(`📋 ${notionEnrichedRules.length} Notion rules loaded (${matching} match scope, ${highWeight} high-weight)`);
  }

  // -------------------------------------------------------------------------
  // NOTION COMPLIANCE RESULT: Receive verification data from UI
  // -------------------------------------------------------------------------
  else if (msg.type === 'NOTION_COMPLIANCE_RESULT') {
    const reqId = msg.requestId;
    const pending = notionPendingCompliance.get(reqId);
    if (pending) {
      pending.resolve(msg.results || {});
      notionPendingCompliance.delete(reqId);
    }
  }

  // -------------------------------------------------------------------------
  // MCP CONNECTED: Store connection state for scan enrichment
  // -------------------------------------------------------------------------
  else if (msg.type === 'MCP_CONNECTED') {
    mcpConnected = true;
    mcpEndpoint = msg.endpoint || '';
    console.log('[MCP] Connected to:', mcpEndpoint);
  }

  // -------------------------------------------------------------------------
  // MCP DISCONNECTED: Clear connection state
  // -------------------------------------------------------------------------
  else if (msg.type === 'MCP_DISCONNECTED') {
    mcpConnected = false;
    mcpEndpoint = '';
    mcpEnrichmentCache.clear();
    console.log('[MCP] Disconnected');
  }

  // -------------------------------------------------------------------------
  // MCP ENRICH RESULT: Receive enrichment data from UI
  // -------------------------------------------------------------------------
  else if (msg.type === 'MCP_ENRICH_RESULT') {
    const reqId = msg.requestId;
    const pending = mcpPendingEnrichments.get(reqId);
    if (pending) {
      pending.resolve(msg.results || {});
      mcpPendingEnrichments.delete(reqId);
    }
  }

  // -------------------------------------------------------------------------
  // RUN MATURITY ANALYSIS
  // -------------------------------------------------------------------------
  else if (msg.type === 'RUN_MATURITY_ANALYSIS') {
    const componentLibJSON: ComponentLibraryJSON | null = msg.componentLibraryJSON || null;

    try {
      const [variables, collections] = await Promise.all([
        figma.variables.getLocalVariablesAsync(),
        figma.variables.getLocalVariableCollectionsAsync(),
      ]);

      const collectionNames: Record<string, string> = {};
      for (const col of collections) {
        collectionNames[col.id] = col.name;
      }

      const revIndex = componentLibJSON ? buildReverseIndex(componentLibJSON) : {};
      reverseIndexCache = revIndex;

      const scored = [];
      for (const v of variables) {
        const collName = collectionNames[v.variableCollectionId] || '';
        const revEntry = revIndex[v.name] || null;
        try {
          const result = scoreToken(v as any, collName, revEntry, currentRubric);
          scored.push(result);
        } catch (scoreErr) {
          console.error('Score error for ' + v.name + ':', scoreErr);
        }
      }

      let totalScore = 0;
      const byTier: Record<string, number> = { good: 0, fair: 0, 'needs-work': 0 };
      const byCollection: Record<string, { count: number; totalScore: number }> = {};

      for (const item of scored) {
        totalScore += item.score;
        byTier[item.tier] = (byTier[item.tier] || 0) + 1;
        const coll = item.collectionName || 'Unknown';
        if (!byCollection[coll]) byCollection[coll] = { count: 0, totalScore: 0 };
        byCollection[coll].count++;
        byCollection[coll].totalScore += item.score;
      }

      figma.ui.postMessage({
        type: 'MATURITY_ANALYSIS_RESULT',
        summary: {
          totalTokens: scored.length,
          avgScore: scored.length ? Math.round(totalScore / scored.length) : 0,
          byTier,
          byCollection,
        },
        scored,
      });
    } catch (err: unknown) {
      figma.ui.postMessage({
        type: 'MATURITY_ANALYSIS_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // CLOSE PLUGIN
  // -------------------------------------------------------------------------
  else if (msg.type === 'NOTIFY') {
    if (typeof (msg as any).message === 'string') figma.notify((msg as any).message);
  }
  else if (msg.type === 'RUN_DS_MATURITY_ENGINE') {
    const auditsForEngine = (msg as any).audits as ComponentAudit[] | undefined;
    if (!auditsForEngine || !Array.isArray(auditsForEngine)) {
      figma.ui.postMessage({ type: 'DS_MATURITY_REPORT', error: 'Missing or invalid audits' });
      return;
    }
    try {
      const raw = rawInputFromAudits(auditsForEngine);
      const report = runPipeline(raw);
      figma.ui.postMessage({ type: 'DS_MATURITY_REPORT', report });
    } catch (err) {
      figma.ui.postMessage({
        type: 'DS_MATURITY_REPORT',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // ── USAGE DESCRIPTION GENERATOR ─────────────────────────────────────────
  else if (msg.type === 'START_USAGE_SCAN') {
    const forceRefresh = (msg as { forceRefresh?: boolean }).forceRefresh ?? false;

    if (!forceRefresh) {
      const cached = await getCachedUsageScan();
      if (cached) {
        figma.ui.postMessage({ type: 'USAGE_SCAN_COMPLETE', payload: { ...(cached as object), fromCache: true } });
        return;
      }
    }

    const start = Date.now();

    try {
      // Step 1: Load variables + collections
      figma.ui.postMessage({ type: 'USAGE_SCAN_PROGRESS', payload: { phase: 'Loading variables…', current: 0, total: 4 } });
      const { variables, collections, varById, collectionById } = await buildVariableRegistry();

      if (variables.length === 0) {
        figma.ui.postMessage({ type: 'USAGE_SCAN_COMPLETE', payload: { variables: [], collections: [], usageProfiles: {}, candidates: [], scanDurationMs: 0, pagesScanned: [], totalBindings: 0, externalLibraryVarCount: 0 } });
        return;
      }

      // Step 2: Walk document
      figma.ui.postMessage({ type: 'USAGE_SCAN_PROGRESS', payload: { phase: 'Walking document…', current: 1, total: 4 } });
      const knownVarIds = new Set(variables.map(v => v.id));
      const { bindings, externalVarIds, pagesScanned } = await walkDocument({
        knownVarIds,
        onProgress: (_scanned, page) => {
          figma.ui.postMessage({ type: 'USAGE_SCAN_PROGRESS', payload: { phase: `Scanning ${page}…`, current: 2, total: 4 } });
        },
      });

      // Step 3: Build usage profiles
      figma.ui.postMessage({ type: 'USAGE_SCAN_PROGRESS', payload: { phase: 'Building profiles…', current: 3, total: 4 } });
      const usageProfiles = buildUsageProfiles(variables, bindings, varById);

      // Step 4: Generate rule-based descriptions + flag AI candidates
      const candidates: DescriptionCandidate[] = variables.map(v => {
        const profile = usageProfiles[v.id];
        const collection = collectionById[v.variableCollectionId];
        const collectionName = collection?.name ?? 'Unknown Collection';
        const { description, confidence } = generateRuleBasedDescription(v, profile);
        const needsAI = shouldUseAI(profile);
        return {
          variable: v,
          profile,
          collectionName,
          generatedDescription: description,
          source: (profile.position === 'unused' ? 'unused-flag' : 'rule-based') as DescriptionCandidate['source'],
          confidence,
          needsAI,
          approved: false,
          edited: false,
        };
      });

      const payload: ScanPayload = {
        variables,
        collections,
        usageProfiles,
        candidates,
        scanDurationMs: Date.now() - start,
        pagesScanned,
        totalBindings: bindings.length,
        externalLibraryVarCount: externalVarIds.size,
      };

      await saveUsageScanCache(payload);
      figma.ui.postMessage({ type: 'USAGE_SCAN_COMPLETE', payload });
    } catch (err: unknown) {
      figma.ui.postMessage({
        type: 'USAGE_SCAN_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  else if (msg.type === 'WRITE_USAGE_DESCRIPTIONS') {
    const items = (msg as { payload: Array<{ varId: string; description: string }> }).payload;
    try {
      const result = await writeDescriptions(items);
      figma.ui.postMessage({ type: 'USAGE_WRITE_COMPLETE', payload: result });
    } catch (err: unknown) {
      figma.ui.postMessage({
        type: 'USAGE_WRITE_COMPLETE',
        payload: { written: 0, errors: [{ varId: '', error: err instanceof Error ? err.message : String(err) }] },
      });
    }
  }

  // ── DESIGN SCAN FOR RULES ────────────────────────────────────────────────
  else if (msg.type === 'SCAN_DESIGN_FOR_RULES') {
    const options = (msg as any).options ?? { scanFrames: true, scanComponents: true, pages: [], maxNodes: 5000 };
    try {
      figma.ui.postMessage({ type: 'DESIGN_SCAN_PROGRESS', phase: 'Loading variables…' });
      const aggregated = await scanForTokenUsage(options);
      figma.ui.postMessage({ type: 'DESIGN_SCAN_COMPLETE', aggregated });
    } catch (err: unknown) {
      figma.ui.postMessage({
        type: 'DESIGN_SCAN_ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── SAVE / LOAD ENRICHED RULES ───────────────────────────────────────────
  else if (msg.type === 'SAVE_ENRICHED_RULES') {
    try {
      await figma.clientStorage.setAsync('dsccEnrichedRules', JSON.stringify((msg as any).rules ?? []));
    } catch { /* swallow */ }
  }
  else if (msg.type === 'GET_ENRICHED_RULES') {
    try {
      const raw = await figma.clientStorage.getAsync('dsccEnrichedRules');
      const rules = raw ? JSON.parse(raw) : [];
      figma.ui.postMessage({ type: 'ENRICHED_RULES_LOADED', rules });
    } catch {
      figma.ui.postMessage({ type: 'ENRICHED_RULES_LOADED', rules: [] });
    }
  }
  else if (msg.type === 'SAVE_BAKED_RULES') {
    try {
      const payload = msg as { rules?: unknown[]; ruleSummary?: { summaryText?: string; bySource?: Record<string, { pattern: string; meaning: string }[]>; usageGuidance?: string } };
      const rules = payload.rules ?? [];
      await figma.clientStorage.setAsync('dsccBakedRules', JSON.stringify(rules));
      if (payload.ruleSummary) {
        await figma.clientStorage.setAsync('dsccBakedRuleSummary', JSON.stringify(payload.ruleSummary));
      }
      cachedBakedRules = null;
      figma.ui.postMessage({
        type: 'BAKED_RULES_SAVED',
        success: true,
        rulesCount: Array.isArray(rules) ? rules.length : 0,
        ruleSummary: payload.ruleSummary || null,
      });
    } catch (e) {
      figma.ui.postMessage({
        type: 'BAKED_RULES_SAVED',
        success: false,
        error: e instanceof Error ? e.message : 'Failed to save baked rules',
      });
    }
  }
  else if (msg.type === 'GET_BAKED_RULES_AND_SUMMARY') {
    try {
      const rulesRaw = await figma.clientStorage.getAsync('dsccBakedRules');
      const summaryRaw = await figma.clientStorage.getAsync('dsccBakedRuleSummary');
      const rules = rulesRaw ? JSON.parse(rulesRaw) : [];
      const ruleSummary = summaryRaw ? JSON.parse(summaryRaw) : null;
      figma.ui.postMessage({ type: 'BAKED_RULES_AND_SUMMARY_LOADED', rules, ruleSummary });
    } catch {
      figma.ui.postMessage({ type: 'BAKED_RULES_AND_SUMMARY_LOADED', rules: [], ruleSummary: null });
    }
  }
  else if (msg.type === 'SAVE_SAVED_SCANS') {
    try {
      await figma.clientStorage.setAsync('dsccSavedScans', JSON.stringify((msg as any).scans ?? []));
    } catch { /* swallow */ }
  }
  else if (msg.type === 'GET_SAVED_SCANS') {
    try {
      const raw = await figma.clientStorage.getAsync('dsccSavedScans');
      const scans = raw ? JSON.parse(raw) : [];
      figma.ui.postMessage({ type: 'SAVED_SCANS_LOADED', scans });
    } catch {
      figma.ui.postMessage({ type: 'SAVED_SCANS_LOADED', scans: [] });
    }
  }
  else if (msg.type === 'SAVE_AI_MODEL') {
    try {
      await figma.clientStorage.setAsync('dsccAIModel', (msg as any).model ?? 'claude-sonnet-4-6');
    } catch { /* swallow */ }
  }
  else if (msg.type === 'GET_AI_MODEL') {
    try {
      const model = await figma.clientStorage.getAsync('dsccAIModel');
      figma.ui.postMessage({ type: 'AI_MODEL_LOADED', model: model || 'claude-sonnet-4-6' });
    } catch {
      figma.ui.postMessage({ type: 'AI_MODEL_LOADED', model: 'claude-sonnet-4-6' });
    }
  }

  // ── AI DESIGN ANALYSIS / Design Intelligence Scan ───────────────────────
  else if (msg.type === 'RUN_AI_DESIGN_ANALYSIS') {
    const nodes = [...figma.currentPage.selection];
    const rawMode = (msg as { mode?: string }).mode;
    const mode = rawMode === 'data' ? 'data' : rawMode === 'full' ? 'full' : 'screenshot';
    if (!nodes.length) {
      figma.ui.postMessage({ type: 'AI_ANALYSIS_ERROR', error: 'No selection. Select a Frame or Component first.' });
      return;
    }
    const node = nodes[0];
    const allowedTypes = ['FRAME', 'COMPONENT', 'SECTION', 'COMPONENT_SET'];
    if (!allowedTypes.includes(node.type)) {
      figma.ui.postMessage({ type: 'AI_ANALYSIS_ERROR', error: 'Please select a Frame, Component, or Section.' });
      return;
    }
    try {
      let imageB64: string | null = null;
      const doScreenshot = mode === 'screenshot' || mode === 'full';
      if (doScreenshot) {
        figma.ui.postMessage({ type: 'AI_ANALYSIS_PROGRESS', phase: 'Capturing screenshot…' });
        try {
          const w = (node as { width?: number }).width ?? 0;
          const h = (node as { height?: number }).height ?? 0;
          const pixels = w * h;
          const scale = pixels > 2_000_000 ? 1 : pixels > 1_000_000 ? 1.2 : 1.5;
          const bytes = await (node as SceneNode & ExportMixin).exportAsync({
            format: 'PNG',
            constraint: { type: 'SCALE', value: scale },
          });
          imageB64 = figma.base64Encode(bytes);
        } catch { /* proceed without screenshot */ }
      }

      const doFullData = mode === 'data' || mode === 'full';
      figma.ui.postMessage({ type: 'AI_ANALYSIS_PROGRESS', phase: 'Extracting layers…' });
      const layerLimit = doFullData ? 20 : 5;
      const depthLimit = doFullData ? 5 : 0;
      const layers = nodes.slice(0, layerLimit).map(n => extractAINodeMeta(n as SceneNode, depthLimit));

      let tokens: Array<{ name: string; id: string; resolvedType: string }> = [];
      let values: Array<{ variableName: string; value: unknown }> = [];
      let structuralData: DesignIntelligenceNode | null = null;
      if (doFullData) {
        figma.ui.postMessage({ type: 'AI_ANALYSIS_PROGRESS', phase: 'Collecting tokens and structure…' });
        const allVars = await figma.variables.getLocalVariablesAsync();
        const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
        const collMap = new Map(allCollections.map(c => [c.id, c]));
        const varMap = new Map(allVars.map(v => [v.id, v]));
        tokens = allVars.slice(0, 80).map(v => {
          const coll = collMap.get(v.variableCollectionId);
          return { name: (coll ? coll.name + '/' : '') + v.name, id: v.id, resolvedType: v.resolvedType };
        });
        const boundIds = new Set<string>();
        function collectBoundIds(n: SceneNode) {
          const no = n as { boundVariables?: Record<string, unknown> };
          if (no.boundVariables) {
            for (const binding of Object.values(no.boundVariables)) {
              const arr = Array.isArray(binding) ? binding : [binding];
              for (const b of arr) {
                if (b && (b as { type?: string }).type === 'VARIABLE_ALIAS') boundIds.add((b as { id: string }).id);
              }
            }
          }
          if ('children' in n) (n as ChildrenMixin).children.forEach(collectBoundIds);
        }
        nodes.forEach(n => collectBoundIds(n as SceneNode));
        const boundIdList = [...boundIds];
        for (let i = 0; i < Math.min(boundIdList.length, 80); i++) {
          const id = boundIdList[i];
          const v = varMap.get(id);
          if (!v) continue;
          const coll = collMap.get(v.variableCollectionId);
          const variableName = (coll ? coll.name + '/' : '') + v.name;
          let value: unknown = null;
          if (v.resolvedType === 'FLOAT') value = v.valuesByMode[Object.keys(v.valuesByMode)[0]];
          else if (v.resolvedType === 'STRING') value = v.valuesByMode[Object.keys(v.valuesByMode)[0]];
          else if (v.resolvedType === 'BOOLEAN') value = v.valuesByMode[Object.keys(v.valuesByMode)[0]];
          else if (v.resolvedType === 'COLOR') value = v.valuesByMode[Object.keys(v.valuesByMode)[0]];
          values.push({ variableName, value });
        }
        const nodeCount = { current: 0 };
        structuralData = extractDesignIntelligenceStructure(node as SceneNode, 0, DESIGN_INTELLIGENCE_MAX_DEPTH, varMap, collMap, nodeCount);
      }

      figma.ui.postMessage({
        type: 'AI_ANALYSIS_DATA',
        image: imageB64,
        layers,
        selectionName: nodes.map(n => n.name).join(', '),
        selectionCount: nodes.length,
        mode,
        tokens: doFullData ? tokens : undefined,
        values: doFullData ? values : undefined,
        structuralData: structuralData ?? undefined,
      });
    } catch (err: unknown) {
      figma.ui.postMessage({ type: 'AI_ANALYSIS_ERROR', error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // DESKTOP BRIDGE — all handlers below are called by the WebSocket MCP client
  // -------------------------------------------------------------------------
  else if (msg.type === 'EXECUTE_CODE') {
    const m = msg as any;
    try {
      const timeoutMs = m.timeout || 5000;
      const wrappedCode = '(async function() {\n' + m.code + '\n})()';
      let codePromise: Promise<unknown>;
      try { codePromise = eval(wrappedCode); }
      catch (se: unknown) {
        const sm = se instanceof Error ? se.message : String(se);
        figma.ui.postMessage({ type: 'EXECUTE_CODE_RESULT', requestId: m.requestId, success: false, error: 'Syntax error: ' + sm });
        return;
      }
      const timeoutP = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timed out after ' + timeoutMs + 'ms')), timeoutMs));
      const result = await Promise.race([codePromise, timeoutP]);
      const ra: Record<string, unknown> = { type: typeof result, warning: null };
      if (Array.isArray(result) && result.length === 0) ra.warning = 'Code returned an empty array.';
      else if (result === null) ra.warning = 'Code returned null.';
      else if (result === undefined) ra.warning = 'Code returned undefined.';
      figma.ui.postMessage({ type: 'EXECUTE_CODE_RESULT', requestId: m.requestId, success: true, result, resultAnalysis: ra, fileContext: { fileName: figma.root.name, fileKey: figma.fileKey || null } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'EXECUTE_CODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'UPDATE_VARIABLE') {
    const m = msg as any;
    try {
      const variable = await figma.variables.getVariableByIdAsync(m.variableId);
      if (!variable) throw new Error('Variable not found: ' + m.variableId);
      let value = m.value;
      const isAliasObj =
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as { type?: string }).type === 'VARIABLE_ALIAS' &&
        typeof (value as { id?: string }).id === 'string';
      if (isAliasObj) {
        /* structured-clone object from UI — use as-is */
      } else if (typeof value === 'string' && value.startsWith('VariableID:')) {
        value = { type: 'VARIABLE_ALIAS', id: value };
      } else if (variable.resolvedType === 'COLOR' && typeof value === 'string') {
        value = _dbHexToRGB(value);
      }
      const coll = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
      const useAllModes = m.allModes === true || (coll && coll.name === '.breakpoint');
      const modeIds =
        coll && useAllModes ? coll.modes.map(mod => mod.modeId) : [m.modeId as string];

      // ── Snapshot current values BEFORE overwriting (wizard undo) ──
      // We snapshot ALL modes that will be modified so undo restores them all.
      const snapEntries: Array<{ id: string; modeId: string; value: RGBA | VariableAlias | undefined }> = [];
      for (const modeId of modeIds) {
        snapEntries.push({
          id: variable.id,
          modeId,
          value: variable.valuesByMode[modeId] as RGBA | VariableAlias | undefined,
        });
      }
      _wizSnapshots.push({ label: `var/${variable.name}`, vars: snapEntries });
      if (_wizSnapshots.length > 5) _wizSnapshots.shift();
      console.log('[wizard-undo] snapshot pushed (UPDATE_VARIABLE):', variable.name, 'modes=' + modeIds.length, 'stack=' + _wizSnapshots.length);
      figma.ui.postMessage({ type: 'WIZARD_UNDO_COUNT', count: _wizSnapshots.length });

      for (const modeId of modeIds) {
        variable.setValueForMode(modeId, value);
      }
      figma.ui.postMessage({ type: 'UPDATE_VARIABLE_RESULT', requestId: m.requestId, success: true, variable: _dbSerializeVariable(variable) });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'UPDATE_VARIABLE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CREATE_VARIABLE') {
    const m = msg as any;
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(m.collectionId);
      if (!collection) throw new Error('Collection not found: ' + m.collectionId);
      const variable = figma.variables.createVariable(m.name, collection, m.resolvedType);
      if (m.valuesByMode) {
        for (const modeId of Object.keys(m.valuesByMode)) {
          let v = m.valuesByMode[modeId];
          if (m.resolvedType === 'COLOR' && typeof v === 'string') v = _dbHexToRGB(v);
          variable.setValueForMode(modeId, v);
        }
        if (collection.name === '.breakpoint') {
          const keys = Object.keys(m.valuesByMode);
          if (keys.length > 0) {
            const seedKey = keys[0];
            let seedVal: unknown = m.valuesByMode[seedKey];
            if (typeof seedVal === 'string' && seedVal.startsWith('VariableID:')) {
              seedVal = { type: 'VARIABLE_ALIAS', id: seedVal };
            } else if (m.resolvedType === 'COLOR' && typeof seedVal === 'string') {
              seedVal = _dbHexToRGB(seedVal);
            }
            for (const mod of collection.modes) {
              if (!Object.prototype.hasOwnProperty.call(m.valuesByMode, mod.modeId)) {
                variable.setValueForMode(mod.modeId, seedVal as VariableValue);
              }
            }
          }
        }
      }
      if (m.description) variable.description = m.description;
      if (m.scopes) variable.scopes = m.scopes;
      figma.ui.postMessage({ type: 'CREATE_VARIABLE_RESULT', requestId: m.requestId, success: true, variable: _dbSerializeVariable(variable) });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'CREATE_VARIABLE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CREATE_VARIABLE_COLLECTION') {
    const m = msg as any;
    try {
      const collection = figma.variables.createVariableCollection(m.name);
      if (m.initialModeName && collection.modes.length > 0) collection.renameMode(collection.modes[0].modeId, m.initialModeName);
      if (m.additionalModes) for (const mode of m.additionalModes) collection.addMode(mode);
      figma.ui.postMessage({ type: 'CREATE_VARIABLE_COLLECTION_RESULT', requestId: m.requestId, success: true, collection: _dbSerializeCollection(collection) });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'CREATE_VARIABLE_COLLECTION_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'DELETE_VARIABLE') {
    const m = msg as any;
    try {
      const variable = await figma.variables.getVariableByIdAsync(m.variableId);
      if (!variable) throw new Error('Variable not found: ' + m.variableId);
      const deleted = { id: variable.id, name: variable.name };
      variable.remove();
      figma.ui.postMessage({ type: 'DELETE_VARIABLE_RESULT', requestId: m.requestId, success: true, deleted });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'DELETE_VARIABLE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'DELETE_VARIABLE_COLLECTION') {
    const m = msg as any;
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(m.collectionId);
      if (!collection) throw new Error('Collection not found: ' + m.collectionId);
      const deleted = { id: collection.id, name: collection.name, variableCount: collection.variableIds.length };
      collection.remove();
      figma.ui.postMessage({ type: 'DELETE_VARIABLE_COLLECTION_RESULT', requestId: m.requestId, success: true, deleted });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'DELETE_VARIABLE_COLLECTION_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'RENAME_VARIABLE') {
    const m = msg as any;
    try {
      const variable = await figma.variables.getVariableByIdAsync(m.variableId);
      if (!variable) throw new Error('Variable not found: ' + m.variableId);
      const oldName = variable.name;
      variable.name = m.newName;
      const s = { ..._dbSerializeVariable(variable), oldName };
      figma.ui.postMessage({ type: 'RENAME_VARIABLE_RESULT', requestId: m.requestId, success: true, variable: s, oldName });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'RENAME_VARIABLE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_VARIABLE_DESCRIPTION') {
    const m = msg as any;
    try {
      const variable = await figma.variables.getVariableByIdAsync(m.variableId);
      if (!variable) throw new Error('Variable not found: ' + m.variableId);
      variable.description = m.description || '';
      figma.ui.postMessage({ type: 'SET_VARIABLE_DESCRIPTION_RESULT', requestId: m.requestId, success: true, variable: _dbSerializeVariable(variable) });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_VARIABLE_DESCRIPTION_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'ADD_MODE') {
    const m = msg as any;
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(m.collectionId);
      if (!collection) throw new Error('Collection not found: ' + m.collectionId);
      const newModeId = collection.addMode(m.modeName);
      figma.ui.postMessage({ type: 'ADD_MODE_RESULT', requestId: m.requestId, success: true, collection: _dbSerializeCollection(collection), newMode: { modeId: newModeId, name: m.modeName } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'ADD_MODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'RENAME_MODE') {
    const m = msg as any;
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(m.collectionId);
      if (!collection) throw new Error('Collection not found: ' + m.collectionId);
      const currentMode = collection.modes.find(md => md.modeId === m.modeId);
      if (!currentMode) throw new Error('Mode not found: ' + m.modeId);
      const oldName = currentMode.name;
      collection.renameMode(m.modeId, m.newName);
      figma.ui.postMessage({ type: 'RENAME_MODE_RESULT', requestId: m.requestId, success: true, collection: { ..._dbSerializeCollection(collection), oldName }, oldName });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'RENAME_MODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'REFRESH_VARIABLES') {
    const m = msg as any;
    try {
      const vars = await figma.variables.getLocalVariablesAsync();
      const colls = await figma.variables.getLocalVariableCollectionsAsync();
      const data = { success: true, timestamp: Date.now(), fileKey: figma.fileKey || null, variables: vars.map(_dbSerializeVariable), variableCollections: colls.map(_dbSerializeCollection) };
      figma.ui.postMessage({ type: 'VARIABLES_DATA', data });
      figma.ui.postMessage({ type: 'REFRESH_VARIABLES_RESULT', requestId: m.requestId, success: true, data });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'REFRESH_VARIABLES_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'GET_COMPONENT') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET' && node.type !== 'INSTANCE') throw new Error('Node is not a component. Type: ' + node.type);
      const cn = node as ComponentNode | ComponentSetNode | InstanceNode;
      const isVariant = cn.type === 'COMPONENT' && cn.parent && cn.parent.type === 'COMPONENT_SET';
      figma.ui.postMessage({
        type: 'COMPONENT_DATA', requestId: m.requestId,
        data: {
          success: true, timestamp: Date.now(), nodeId: m.nodeId,
          component: {
            id: cn.id, name: cn.name, type: cn.type,
            description: (cn as any).description || null, descriptionMarkdown: (cn as any).descriptionMarkdown || null,
            visible: cn.visible, locked: (cn as any).locked, annotations: (cn as any).annotations || [],
            isVariant,
            componentPropertyDefinitions: (cn.type === 'COMPONENT_SET' || (cn.type === 'COMPONENT' && !isVariant)) ? (cn as any).componentPropertyDefinitions : undefined,
            children: (cn as any).children ? (cn as any).children.map((c: SceneNode) => ({ id: c.id, name: c.name, type: c.type })) : undefined
          }
        }
      });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'COMPONENT_ERROR', requestId: m.requestId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'GET_LOCAL_COMPONENTS') {
    const m = msg as any;
    try {
      const components: unknown[] = [];
      const componentSets: unknown[] = [];
      function _extractComp(node: ComponentNode) {
        const d: Record<string, unknown> = { key: node.key, nodeId: node.id, name: node.name, type: node.type, description: node.description || null, width: node.width, height: node.height };
        if (node.componentPropertyDefinitions) {
          d.properties = Object.entries(node.componentPropertyDefinitions).map(([k, v]) => ({ name: k, type: (v as any).type, defaultValue: (v as any).defaultValue }));
        }
        return d;
      }
      function _extractSet(node: ComponentSetNode) {
        const variantAxes: Record<string, string[]> = {};
        const variants: unknown[] = [];
        if (node.children) {
          for (const child of node.children as ComponentNode[]) {
            const vp: Record<string, string> = {};
            child.name.split(',').forEach(p => { const kv = p.trim().split('='); if (kv.length === 2) { const k = kv[0].trim(), v = kv[1].trim(); vp[k] = v; if (!variantAxes[k]) variantAxes[k] = []; if (!variantAxes[k].includes(v)) variantAxes[k].push(v); } });
            variants.push({ key: child.key, nodeId: child.id, name: child.name, description: child.description || null, variantProperties: vp, width: child.width, height: child.height });
          }
        }
        return { key: node.key, nodeId: node.id, name: node.name, type: 'COMPONENT_SET', description: node.description || null, variantAxes: Object.entries(variantAxes).map(([n, v]) => ({ name: n, values: v })), variants, defaultVariant: variants[0] || null, properties: node.componentPropertyDefinitions ? Object.entries(node.componentPropertyDefinitions).map(([k, v]) => ({ name: k, type: (v as any).type, defaultValue: (v as any).defaultValue })) : [] };
      }
      function _findComps(node: BaseNode) {
        if ((node as any).type === 'COMPONENT_SET') { componentSets.push(_extractSet(node as ComponentSetNode)); }
        else if ((node as any).type === 'COMPONENT' && (!( node as SceneNode).parent || (node as SceneNode).parent!.type !== 'COMPONENT_SET')) { components.push(_extractComp(node as ComponentNode)); }
        if ((node as any).children) for (const c of (node as any).children) _findComps(c);
      }
      await figma.loadAllPagesAsync();
      for (const page of figma.root.children) _findComps(page);
      figma.ui.postMessage({ type: 'GET_LOCAL_COMPONENTS_RESULT', requestId: m.requestId, success: true, data: { components, componentSets, totalComponents: components.length, totalComponentSets: componentSets.length, fileName: figma.root.name, fileKey: figma.fileKey || null, timestamp: Date.now() } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'GET_LOCAL_COMPONENTS_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'INSTANTIATE_COMPONENT') {
    const m = msg as any;
    try {
      let component: ComponentNode | null = null;
      if (m.componentKey) { try { component = await figma.importComponentByKeyAsync(m.componentKey); } catch { /* try local */ } }
      if (!component && m.nodeId) {
        const n = await figma.getNodeByIdAsync(m.nodeId);
        if (n) {
          if (n.type === 'COMPONENT') { component = n as ComponentNode; }
          else if (n.type === 'COMPONENT_SET') {
            const cs = n as ComponentSetNode;
            if (m.variant && cs.children) {
              const targetName = Object.entries(m.variant).map(([k, v]) => k+'='+v).join(', ');
              component = (cs.children as ComponentNode[]).find(c => c.name === targetName) || null;
              if (!component) component = (cs.children as ComponentNode[]).find(c => Object.entries(m.variant).every(([k,v]) => c.name.includes(k+'='+v as string))) || null;
            }
            if (!component && cs.children && cs.children.length > 0) component = cs.children[0] as ComponentNode;
          }
        }
      }
      if (!component) throw new Error('Component not found. Use figma_search_components to get fresh identifiers.');
      const instance = component.createInstance();
      if (m.position) { instance.x = m.position.x || 0; instance.y = m.position.y || 0; }
      if (m.size) instance.resize(m.size.width, m.size.height);
      if (m.overrides) { for (const [k, v] of Object.entries(m.overrides)) { try { instance.setProperties({ [k]: v as string | boolean }); } catch { /* skip */ } } }
      if (m.variant) { try { instance.setProperties(m.variant); } catch { /* skip */ } }
      if (m.parentId) { const par = await figma.getNodeByIdAsync(m.parentId); if (par && 'appendChild' in par) (par as ChildrenMixin).appendChild(instance); }
      figma.ui.postMessage({ type: 'INSTANTIATE_COMPONENT_RESULT', requestId: m.requestId, success: true, instance: { id: instance.id, name: instance.name, x: instance.x, y: instance.y, width: instance.width, height: instance.height } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'INSTANTIATE_COMPONENT_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_NODE_DESCRIPTION') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('description' in node)) throw new Error('Node type ' + (node as any).type + ' does not support description');
      (node as any).description = m.description || '';
      if (m.descriptionMarkdown && 'descriptionMarkdown' in node) (node as any).descriptionMarkdown = m.descriptionMarkdown;
      figma.ui.postMessage({ type: 'SET_NODE_DESCRIPTION_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: (node as SceneNode).name, description: (node as any).description } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_NODE_DESCRIPTION_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'APPLY_COMP_CONTEXT') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') throw new Error('Node must be COMPONENT or COMPONENT_SET');
      if (m.description !== undefined && 'description' in node) (node as any).description = m.description;
      if (m.documentationLink !== undefined && 'documentationLinks' in node) {
        (node as any).documentationLinks = m.documentationLink ? [{ uri: m.documentationLink }] : [];
      }
      figma.ui.postMessage({ type: 'APPLY_COMP_CONTEXT_RESULT', success: true });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'APPLY_COMP_CONTEXT_RESULT', success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'ADD_COMPONENT_PROPERTY') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') throw new Error('Node must be COMPONENT or COMPONENT_SET');
      if (node.type === 'COMPONENT' && (node as ComponentNode).parent && (node as ComponentNode).parent!.type === 'COMPONENT_SET') throw new Error('Cannot add properties to variant components.');
      const options = m.preferredValues ? { preferredValues: m.preferredValues } : undefined;
      const propName = (node as ComponentNode | ComponentSetNode).addComponentProperty(m.propertyName, m.propertyType, m.defaultValue, options as any);
      figma.ui.postMessage({ type: 'ADD_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: true, propertyName: propName });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'ADD_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'EDIT_COMPONENT_PROPERTY') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') throw new Error('Node must be COMPONENT or COMPONENT_SET');
      const propName = (node as ComponentNode | ComponentSetNode).editComponentProperty(m.propertyName, m.newValue);
      figma.ui.postMessage({ type: 'EDIT_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: true, propertyName: propName });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'EDIT_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'DELETE_COMPONENT_PROPERTY') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') throw new Error('Node must be COMPONENT or COMPONENT_SET');
      (node as ComponentNode | ComponentSetNode).deleteComponentProperty(m.propertyName);
      figma.ui.postMessage({ type: 'DELETE_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: true });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'DELETE_COMPONENT_PROPERTY_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'RESIZE_NODE') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId);
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('resize' in node)) throw new Error('Node type does not support resize');
      const n = node as SceneNode & { resize: (w: number, h: number) => void; resizeWithoutConstraints: (w: number, h: number) => void; width: number; height: number };
      if (m.withConstraints !== false) n.resize(m.width, m.height); else n.resizeWithoutConstraints(m.width, m.height);
      figma.ui.postMessage({ type: 'RESIZE_NODE_RESULT', requestId: m.requestId, success: true, node: { id: n.id, name: n.name, width: n.width, height: n.height } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'RESIZE_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'MOVE_NODE') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('x' in node)) throw new Error('Node does not support positioning');
      node.x = m.x; node.y = m.y;
      figma.ui.postMessage({ type: 'MOVE_NODE_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name, x: node.x, y: node.y } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'MOVE_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_NODE_FILLS') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('fills' in node)) throw new Error('Node does not support fills');
      node.fills = (m.fills as any[]).map(f => {
        if (f.type === 'SOLID' && typeof f.color === 'string') { const c = _dbHexToRGB(f.color); return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a !== undefined ? c.a : (f.opacity ?? 1) }; }
        return f;
      });
      figma.ui.postMessage({ type: 'SET_NODE_FILLS_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_NODE_FILLS_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_NODE_STROKES') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('strokes' in node)) throw new Error('Node does not support strokes');
      node.strokes = (m.strokes as any[]).map(s => {
        if (s.type === 'SOLID' && typeof s.color === 'string') { const c = _dbHexToRGB(s.color); return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a ?? (s.opacity ?? 1) }; }
        return s;
      });
      if (m.strokeWeight !== undefined) node.strokeWeight = m.strokeWeight;
      figma.ui.postMessage({ type: 'SET_NODE_STROKES_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_NODE_STROKES_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_NODE_OPACITY') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('opacity' in node)) throw new Error('Node does not support opacity');
      node.opacity = Math.max(0, Math.min(1, m.opacity));
      figma.ui.postMessage({ type: 'SET_NODE_OPACITY_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name, opacity: node.opacity } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_NODE_OPACITY_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_NODE_CORNER_RADIUS') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('cornerRadius' in node)) throw new Error('Node does not support cornerRadius');
      node.cornerRadius = m.radius;
      figma.ui.postMessage({ type: 'SET_NODE_CORNER_RADIUS_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name, cornerRadius: node.cornerRadius } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_NODE_CORNER_RADIUS_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CLONE_NODE') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('clone' in node)) throw new Error('Node does not support cloning');
      const cloned = node.clone();
      figma.ui.postMessage({ type: 'CLONE_NODE_RESULT', requestId: m.requestId, success: true, node: { id: cloned.id, name: cloned.name, x: cloned.x, y: cloned.y } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'CLONE_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'DELETE_NODE') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      const deleted = { id: node.id, name: node.name };
      node.remove();
      figma.ui.postMessage({ type: 'DELETE_NODE_RESULT', requestId: m.requestId, success: true, deleted });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'DELETE_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'RENAME_NODE') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      const oldName = node.name;
      node.name = m.newName;
      figma.ui.postMessage({ type: 'RENAME_NODE_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name, oldName } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'RENAME_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'SET_TEXT_CONTENT') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'TEXT') throw new Error('Node must be TEXT. Got: ' + node.type);
      await figma.loadFontAsync(node.fontName);
      node.characters = m.text;
      if (m.fontSize) node.fontSize = m.fontSize;
      figma.ui.postMessage({ type: 'SET_TEXT_CONTENT_RESULT', requestId: m.requestId, success: true, node: { id: node.id, name: node.name, characters: node.characters } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_TEXT_CONTENT_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CREATE_CHILD_NODE') {
    const m = msg as any;
    try {
      const parent = await figma.getNodeByIdAsync(m.parentId) as any;
      if (!parent) throw new Error('Parent not found: ' + m.parentId);
      if (!('appendChild' in parent)) throw new Error('Parent does not support children');
      const props = m.properties || {};
      let newNode: any;
      switch (m.nodeType) {
        case 'RECTANGLE': newNode = figma.createRectangle(); break;
        case 'ELLIPSE': newNode = figma.createEllipse(); break;
        case 'FRAME': newNode = figma.createFrame(); break;
        case 'TEXT': newNode = figma.createText(); await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); newNode.fontName = { family: 'Inter', style: 'Regular' }; if (props.text) newNode.characters = props.text; break;
        case 'LINE': newNode = figma.createLine(); break;
        case 'POLYGON': newNode = figma.createPolygon(); break;
        case 'STAR': newNode = figma.createStar(); break;
        case 'VECTOR': newNode = figma.createVector(); break;
        default: throw new Error('Unsupported node type: ' + m.nodeType);
      }
      if (props.name) newNode.name = props.name;
      if (props.x !== undefined) newNode.x = props.x;
      if (props.y !== undefined) newNode.y = props.y;
      if (props.width !== undefined && props.height !== undefined) newNode.resize(props.width, props.height);
      if (props.fills) {
        newNode.fills = props.fills.map((f: any) => {
          if (f.type === 'SOLID' && typeof f.color === 'string') { const c = _dbHexToRGB(f.color); return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a ?? 1 }; }
          return f;
        });
      }
      parent.appendChild(newNode);
      figma.ui.postMessage({ type: 'CREATE_CHILD_NODE_RESULT', requestId: m.requestId, success: true, node: { id: newNode.id, name: newNode.name, type: newNode.type, x: newNode.x, y: newNode.y, width: newNode.width, height: newNode.height } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'CREATE_CHILD_NODE_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CAPTURE_SCREENSHOT') {
    const m = msg as any;
    try {
      const node: any = m.nodeId ? await figma.getNodeByIdAsync(m.nodeId) : figma.currentPage;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (!('exportAsync' in node)) throw new Error('Node does not support export');
      const format = m.format || 'PNG';
      const scale = m.scale || 2;
      const bytes = await node.exportAsync({ format, constraint: { type: 'SCALE', value: scale } });
      const base64 = figma.base64Encode(bytes);
      const bounds = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
      figma.ui.postMessage({ type: 'CAPTURE_SCREENSHOT_RESULT', requestId: m.requestId, success: true, image: { base64, format, scale, byteLength: bytes.length, node: { id: node.id, name: node.name, type: node.type }, bounds } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'CAPTURE_SCREENSHOT_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'GET_FILE_INFO') {
    const m = msg as any;
    try {
      const sel = figma.currentPage.selection;
      // Use figma.fileKey if available; fall back to a stable local identifier so the
      // MCP server can register this connection (it requires a non-null fileKey).
      const _fileKey = figma.fileKey || ('local-' + figma.root.id);
      figma.ui.postMessage({ type: 'GET_FILE_INFO_RESULT', requestId: m.requestId, success: true, fileInfo: { fileName: figma.root.name, fileKey: _fileKey, currentPage: figma.currentPage.name, currentPageId: figma.currentPage.id, selectionCount: sel ? sel.length : 0 } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'GET_FILE_INFO_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'LOAD_UI_THEME') {
    const UI_THEME_KEY = 'dscc-ui-theme';
    figma.clientStorage.getAsync(UI_THEME_KEY).then((stored: unknown) => {
      const theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
      figma.ui.postMessage({ type: 'UI_THEME_LOADED', theme });
    }).catch(() => {
      figma.ui.postMessage({ type: 'UI_THEME_LOADED', theme: 'dark' });
    });
  }

  else if (msg.type === 'SAVE_UI_THEME') {
    const UI_THEME_KEY = 'dscc-ui-theme';
    const theme = (msg as any).theme === 'light' ? 'light' : 'dark';
    figma.clientStorage.setAsync(UI_THEME_KEY, theme).catch(() => {});
  }

  else if (msg.type === 'RELOAD_UI') {
    const m = msg as any;
    figma.ui.postMessage({ type: 'RELOAD_UI_RESULT', requestId: m.requestId, success: true });
  }

  else if (msg.type === 'SET_INSTANCE_PROPERTIES') {
    const m = msg as any;
    try {
      const node = await figma.getNodeByIdAsync(m.nodeId) as any;
      if (!node) throw new Error('Node not found: ' + m.nodeId);
      if (node.type !== 'INSTANCE') throw new Error('Node must be INSTANCE. Got: ' + node.type);
      const mainComponent = await node.getMainComponentAsync();
      const currentProps = node.componentProperties;
      const propsToSet: Record<string, unknown> = {};
      for (const [propName, newValue] of Object.entries(m.properties || {})) {
        if (currentProps[propName] !== undefined) { propsToSet[propName] = newValue; }
        else {
          const match = Object.keys(currentProps).find(k => k.startsWith(propName + '#'));
          if (match) propsToSet[match] = newValue;
        }
      }
      if (Object.keys(propsToSet).length === 0) throw new Error('No valid properties to set. Available: ' + Object.keys(currentProps).join(', '));
      node.setProperties(propsToSet);
      const updated = node.componentProperties;
      figma.ui.postMessage({ type: 'SET_INSTANCE_PROPERTIES_RESULT', requestId: m.requestId, success: true, instance: { id: node.id, name: node.name, componentId: mainComponent ? mainComponent.id : null, propertiesSet: Object.keys(propsToSet), currentProperties: Object.fromEntries(Object.entries(updated).map(([k, v]) => [k, { type: (v as any).type, value: (v as any).value }])) } });
    } catch (e: unknown) {
      figma.ui.postMessage({ type: 'SET_INSTANCE_PROPERTIES_RESULT', requestId: m.requestId, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  else if (msg.type === 'CLOSE') {
    figma.closePlugin();
  }

  // ============================================================================
  // TOKEN EXPORT — ported from JSON Exporter plugin
  // ============================================================================
  // ── Scan History ─────────────────────────────────────────────────────────
  else if (msg.type === 'SAVE_SCAN_HISTORY') {
    const key = msg.historyType === 'token-export' ? 'jex-scan-history' : 'ctx-scan-history';
    figma.clientStorage.getAsync(key).then((stored: any) => {
      const history: any[] = Array.isArray(stored) ? stored : [];
      history.unshift(msg.entry);
      return figma.clientStorage.setAsync(key, history.slice(0, 8));
    }).then(() => {
      figma.ui.postMessage({ type: 'SCAN_HISTORY_SAVED', historyType: msg.historyType });
    }).catch(() => {});
  }

  else if (msg.type === 'LOAD_SCAN_HISTORY') {
    const key = msg.historyType === 'token-export' ? 'jex-scan-history' : 'ctx-scan-history';
    figma.clientStorage.getAsync(key).then((stored: any) => {
      figma.ui.postMessage({ type: 'SCAN_HISTORY_LOADED', historyType: msg.historyType, history: Array.isArray(stored) ? stored : [] });
    }).catch(() => {
      figma.ui.postMessage({ type: 'SCAN_HISTORY_LOADED', historyType: msg.historyType, history: [] });
    });
  }

  else if (msg.type === 'DELETE_SCAN_HISTORY_ENTRY') {
    const key = msg.historyType === 'token-export' ? 'jex-scan-history' : 'ctx-scan-history';
    figma.clientStorage.getAsync(key).then((stored: any) => {
      const history: any[] = Array.isArray(stored) ? stored : [];
      return figma.clientStorage.setAsync(key, history.filter((e: any) => e.id !== msg.entryId));
    }).then(() => {
      figma.ui.postMessage({ type: 'SCAN_HISTORY_DELETED', historyType: msg.historyType, entryId: msg.entryId });
    }).catch(() => {});
  }

  else if (msg.type === 'LOAD_DS_SETTINGS') {
    Promise.all([
      figma.clientStorage.getAsync(DS_SETTINGS_STORAGE_KEY),
      figma.clientStorage.getAsync(DS_LOGO_PNG_STORAGE_KEY),
    ])
      .then(([stored, logoPng]) => {
        const config: Record<string, unknown> =
          stored && typeof stored === 'object' ? { ...(stored as object) } : {};
        const legacyInline = (config as { logoPngDataUrl?: string }).logoPngDataUrl;
        delete (config as { logoPngDataUrl?: unknown }).logoPngDataUrl;
        if (typeof logoPng === 'string' && logoPng.indexOf('data:image/png') === 0) {
          (config as { logoPngDataUrl?: string }).logoPngDataUrl = logoPng;
        } else if (typeof legacyInline === 'string' && legacyInline.indexOf('data:image/png') === 0) {
          (config as { logoPngDataUrl?: string }).logoPngDataUrl = legacyInline;
        }
        figma.ui.postMessage({ type: 'DS_SETTINGS_LOADED', config, fileName: figma.root.name || '' });
      })
      .catch(() => {
        figma.ui.postMessage({ type: 'DS_SETTINGS_LOADED', config: {}, fileName: figma.root.name || '' });
      });
  }

  else if (msg.type === 'SAVE_DS_SETTINGS') {
    const raw = (msg as any).config || {};
    const config = { ...raw };
    delete (config as { logoPngDataUrl?: unknown }).logoPngDataUrl;
    enqueueDsSettingsSaveStep(() => figma.clientStorage.setAsync(DS_SETTINGS_STORAGE_KEY, config));
  }

  else if (msg.type === 'SAVE_DS_LOGO_PNG') {
    const dataUrl = (msg as any).dataUrl;
    enqueueDsSettingsSaveStep(async () => {
      if (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/png') === 0) {
        await figma.clientStorage.setAsync(DS_LOGO_PNG_STORAGE_KEY, dataUrl);
      } else {
        await figma.clientStorage.deleteAsync(DS_LOGO_PNG_STORAGE_KEY);
      }
      figma.ui.postMessage({ type: 'DS_SETTINGS_SAVED' });
    });
  }

  else if (msg.type === 'JSON_EXPORT_LOAD_GIT_SETTINGS') {
    const GIT_CONFIG_KEY = 'json-exporter-git-config';
    figma.clientStorage.getAsync(GIT_CONFIG_KEY).then((stored: any) => {
      const config = stored && typeof stored === 'object' ? stored : {};
      figma.ui.postMessage({ type: 'JSON_EXPORT_GIT_SETTINGS_LOADED', config });
    }).catch(() => {
      figma.ui.postMessage({ type: 'JSON_EXPORT_GIT_SETTINGS_LOADED', config: {} });
    });
  }

  else if (msg.type === 'JSON_EXPORT_SAVE_GIT_SETTINGS') {
    const GIT_CONFIG_KEY = 'json-exporter-git-config';
    figma.clientStorage.setAsync(GIT_CONFIG_KEY, msg.config || {}).then(() => {
      figma.ui.postMessage({ type: 'JSON_EXPORT_GIT_SETTINGS_SAVED' });
    }).catch((e: any) => {
      figma.ui.postMessage({ type: 'JSON_EXPORT_GIT_SETTINGS_SAVED', error: e.message });
    });
  }

  else if (msg.type === 'JSON_EXPORT_CLEAR_GIT_SETTINGS') {
    const GIT_CONFIG_KEY = 'json-exporter-git-config';
    figma.clientStorage.deleteAsync(GIT_CONFIG_KEY).then(() => {
      figma.ui.postMessage({ type: 'JSON_EXPORT_GIT_SETTINGS_CLEARED' });
    });
  }

  else if (msg.type === 'JSON_EXPORT_EXTRACT') {
    (async () => {
      try {
        const colResults = await _jex_extractCollectionsForUI();
        figma.ui.postMessage({ type: 'JSON_EXPORT_EXTRACTED', collections: colResults });
      } catch (e: any) {
        figma.ui.postMessage({ type: 'JSON_EXPORT_ERROR', message: e.message });
      }
    })();
  }

  else if (msg.type === 'JSON_EXPORT_THEME_SOURCE') {
    (async () => {
      try {
        const collections = await _jex_extractCollectionsForUI();
        figma.ui.postMessage({ type: 'JSON_EXPORT_THEME_SOURCE_READY', collections });
      } catch (e: any) {
        figma.ui.postMessage({ type: 'JSON_EXPORT_ERROR', message: e.message });
      }
    })();
  }

  else if (msg.type === 'JSON_EXPORT_TRANSFORM') {
    try {
      const nativeResult = _jex_transformToFinalFormat(msg.raw);
      const exportMode = msg.exportMode || 'token-studio';
      let finalTokens: any;
      if (exportMode === 'token-studio') {
        finalTokens = _jex_toTokenStudioFormat(nativeResult.tokens, msg.raw);
      } else {
        finalTokens = nativeResult.tokens;
      }
      const topLevelCollections = Object.keys(finalTokens).filter(k => !k.startsWith('$')).length;
      figma.ui.postMessage({
        type: 'JSON_EXPORT_TRANSFORMED',
        payload: { tokens: finalTokens, count: nativeResult.count },
        validation: {
          actual: { totalTokens: nativeResult.count, topLevelCollections },
          matchPercentage: 100
        },
        exportMode
      });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'JSON_EXPORT_ERROR', message: e.message });
    }
  }

  // -------------------------------------------------------------------------
  // COMPONENT LIBRARIES JSON — scan, save, load, delete, focus, apply diff
  // -------------------------------------------------------------------------

  else if (msg.type === 'CL_SCAN') {
    _clScanAbort = false;
    const selectionOnly = msg.selectionOnly === true;
    const opts = {
      maxDepth: msg.maxDepth != null ? msg.maxDepth : 10,
      prefix: (msg.prefix != null ? msg.prefix : '').toString().trim(),
      includeDeprecated: msg.includeDeprecated !== false,
    };
    const scanPromise = selectionOnly ? _clScanSelected(opts) : _clScanAll(opts);
    scanPromise.then((data: any) => {
      try { figma.clientStorage.setAsync('clj_lastScan', JSON.stringify(data)).catch(() => {}); } catch (_) {}
      figma.ui.postMessage({ type: 'CL_SCAN_COMPLETE', data });
    }).catch((err: any) => {
      const msg2 = err && err.message ? err.message : String(err);
      if (msg2 === 'Scan cancelled') {
        figma.ui.postMessage({ type: 'CL_SCAN_CANCELLED' });
      } else {
        figma.ui.postMessage({ type: 'CL_SCAN_ERROR', error: msg2 });
      }
    });
  }

  else if (msg.type === 'CL_STOP_SCAN') {
    _clScanAbort = true;
  }

  else if (msg.type === 'CL_GET_SAVED_SCANS') {
    _clGetSavedScansMeta().then((meta: any[]) => {
      figma.ui.postMessage({ type: 'CL_SAVED_SCANS_LIST', meta });
    }).catch(() => { figma.ui.postMessage({ type: 'CL_SAVED_SCANS_LIST', meta: [] }); });
  }

  else if (msg.type === 'CL_SAVE_SCAN') {
    const name = ((msg.name || '').trim() as string).replace(/[<>:"/\\|?*]/g, '_');
    if (!name) { figma.ui.postMessage({ type: 'CL_SAVE_SCAN_RESULT', success: false, error: 'Invalid name' }); }
    else {
      _clSaveScan(name, msg.data).then(() => {
        figma.ui.postMessage({ type: 'CL_SAVE_SCAN_RESULT', success: true, name });
        return _clGetSavedScansMeta();
      }).then((meta: any[]) => {
        figma.ui.postMessage({ type: 'CL_SAVED_SCANS_LIST', meta });
      }).catch((e: any) => {
        figma.ui.postMessage({ type: 'CL_SAVE_SCAN_RESULT', success: false, error: e && e.message ? e.message : 'Save failed' });
      });
    }
  }

  else if (msg.type === 'CL_LOAD_SCAN') {
    const name = (msg.name || '').trim() as string;
    if (!name) { figma.ui.postMessage({ type: 'CL_LOAD_SCAN_RESULT', success: false }); }
    else {
      _clLoadScan(name).then((data: any) => {
        figma.ui.postMessage({ type: 'CL_LOAD_SCAN_RESULT', success: true, name, data });
      }).catch(() => { figma.ui.postMessage({ type: 'CL_LOAD_SCAN_RESULT', success: false }); });
    }
  }

  else if (msg.type === 'CL_DELETE_SCAN') {
    const name = (msg.name || '').trim() as string;
    if (!name) { figma.ui.postMessage({ type: 'CL_DELETE_SCAN_RESULT', success: false }); }
    else {
      _clDeleteScan(name).then(() => {
        figma.ui.postMessage({ type: 'CL_DELETE_SCAN_RESULT', success: true, name });
        return _clGetSavedScansMeta();
      }).then((meta: any[]) => {
        figma.ui.postMessage({ type: 'CL_SAVED_SCANS_LIST', meta });
      }).catch(() => { figma.ui.postMessage({ type: 'CL_DELETE_SCAN_RESULT', success: false }); });
    }
  }

  else if (msg.type === 'CL_FOCUS_NODE') {
    const nodeId = msg.nodeId as string;
    if (nodeId) {
      figma.getNodeByIdAsync(nodeId).then((node) => {
        if (node && 'type' in node) {
          figma.currentPage.selection = [node as SceneNode];
          figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        }
      }).catch(() => {});
    }
  }

  else if (msg.type === 'CL_RESTORE_OPTIONS') {
    Promise.all([
      figma.clientStorage.getAsync('clj_prefix'),
      figma.clientStorage.getAsync('clj_includeDeprecated'),
      figma.clientStorage.getAsync('clj_lastScan'),
      _clGetSavedScansMeta(),
    ]).then(([prefix, includeDepr, lastScan, meta]: any[]) => {
      let lastData = null;
      try { if (lastScan) lastData = JSON.parse(lastScan); } catch (_) {}
      figma.ui.postMessage({ type: 'CL_OPTIONS_RESTORED', prefix: prefix || '', includeDeprecated: includeDepr !== false, lastScan: lastData, savedScansMeta: meta });
    }).catch(() => {
      figma.ui.postMessage({ type: 'CL_OPTIONS_RESTORED', prefix: '', includeDeprecated: true, lastScan: null, savedScansMeta: [] });
    });
  }
};

// ============================================================================
// COMPONENT LIBRARIES JSON — Scanning helpers (ported from standalone plugin)
// ============================================================================

let _clScanAbort = false;
const CL_CHUNK_SIZE = 3500000;
const CL_SAVE_SIZE_LIMIT = 4000000;
const CL_META_KEY = 'clj_scanMeta';
const CL_NAMES_KEY = 'clj_scanNames';

const CL_SHAPE_PRIMITIVES: Record<string, boolean> = { RECTANGLE: true, ELLIPSE: true, VECTOR: true, LINE: true, BOOLEAN_OPERATION: true, STAR: true, POLYGON: true };
const CL_LAYOUT_TYPES: Record<string, boolean> = { FRAME: true, COMPONENT: true, INSTANCE: true, COMPONENT_SET: true };

function _clPad2Str(s: string): string { return s.length >= 2 ? s : '0' + s; }
function _clNumToHex(x: number): string { return _clPad2Str(Math.round(x * 255).toString(16)); }
function _clRgbToHex(r: number, g: number, b: number): string { return '#' + _clNumToHex(r) + _clNumToHex(g) + _clNumToHex(b); }
function _clRgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a === undefined || a === 1) return _clRgbToHex(r, g, b);
  return '#' + _clNumToHex(r) + _clNumToHex(g) + _clNumToHex(b) + _clNumToHex(a);
}
function _clHexToRgb(h: string): {r:number;g:number;b:number}|null {
  const m = (h||'').match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  return m ? { r: parseInt(m[1],16)/255, g: parseInt(m[2],16)/255, b: parseInt(m[3],16)/255 } : null;
}

function _clResolveVar(id: string, hops = 0): Promise<any> {
  if (!id || hops > 10) return Promise.resolve(null);
  return figma.variables.getVariableByIdAsync(id).then((variable: any) => {
    if (!variable) return null;
    let collection = null;
    try { const c = figma.variables.getVariableCollectionById(variable.variableCollectionId); if (c) collection = c.name; } catch (_) {}
    const modeIds = Object.keys(variable.valuesByMode || {});
    if (!modeIds.length) return { id: variable.id, name: variable.name, collection, resolvedValue: null };
    const val = variable.valuesByMode[modeIds[0]];
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS' && val.id) {
      return _clResolveVar(val.id, hops + 1).then((resolved: any) => ({ id: variable.id, name: variable.name, collection, aliasOf: val.id, aliasName: resolved?.name ?? null, resolvedValue: resolved?.resolvedValue ?? null }));
    }
    let resolvedValue = val;
    if (val && typeof val === 'object' && 'r' in val) resolvedValue = _clRgbaToHex(val.r, val.g, val.b, val.a !== undefined ? val.a : 1);
    return { id: variable.id, name: variable.name, collection, resolvedValue };
  }).catch(() => null);
}

function _clMakeTBV(raw: any, binding: any): Promise<any> {
  const b = Array.isArray(binding) ? binding[0] : binding;
  if (!b || !b.id) return Promise.resolve({ raw, isTokenBound: false, token: null });
  return _clResolveVar(b.id).then((token: any) => token ? { raw, isTokenBound: true, token } : { raw, isTokenBound: false, token: null });
}
function _clMakeTBVFill(paint: any): Promise<any> {
  if (!paint || paint.type !== 'SOLID') return Promise.resolve({ raw: null, isTokenBound: false, token: null });
  const c = paint.color;
  return _clMakeTBV(_clRgbaToHex(c.r, c.g, c.b, paint.opacity !== undefined ? paint.opacity : 1), paint.boundVariables?.color);
}
function _clMakeTBVProp(node: any, raw: any, prop: string): Promise<any> {
  return _clMakeTBV(raw != null ? raw : 0, node.boundVariables?.[prop]);
}

function _clSerializeCompProps(node: any): any[] {
  const result: any[] = [];
  try {
    const cp = node.componentProperties || {};
    for (const fullKey of Object.keys(cp)) {
      const val = cp[fullKey];
      const hi = fullKey.lastIndexOf('#');
      const name = hi >= 0 ? fullKey.slice(0, hi) : fullKey;
      const nodeId = hi >= 0 ? fullKey.slice(hi + 1) : '';
      result.push({ fullKey, name, nodeId, type: val.type, value: val.value });
    }
  } catch (_) {}
  return result;
}

function _clSerializeCompPropDefs(node: any): any[] {
  const result: any[] = [];
  try {
    const cp = node.componentPropertyDefinitions || {};
    for (const fullKey of Object.keys(cp)) {
      const val = cp[fullKey];
      const hi = fullKey.lastIndexOf('#');
      const name = hi >= 0 ? fullKey.slice(0, hi) : fullKey;
      const nodeId = hi >= 0 ? fullKey.slice(hi + 1) : '';
      let defVal = val.defaultValue;
      if (defVal && typeof defVal === 'object' && !Array.isArray(defVal)) {
        defVal = typeof defVal.key === 'string' ? defVal.key : typeof defVal.id === 'string' ? defVal.id : null;
      }
      result.push({ fullKey, name, nodeId, type: val.type, value: defVal !== undefined ? defVal : null });
    }
  } catch (_) {}
  return result;
}

function _clBuildLayerNode(node: any, parentPath: string[], depth: number, maxDepth: number): Promise<any> {
  if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
  const currentPath = parentPath.concat([node.name || '']);
  const isShape = !!CL_SHAPE_PRIMITIVES[node.type];
  const hasLayout = !!CL_LAYOUT_TYPES[node.type];
  const isText = node.type === 'TEXT';
  const isInstance = node.type === 'INSTANCE';

  const rawFills = (node.fills && node.fills !== figma.mixed) ? node.fills as any[] : [];
  const rawStrokes = (node.strokes && node.strokes !== figma.mixed) ? node.strokes as any[] : [];
  const fillsP = rawFills.filter((f: any) => f?.type === 'SOLID').length
    ? Promise.all(rawFills.filter((f: any) => f?.type === 'SOLID').map(_clMakeTBVFill))
    : Promise.resolve([]);
  const strokesP = rawStrokes.filter((s: any) => s?.type === 'SOLID').length
    ? Promise.all(rawStrokes.filter((s: any) => s?.type === 'SOLID').map(_clMakeTBVFill))
    : Promise.resolve([]);
  const opacityP = _clMakeTBVProp(node, node.opacity != null ? node.opacity : 1, 'opacity');

  let layoutP: Promise<any> = Promise.resolve(null);
  if (hasLayout && node.layoutMode !== undefined) {
    layoutP = Promise.all([
      _clMakeTBVProp(node, node.itemSpacing ?? 0, 'itemSpacing'),
      _clMakeTBVProp(node, node.paddingTop ?? 0, 'paddingTop'),
      _clMakeTBVProp(node, node.paddingRight ?? 0, 'paddingRight'),
      _clMakeTBVProp(node, node.paddingBottom ?? 0, 'paddingBottom'),
      _clMakeTBVProp(node, node.paddingLeft ?? 0, 'paddingLeft'),
    ]).then((vals: any[]) => ({
      mode: node.layoutMode || 'NONE',
      primaryAxisSizingMode: node.primaryAxisSizingMode || 'FIXED',
      counterAxisSizingMode: node.counterAxisSizingMode || 'FIXED',
      layoutSizingHorizontal: node.layoutSizingHorizontal || 'FIXED',
      layoutSizingVertical: node.layoutSizingVertical || 'FIXED',
      primaryAxisAlignItems: node.primaryAxisAlignItems || 'MIN',
      counterAxisAlignItems: node.counterAxisAlignItems || 'MIN',
      itemSpacing: vals[0],
      padding: { top: vals[1], right: vals[2], bottom: vals[3], left: vals[4] },
    }));
  }

  let textP: Promise<any> = Promise.resolve(null);
  if (isText) {
    const fontSizeRaw = node.fontSize !== figma.mixed ? node.fontSize : null;
    let lineHeightRaw: any = null;
    try { if (node.lineHeight !== figma.mixed && node.lineHeight?.unit !== 'AUTO') lineHeightRaw = node.lineHeight?.value ?? null; } catch (_) {}
    let letterSpacingRaw: any = null;
    try { if (node.letterSpacing !== figma.mixed && node.letterSpacing) letterSpacingRaw = node.letterSpacing?.value ?? null; } catch (_) {}
    let fontFamily: any = null, fontWeightRaw: any = null;
    try {
      if (node.fontName !== figma.mixed && node.fontName) {
        fontFamily = node.fontName.family || null;
        const swMap: Record<string, number> = { Thin: 100, ExtraLight: 200, 'Extra Light': 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, 'Semi Bold': 600, Bold: 700, ExtraBold: 800, 'Extra Bold': 800, Black: 900 };
        const style = node.fontName.style || '';
        fontWeightRaw = 400;
        for (const sw of Object.keys(swMap)) { if (style.includes(sw)) { fontWeightRaw = swMap[sw]; break; } }
      }
    } catch (_) {}
    textP = Promise.all([
      _clMakeTBVProp(node, fontSizeRaw, 'fontSize'),
      _clMakeTBVProp(node, lineHeightRaw, 'lineHeight'),
      _clMakeTBVProp(node, letterSpacingRaw, 'letterSpacing'),
    ]).then((vals: any[]) => ({
      characters: node.characters || '',
      fontSize: vals[0], fontFamily,
      fontWeight: { raw: fontWeightRaw, isTokenBound: false, token: null },
      lineHeight: vals[1], letterSpacing: vals[2],
    }));
  }

  const instanceP: Promise<any> = isInstance
    ? (node as InstanceNode).getMainComponentAsync().then((m: any) => m ? m.id : null).catch(() => null)
    : Promise.resolve(null);

  const childrenP: Promise<any[]> = (!isShape && depth < maxDepth && node.children?.length)
    ? Promise.all((node.children as any[]).map((c: any) => _clBuildLayerNode(c, currentPath, depth + 1, maxDepth)))
    : Promise.resolve([]);

  return Promise.all([fillsP, strokesP, opacityP, layoutP, textP, instanceP, childrenP]).then((res: any[]) => ({
    id: node.id, name: node.name || '', type: node.type, path: currentPath, depth,
    width: node.width, height: node.height, x: node.x ?? 0, y: node.y ?? 0,
    fills: res[0], strokes: res[1],
    strokeWeight: ('strokeWeight' in node && node.strokeWeight !== figma.mixed) ? node.strokeWeight : null,
    opacity: res[2], visible: node.visible !== false,
    layout: res[3], text: res[4], mainComponentId: res[5],
    componentProperties: isInstance ? _clSerializeCompProps(node) : null,
    children: res[6],
  }));
}

function _clComputeLayerSummary(tree: any[]): { layerCount: number; tokenBoundProps: number; hardcodedProps: number } {
  let layerCount = 0, tokenBoundProps = 0, hardcodedProps = 0;
  function countTBV(tbv: any) {
    if (!tbv) return;
    if (tbv.isTokenBound) tokenBoundProps++;
    else if (tbv.raw != null) hardcodedProps++;
  }
  function walk(layer: any) {
    layerCount++;
    (layer.fills || []).forEach(countTBV);
    (layer.strokes || []).forEach(countTBV);
    if (layer.layout) {
      countTBV(layer.layout.itemSpacing);
      if (layer.layout.padding) { countTBV(layer.layout.padding.top); countTBV(layer.layout.padding.right); countTBV(layer.layout.padding.bottom); countTBV(layer.layout.padding.left); }
    }
    if (layer.text) { countTBV(layer.text.fontSize); countTBV(layer.text.lineHeight); countTBV(layer.text.letterSpacing); }
    (layer.children || []).forEach(walk);
  }
  tree.forEach(walk);
  return { layerCount, tokenBoundProps, hardcodedProps };
}

function _clIsDeprecated(node: any): boolean {
  const desc = (node.description || '').toLowerCase();
  const name = (node.name || '').toLowerCase();
  return desc.includes('deprecated') || name.includes('deprecated');
}

function _clScanVariant(node: any, maxDepth: number): Promise<any> {
  const variantValues: Record<string, string> = {};
  try {
    for (const part of (node.name || '').split(',')) {
      const [k, v] = part.trim().split('=');
      if (k?.trim()) variantValues[k.trim()] = v?.trim() ?? '';
    }
  } catch (_) {}
  const children = node.children || [];
  return Promise.all(children.map((c: any) => _clBuildLayerNode(c, [], 0, maxDepth))).then((layerTree: any[]) => {
    const summary = _clComputeLayerSummary(layerTree);
    return { id: node.id, name: node.name, variantValues, width: node.width, height: node.height, sizingH: node.layoutSizingHorizontal || 'FIXED', sizingV: node.layoutSizingVertical || 'FIXED', componentProperties: _clSerializeCompPropDefs(node), layerTree, _summary: summary };
  });
}

function _clScanComponentSet(node: any, maxDepth: number, includeDepr: boolean): Promise<any> {
  const variantProperties: Record<string, string[]> = {};
  try {
    const vgp = node.variantGroupProperties || {};
    for (const k of Object.keys(vgp)) variantProperties[k] = vgp[k]?.values ?? [];
  } catch (_) {}
  const result: any = { type: 'COMPONENT_SET', id: node.id, name: node.name, key: node.key ?? null, deprecated: _clIsDeprecated(node), description: node.description || '', scannedAt: new Date().toISOString(), variantProperties, variants: [], summary: { totalVariants: 0, layerCount: 0, tokenBoundProps: 0, hardcodedProps: 0 } };
  const children = (node.children || []) as any[];
  const variantPromises = children.filter((c: any) => c.type === 'COMPONENT' && (includeDepr || !_clIsDeprecated(c))).map((c: any) => _clScanVariant(c, maxDepth));
  return Promise.all(variantPromises).then((variants: any[]) => {
    let lc = 0, tb = 0, hc = 0;
    for (const v of variants) { if (v._summary) { lc += v._summary.layerCount; tb += v._summary.tokenBoundProps; hc += v._summary.hardcodedProps; delete v._summary; } }
    result.variants = variants;
    result.summary = { totalVariants: variants.length, layerCount: lc, tokenBoundProps: tb, hardcodedProps: hc };
    return result;
  });
}

function _clScanComponent(node: any, maxDepth: number, includeDepr: boolean): Promise<any> {
  const children = node.children || [];
  return Promise.all(children.map((c: any) => _clBuildLayerNode(c, [], 0, maxDepth))).then((layerTree: any[]) => {
    const summary = _clComputeLayerSummary(layerTree);
    return { type: 'COMPONENT', id: node.id, name: node.name, key: node.key ?? null, deprecated: _clIsDeprecated(node), description: node.description || '', scannedAt: new Date().toISOString(), width: node.width, height: node.height, componentProperties: _clSerializeCompPropDefs(node), layerTree, summary };
  });
}

function _clMatchesPrefix(name: string, prefix: string): boolean {
  if (!prefix) return true;
  const n = name || '';
  return n.startsWith(prefix) || n.startsWith('.' + prefix);
}
function _clPassesFilter(node: any, prefix: string, includeDepr: boolean): boolean {
  if (!_clMatchesPrefix(node.name, prefix)) return false;
  if (!includeDepr && _clIsDeprecated(node)) return false;
  return true;
}
function _clComputeStats(sets: any[], standalone: any[]): any {
  let deprecatedCount = 0, dotPrefixCount = 0;
  for (const s of sets) { if (s.deprecated) deprecatedCount++; if (s.name?.startsWith('.')) dotPrefixCount++; for (const v of (s.variants || [])) { if (v.deprecated) deprecatedCount++; } }
  for (const c of standalone) { if (c.deprecated) deprecatedCount++; if (c.name?.startsWith('.')) dotPrefixCount++; }
  return { totalComponentSets: sets.length, totalStandaloneComponents: standalone.length, totalVariants: sets.reduce((a: number, s: any) => a + (s.variants?.length ?? 0), 0), deprecatedCount, dotPrefixCount };
}
function _clMakeShell(scanMode: string, filter: any): any {
  return { fileKey: figma.fileKey ?? null, fileName: figma.root.name, timestamp: new Date().toISOString(), scanMode, filter, stats: { totalComponentSets: 0, totalStandaloneComponents: 0, totalVariants: 0, deprecatedCount: 0, dotPrefixCount: 0 }, componentSets: [], standaloneComponents: [] };
}

function _clScanAll(opts: any): Promise<any> {
  const { maxDepth, prefix, includeDeprecated } = opts;
  return figma.loadAllPagesAsync().then(() => {
    if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
    const all = figma.root.findAll((n: any) => n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') as any[];
    let sets = all.filter((n: any) => n.type === 'COMPONENT_SET' && _clPassesFilter(n, prefix, includeDeprecated));
    let standalone = all.filter((n: any) => n.type === 'COMPONENT' && (!n.parent || n.parent.type !== 'COMPONENT_SET') && _clPassesFilter(n, prefix, includeDeprecated));
    const result = _clMakeShell('all', { prefix, includeDeprecated });
    const total = sets.length + standalone.length;
    let processed = 0;
    function processSets(): Promise<any> {
      if (!sets.length) return processStandalone();
      if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
      const set = sets.shift()!;
      processed++;
      figma.ui.postMessage({ type: 'CL_SCAN_PROGRESS', current: processed, total, name: set.name });
      return _clScanComponentSet(set, maxDepth, includeDeprecated).then((scanned: any) => { result.componentSets.push(scanned); return processSets(); });
    }
    function processStandalone(): Promise<any> {
      if (!standalone.length) { result.stats = _clComputeStats(result.componentSets, result.standaloneComponents); return Promise.resolve(result); }
      if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
      const comp = standalone.shift()!;
      processed++;
      figma.ui.postMessage({ type: 'CL_SCAN_PROGRESS', current: processed, total, name: comp.name });
      return _clScanComponent(comp, maxDepth, includeDeprecated).then((scanned: any) => { result.standaloneComponents.push(scanned); return processStandalone(); });
    }
    return processSets();
  });
}

function _clScanSelected(opts: any): Promise<any> {
  const { maxDepth, prefix, includeDeprecated } = opts;
  const selection = figma.currentPage.selection.filter((n: SceneNode) => ['COMPONENT_SET','COMPONENT','INSTANCE'].includes(n.type)) as any[];
  if (!selection.length) return Promise.reject(new Error('Select one or more components first'));
  const sets: any[] = [], standalone: any[] = [];
  const seen: Record<string, boolean> = {};
  const collectP: Promise<void>[] = [];
  for (const n of selection) {
    if (n.type === 'COMPONENT_SET') { if (_clPassesFilter(n, prefix, includeDeprecated) && !seen[n.id]) { sets.push(n); seen[n.id] = true; } }
    else if (n.type === 'INSTANCE') {
      collectP.push((n as InstanceNode).getMainComponentAsync().then((main: any) => {
        if (!main) return;
        const p = main.parent;
        if (p?.type === 'COMPONENT_SET') { if (_clPassesFilter(p, prefix, includeDeprecated) && !seen[p.id]) { sets.push(p); seen[p.id] = true; } }
        else if (_clPassesFilter(main, prefix, includeDeprecated) && !seen[main.id]) { standalone.push(main); seen[main.id] = true; }
      }).catch(() => {}));
    } else {
      const p = (n as any).parent;
      if (p?.type === 'COMPONENT_SET') { if (_clPassesFilter(p, prefix, includeDeprecated) && !seen[p.id]) { sets.push(p); seen[p.id] = true; } }
      else if (_clPassesFilter(n, prefix, includeDeprecated) && !seen[n.id]) { standalone.push(n); seen[n.id] = true; }
    }
  }
  return Promise.all(collectP).then(() => {
    const result = _clMakeShell('selection', { prefix, includeDeprecated });
    const total = sets.length + standalone.length;
    let processed = 0;
    function processSets(): Promise<any> {
      if (!sets.length) return processStandalone();
      if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
      const set = sets.shift()!; processed++;
      figma.ui.postMessage({ type: 'CL_SCAN_PROGRESS', current: processed, total, name: set.name });
      return _clScanComponentSet(set, maxDepth, includeDeprecated).then((s: any) => { result.componentSets.push(s); return processSets(); });
    }
    function processStandalone(): Promise<any> {
      if (!standalone.length) { result.stats = _clComputeStats(result.componentSets, result.standaloneComponents); return Promise.resolve(result); }
      if (_clScanAbort) return Promise.reject(new Error('Scan cancelled'));
      const c = standalone.shift()!; processed++;
      figma.ui.postMessage({ type: 'CL_SCAN_PROGRESS', current: processed, total, name: c.name });
      return _clScanComponent(c, maxDepth, includeDeprecated).then((s: any) => { result.standaloneComponents.push(s); return processStandalone(); });
    }
    return processSets();
  });
}

function _clSaveScan(name: string, data: any): Promise<void> {
  const dataStr = JSON.stringify(data);
  const saveP = dataStr.length <= CL_CHUNK_SIZE
    ? figma.clientStorage.setAsync('clj_scan_' + name, data)
    : (() => {
        const chunks: string[] = [];
        for (let i = 0; i < dataStr.length; i += CL_CHUNK_SIZE) chunks.push(dataStr.slice(i, i + CL_CHUNK_SIZE));
        return figma.clientStorage.setAsync('clj_chunks_' + name, chunks.length).then(() =>
          Promise.all(chunks.map((chunk: string, idx: number) => figma.clientStorage.setAsync('clj_scan_' + name + '_c' + idx, chunk)))
        ).then(() => undefined);
      })();
  return saveP.then(() => figma.clientStorage.getAsync(CL_NAMES_KEY)).then((namesJson: any) => {
    let names: string[] = [];
    try { if (namesJson) names = JSON.parse(namesJson); if (!Array.isArray(names)) names = []; } catch (_) {}
    if (!names.includes(name)) { names.push(name); names.sort(); }
    return figma.clientStorage.setAsync(CL_NAMES_KEY, JSON.stringify(names));
  }).then(() => figma.clientStorage.getAsync(CL_META_KEY)).then((metaJson: any) => {
    let meta: any[] = [];
    try { if (metaJson) meta = JSON.parse(metaJson); if (!Array.isArray(meta)) meta = []; } catch (_) {}
    const entry = { name, timestamp: data?.timestamp || new Date().toISOString(), stats: data?.stats || {}, scanMode: data?.scanMode || 'all' };
    const idx = meta.findIndex((m: any) => m.name === name);
    if (idx >= 0) meta[idx] = entry; else meta.push(entry);
    meta.sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return figma.clientStorage.setAsync(CL_META_KEY, JSON.stringify(meta));
  }).then(() => undefined);
}

function _clLoadScan(name: string): Promise<any> {
  return figma.clientStorage.getAsync('clj_chunks_' + name).then((chunkCount: any) => {
    if (chunkCount && chunkCount >= 1) {
      const promises = [];
      for (let i = 0; i < chunkCount; i++) promises.push(figma.clientStorage.getAsync('clj_scan_' + name + '_c' + i));
      return Promise.all(promises).then((chunks: any[]) => JSON.parse(chunks.join('')));
    }
    return figma.clientStorage.getAsync('clj_scan_' + name).then((val: any) => typeof val === 'string' ? JSON.parse(val) : val);
  });
}

function _clDeleteScan(name: string): Promise<void> {
  return figma.clientStorage.getAsync('clj_chunks_' + name).then((chunkCount: any) => {
    const dels = [figma.clientStorage.deleteAsync('clj_scan_' + name), figma.clientStorage.deleteAsync('clj_chunks_' + name)];
    if (chunkCount && chunkCount >= 1) for (let i = 0; i < chunkCount; i++) dels.push(figma.clientStorage.deleteAsync('clj_scan_' + name + '_c' + i));
    return Promise.all(dels);
  }).then(() => figma.clientStorage.getAsync(CL_NAMES_KEY)).then((namesJson: any) => {
    let names: string[] = [];
    try { if (namesJson) names = JSON.parse(namesJson); if (!Array.isArray(names)) names = []; } catch (_) {}
    names = names.filter((n: string) => n !== name);
    return figma.clientStorage.setAsync(CL_NAMES_KEY, JSON.stringify(names));
  }).then(() => figma.clientStorage.getAsync(CL_META_KEY)).then((metaJson: any) => {
    let meta: any[] = [];
    try { if (metaJson) meta = JSON.parse(metaJson); if (!Array.isArray(meta)) meta = []; } catch (_) {}
    meta = meta.filter((m: any) => m.name !== name);
    return figma.clientStorage.setAsync(CL_META_KEY, JSON.stringify(meta));
  }).then(() => undefined);
}

function _clGetSavedScansMeta(): Promise<any[]> {
  return figma.clientStorage.getAsync(CL_META_KEY).then((metaJson: any) => {
    let meta: any[] = [];
    try { if (metaJson) meta = JSON.parse(metaJson); if (!Array.isArray(meta)) meta = []; } catch (_) {}
    return meta;
  }).catch(() => []);
}

// ============================================================================
// DESKTOP BRIDGE — Document/selection/page event forwarding to WebSocket client
// ============================================================================
figma.loadAllPagesAsync().then(() => {
  figma.on('documentchange', (event) => {
    let hasStyleChanges = false, hasNodeChanges = false;
    const changedNodeIds: string[] = [];
    for (const change of event.documentChanges) {
      if (change.type === 'STYLE_CREATE' || change.type === 'STYLE_DELETE' || change.type === 'STYLE_PROPERTY_CHANGE') hasStyleChanges = true;
      else if (change.type === 'CREATE' || change.type === 'DELETE' || change.type === 'PROPERTY_CHANGE') {
        hasNodeChanges = true;
        if ((change as any).id && changedNodeIds.length < 50) changedNodeIds.push((change as any).id);
      }
    }
    if (hasStyleChanges || hasNodeChanges) {
      figma.ui.postMessage({ type: 'DOCUMENT_CHANGE', data: { hasStyleChanges, hasNodeChanges, changedNodeIds, changeCount: event.documentChanges.length, timestamp: Date.now() } });
    }
  });
  figma.on('selectionchange', () => {
    const selection = figma.currentPage.selection;
    figma.ui.postMessage({ type: 'SELECTION_CHANGE', data: { nodes: selection.slice(0, 50).map(n => ({ id: n.id, name: n.name, type: n.type, width: (n as any).width, height: (n as any).height })), count: selection.length, page: figma.currentPage.name, timestamp: Date.now() } });
  });
  figma.on('currentpagechange', () => {
    figma.ui.postMessage({ type: 'PAGE_CHANGE', data: { pageId: figma.currentPage.id, pageName: figma.currentPage.name, timestamp: Date.now() } });
  });
}).catch(() => { /* non-critical */ });

// ============================================================================
// Design Scan Rule Engine — token usage traversal
// ============================================================================

interface ScanDesignOptions {
  scanFrames: boolean;
  scanComponents: boolean;
  pages: string[];
  maxNodes: number;
}

interface RawUsageRecord {
  tokenName: string;
  tokenCollection: string;
  resolvedType: string;
  nodeName: string;
  nodeType: string;
  cssProperty: string;
  componentName: string;
  componentVariant: string;
  layerRole: string;
  screenName: string;
}

interface AggregatedTokenUsage {
  tokenName: string;
  resolvedType: string;
  totalInstances: number;
  usages: Array<{
    componentName: string;
    layerRole: string;
    cssProperty: string;
    variantContext: string;
    count: number;
  }>;
  appearsIn: string[];
  layerRoles: string[];
  cssProperties: string[];
}

async function scanForTokenUsage(options: ScanDesignOptions): Promise<AggregatedTokenUsage[]> {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const varMap = new Map<string, Variable>();
  allVars.forEach(v => varMap.set(v.id, v));

  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const collMap = new Map<string, VariableCollection>();
  allCollections.forEach(c => collMap.set(c.id, c));

  const records: RawUsageRecord[] = [];
  const counter = { nodes: 0 };
  const maxNodes = options.maxNodes || 5000;

  for (const page of figma.root.children) {
    if (options.pages.length > 0 && !options.pages.includes(page.name)) continue;

    try {
      if ((page as PageNode) !== figma.currentPage) {
        await (page as PageNode).loadAsync();
      }
    } catch { /* page may not be accessible */ }

    figma.ui.postMessage({ type: 'DESIGN_SCAN_PROGRESS', phase: `Scanning ${page.name}…` });

    for (const topNode of (page as PageNode).children) {
      if (counter.nodes >= maxNodes) break;
      traverseForBindings(topNode as SceneNode, topNode.name, records, varMap, collMap, counter, maxNodes);
    }
  }

  figma.ui.postMessage({ type: 'DESIGN_SCAN_PROGRESS', phase: 'Aggregating…' });
  return aggregateUsageRecords(records);
}

function traverseForBindings(
  node: SceneNode,
  screenName: string,
  records: RawUsageRecord[],
  varMap: Map<string, Variable>,
  collMap: Map<string, VariableCollection>,
  counter: { nodes: number },
  maxNodes: number,
): void {
  if (counter.nodes >= maxNodes) return;
  counter.nodes++;

  const boundVars = (node as any).boundVariables as Record<string, unknown> | undefined;
  if (boundVars) {
    const compName = getNearestComponentName(node);
    const compVariant = getNearestVariantContext(node);
    const layerRole = inferLayerRole(node.name);

    for (const [prop, binding] of Object.entries(boundVars)) {
      const bindings: unknown[] = Array.isArray(binding) ? binding : [binding];
      for (const b of bindings) {
        if (!b || (b as any).type !== 'VARIABLE_ALIAS') continue;
        const variable = varMap.get((b as any).id);
        if (!variable) continue;
        const collection = collMap.get(variable.variableCollectionId);
        records.push({
          tokenName: variable.name,
          tokenCollection: collection?.name ?? '',
          resolvedType: variable.resolvedType,
          nodeName: node.name,
          nodeType: node.type,
          cssProperty: propToCssProperty(prop),
          componentName: compName,
          componentVariant: compVariant,
          layerRole,
          screenName,
        });
      }
    }
  }

  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (counter.nodes >= maxNodes) break;
      traverseForBindings(child as SceneNode, screenName, records, varMap, collMap, counter, maxNodes);
    }
  }
}

function getNearestComponentName(node: BaseNode): string {
  let current: BaseNode | null = node.parent;
  while (current) {
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') return current.name;
    current = current.parent;
  }
  return '';
}

function getNearestVariantContext(node: BaseNode): string {
  let current: BaseNode | null = node.parent;
  while (current) {
    if (current.type === 'COMPONENT' && current.parent?.type === 'COMPONENT_SET') {
      return current.name;
    }
    if (current.type === 'INSTANCE') {
      const props = (current as InstanceNode).variantProperties;
      if (props) return Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
    }
    current = current.parent;
  }
  return '';
}

function propToCssProperty(prop: string): string {
  const map: Record<string, string> = {
    fills: 'fill', strokes: 'stroke', opacity: 'opacity',
    fontSize: 'fontSize', fontWeight: 'fontWeight',
    letterSpacing: 'letterSpacing', lineHeight: 'lineHeight',
    cornerRadius: 'borderRadius', topLeftRadius: 'borderRadius',
    topRightRadius: 'borderRadius', bottomLeftRadius: 'borderRadius',
    bottomRightRadius: 'borderRadius', itemSpacing: 'gap',
    paddingLeft: 'padding', paddingRight: 'padding',
    paddingTop: 'padding', paddingBottom: 'padding',
    effects: 'boxShadow',
  };
  return map[prop] ?? prop;
}

function inferLayerRole(nodeName: string): string {
  const n = nodeName.toLowerCase();
  if (n.includes('background') || n.includes(' bg') || n === 'bg') return 'background';
  if (n.includes('icon') || n.includes('glyph')) return 'icon';
  if (n.includes('label') || n.includes('text') || n.includes('title') || n.includes('caption')) return 'foreground';
  if (n.includes('border') || n.includes('divider') || n.includes('separator')) return 'border';
  if (n.includes('surface') || n.includes('card') || n.includes('panel') || n.includes('container')) return 'surface';
  if (n.includes('overlay') || n.includes('mask') || n.includes('scrim')) return 'overlay';
  if (n.includes('stroke') || n.includes('outline')) return 'border';
  return 'other';
}

function aggregateUsageRecords(records: RawUsageRecord[]): AggregatedTokenUsage[] {
  const map = new Map<string, RawUsageRecord[]>();
  for (const r of records) {
    const arr = map.get(r.tokenName);
    if (arr) arr.push(r);
    else map.set(r.tokenName, [r]);
  }

  const results: AggregatedTokenUsage[] = [];
  for (const [tokenName, recs] of map.entries()) {
    const first = recs[0];

    // Count combo occurrences
    const comboMap = new Map<string, { componentName: string; layerRole: string; cssProperty: string; variantContext: string; count: number }>();
    for (const r of recs) {
      const key = `${r.componentName}|${r.layerRole}|${r.cssProperty}|${r.componentVariant}`;
      const entry = comboMap.get(key);
      if (entry) entry.count++;
      else comboMap.set(key, { componentName: r.componentName, layerRole: r.layerRole, cssProperty: r.cssProperty, variantContext: r.componentVariant, count: 1 });
    }

    const usages = Array.from(comboMap.values()).sort((a, b) => b.count - a.count).slice(0, 20);
    const appearsIn = [...new Set(recs.map(r => r.componentName).filter(Boolean))];
    const layerRoles = [...new Set(recs.map(r => r.layerRole).filter(Boolean))];
    const cssProperties = [...new Set(recs.map(r => r.cssProperty).filter(Boolean))];

    results.push({ tokenName, resolvedType: first.resolvedType, totalInstances: recs.length, usages, appearsIn, layerRoles, cssProperties });
  }

  return results.sort((a, b) => b.totalInstances - a.totalInstances).slice(0, 150);
}

// ============================================================================
// Scan helpers
// ============================================================================

/**
 * Build breadcrumb path for a node (e.g. "Page > Frame > Component Set > Variant")
 */
function getNodePath(node: BaseNode): string {
  const parts: string[] = [];
  let current: BaseNode | null = node;
  while (current) {
    if ('name' in current) {
      parts.unshift((current as SceneNode).name);
    }
    current = current.parent;
  }
  return parts.join(' \u003E ');
}

/**
 * Generate a smart description for a variable based on its name, type, and collection.
 */
function generateVariableDescription(variable: Variable, collectionName: string): string {
  const name = variable.name;
  const parts = name.split('/');
  const readableName = parts.map(p => p.replace(/[-_]/g, ' ')).join(' / ');

  switch (variable.resolvedType) {
    case 'COLOR':
      return `Color token "${readableName}" from the ${collectionName} collection. Defines a color value used across the design system.`;
    case 'FLOAT':
      return `Numeric token "${readableName}" from the ${collectionName} collection. Defines a spacing, sizing, or numeric value.`;
    case 'STRING':
      return `String token "${readableName}" from the ${collectionName} collection. Stores a text or string-based design value.`;
    case 'BOOLEAN':
      return `Boolean token "${readableName}" from the ${collectionName} collection. Controls a true/false design flag.`;
    default:
      return `Design token "${readableName}" from the ${collectionName} collection.`;
  }
}

/**
 * Generate a smart description for a style based on its name and type.
 */
function generateStyleDescription(style: BaseStyle): string {
  const name = style.name;
  const parts = name.split('/');
  const readableName = parts.map(p => p.replace(/[-_]/g, ' ')).join(' / ');

  switch (style.type) {
    case 'PAINT':
      return `Color style "${readableName}". Defines a reusable color or fill pattern for consistent visual styling.`;
    case 'TEXT':
      return `Typography style "${readableName}". Defines font family, size, weight, and line height for consistent text rendering.`;
    case 'EFFECT':
      return `Effect style "${readableName}". Defines shadows, blurs, or other visual effects applied to layers.`;
    default:
      return `Design style "${readableName}".`;
  }
}

/**
 * Convert Figma RGBA (0-1) to hex string.
 */
function rgbaToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

/**
 * Resolve a COLOR variable to a hex value.
 * Follows alias chains so extension/alias tokens can still preview color.
 */
/**
 * modeNameMap: optional Map<modeId, modeName> built from all collections.
 * When present, we prefer the mode whose name contains "neutral" (case-insensitive)
 * so that foundation color values are always resolved through the Neutral scheme.
 */
async function getVariableColorHex(
  variable: Variable,
  cache?: Map<string, string | undefined>,
  visited?: Set<string>,
  modeNameMap?: Map<string, string>
): Promise<string | undefined> {
  if (variable.resolvedType !== 'COLOR') return undefined;
  const id = variable.id;
  if (cache && cache.has(id)) return cache.get(id);

  const seen = visited || new Set<string>();
  if (seen.has(id)) return undefined;
  seen.add(id);

  try {
    const modeIds = Object.keys(variable.valuesByMode || {});
    if (modeIds.length === 0) return undefined;

    // Prefer the Neutral mode when resolving foundation / scheme variables.
    let selectedModeId = modeIds[0];
    if (modeNameMap && modeIds.length > 1) {
      const neutralId = modeIds.find(mid => /neutral/i.test(modeNameMap.get(mid) || ''));
      if (neutralId) selectedModeId = neutralId;
    }

    const value = variable.valuesByMode[selectedModeId];
    if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
      const hex = rgbaToHex(value as { r: number; g: number; b: number });
      if (cache) cache.set(id, hex);
      return hex;
    }
    if (isVariableAliasValue(value)) {
      const targetId = (value as { id?: string }).id;
      if (!targetId) return undefined;
      if (cache && cache.has(targetId)) return cache.get(targetId);
      const targetVar = await figma.variables.getVariableByIdAsync(targetId);
      if (!targetVar) return undefined;
      const resolved = await getVariableColorHex(targetVar, cache, seen, modeNameMap);
      if (cache) cache.set(id, resolved);
      return resolved;
    }
  } catch (_) {
    // ignore
  }
  if (cache) cache.set(id, undefined);
  return undefined;
}

/**
 * Resolve a COLOR variable to hex starting from a specific collection mode (follows aliases).
 */
async function getVariableColorHexForMode(
  variable: Variable,
  modeId: string,
  depth = 0,
): Promise<string | undefined> {
  if (depth > 12 || variable.resolvedType !== 'COLOR') return undefined;
  try {
    const modes = (variable.valuesByMode || {}) as Record<string, unknown>;
    let mid = modeId;
    if (!mid || modes[mid] === undefined) mid = Object.keys(modes)[0] ?? '';
    if (!mid) return undefined;
    const raw = modes[mid];
    if (raw && typeof raw === 'object' && 'r' in raw && 'g' in raw && 'b' in raw) {
      return rgbaToHex(raw as { r: number; g: number; b: number });
    }
    if (isVariableAliasValue(raw)) {
      const targetId = (raw as { id?: string }).id;
      if (!targetId) return undefined;
      const targetVar = await figma.variables.getVariableByIdAsync(targetId);
      if (!targetVar) return undefined;
      const nextMid =
        Object.keys((targetVar.valuesByMode || {}) as Record<string, unknown>)[0] ?? mid;
      return getVariableColorHexForMode(targetVar, nextMid, depth + 1);
    }
  } catch (_) {
    // ignore
  }
  return undefined;
}

/**
 * Resolve a FLOAT variable's value by following VARIABLE_ALIAS chains.
 * Prefers a mode whose name contains "neutral" (case-insensitive) if
 * modeNameMap is provided; otherwise uses the first available mode.
 */
async function resolveVariableFloat(
  variable: Variable,
  modeNameMap?: Map<string, string>,
  visited?: Set<string>,
): Promise<number | null> {
  const seen = visited ?? new Set<string>();
  if (seen.has(variable.id)) return null;
  seen.add(variable.id);
  try {
    const modes = Object.keys(variable.valuesByMode ?? {});
    if (modes.length === 0) return null;
    let mid = modes[0];
    if (modeNameMap && modes.length > 1) {
      const nm = modes.find(m => /neutral/i.test(modeNameMap.get(m) ?? ''));
      if (nm) mid = nm;
    }
    const val = (variable.valuesByMode as Record<string, unknown>)[mid];
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && (val as any).type === 'VARIABLE_ALIAS') {
      const targetId = (val as any).id as string | undefined;
      if (!targetId) return null;
      const target = await figma.variables.getVariableByIdAsync(targetId);
      if (!target) return null;
      return resolveVariableFloat(target, modeNameMap, seen);
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Resolve a STRING variable's value by following VARIABLE_ALIAS chains.
 */
async function resolveVariableString(
  variable: Variable,
  visited?: Set<string>,
): Promise<string | null> {
  const seen = visited ?? new Set<string>();
  if (seen.has(variable.id)) return null;
  seen.add(variable.id);
  try {
    const modes = Object.keys(variable.valuesByMode ?? {});
    if (modes.length === 0) return null;
    const val = (variable.valuesByMode as Record<string, unknown>)[modes[0]];
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && (val as any).type === 'VARIABLE_ALIAS') {
      const targetId = (val as any).id as string | undefined;
      if (!targetId) return null;
      const target = await figma.variables.getVariableByIdAsync(targetId);
      if (!target) return null;
      return resolveVariableString(target, seen);
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Try to extract the hex color from a PaintStyle's first solid paint.
 */
function getPaintStyleColorHex(style: PaintStyle): string | undefined {
  try {
    const paints = style.paints;
    if (paints.length === 0) return undefined;
    const first = paints[0];
    if (first.type === 'SOLID' && first.color) {
      return rgbaToHex(first.color);
    }
  } catch (_) {
    // ignore
  }
  return undefined;
}

/**
 * Build a short source value string for a PaintStyle (for preview in UI).
 */
function getPaintStyleSourceValue(style: PaintStyle): string {
  const hex = getPaintStyleColorHex(style);
  if (hex) return `Solid ${hex}`;
  const paints = style.paints;
  if (paints.length === 0) return 'Empty';
  const first = paints[0];
  if (first.type === 'GRADIENT_LINEAR' || first.type === 'GRADIENT_RADIAL' || first.type === 'GRADIENT_ANGULAR' || first.type === 'GRADIENT_DIAMOND') {
    const stops = 'gradientStops' in first && Array.isArray(first.gradientStops) ? first.gradientStops.length : 0;
    return `Gradient (${stops} stops)`;
  }
  return 'Paint';
}

/**
 * Build a short source value string for an EffectStyle (shadows, blur).
 */
function getEffectStyleSourceValue(style: { effects: readonly Effect[] }): string {
  try {
    const effects = style.effects;
    if (!effects || effects.length === 0) return 'No effects';
    const parts: string[] = [];
    for (const e of effects) {
      if (!e.visible) continue;
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        const x = (e as { offset: { x: number; y: number }; radius: number; spread?: number }).offset?.x ?? 0;
        const y = (e as { offset: { x: number; y: number }; radius: number; spread?: number }).offset?.y ?? 0;
        const r = (e as { radius: number }).radius ?? 0;
        const spread = (e as { spread?: number }).spread ?? 0;
        const color = (e as { color: RGB }).color;
        const hex = color ? rgbaToHex(color) : '';
        parts.push(`${e.type === 'INNER_SHADOW' ? 'Inner shadow' : 'Drop shadow'} ${x} ${y} ${r}${spread ? ` ${spread}` : ''} ${hex}`);
      } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
        const radius = (e as { radius: number }).radius ?? 0;
        parts.push(`${e.type === 'BACKGROUND_BLUR' ? 'Background blur' : 'Layer blur'} ${radius}px`);
      }
    }
    return parts.length > 0 ? parts.join('; ') : 'Effects';
  } catch (_) {
    return 'Effects';
  }
}

/**
 * Build a short source value string for a TextStyle (font, size, line height).
 */
function getTextStyleSourceValue(style: TextStyle): string {
  try {
    const s = style as { fontName: FontName | symbol; fontSize: number | symbol; lineHeight?: LineHeight | symbol };
    let font = 'Mixed font';
    if (typeof s.fontName === 'object' && s.fontName !== null && 'family' in s.fontName) {
      const fn = s.fontName as FontName;
      font = `${fn.family} ${fn.style || ''}`.trim();
    }
    const size = typeof s.fontSize === 'number' ? `${s.fontSize}px` : '?';
    let lineStr = '';
    const lh = s.lineHeight;
    if (lh !== undefined && typeof lh === 'object' && lh !== null && 'value' in lh) {
      const v = (lh as { value: number; unit: string }).value;
      const u = (lh as { unit: string }).unit;
      lineStr = u === 'PERCENT' ? ` ${v}% line` : ` ${v}px line`;
    } else if (typeof lh === 'number') {
      lineStr = ` ${lh}px line`;
    }
    return [font, size, lineStr].join('').trim() || 'Text style';
  } catch (_) {
    return 'Text style';
  }
}

/**
 * Build a short source value string for a Variable (first mode value).
 */
function getVariableSourceValue(variable: Variable): string {
  const modeIds = Object.keys(variable.valuesByMode || {});
  if (modeIds.length === 0) return '—';
  const raw = variable.valuesByMode[modeIds[0]];
  if (raw === undefined) return '—';
  if (variable.resolvedType === 'COLOR' && raw && typeof raw === 'object' && 'r' in (raw as object)) {
    return rgbaToHex(raw as { r: number; g: number; b: number; a?: number });
  }
  if (variable.resolvedType === 'FLOAT' && typeof raw === 'number') {
    return formatTypographicFloatDisplay(variable.name, raw);
  }
  if (variable.resolvedType === 'STRING' || variable.resolvedType === 'BOOLEAN') {
    return String(raw);
  }
  return String(raw);
}

/**
 * Extension tokens/styles often inherit documentation from a master segment.
 * In those cases, missing-description findings are not actionable.
 */
function hasExtensionKeyword(name: string): boolean {
  const n = (name || '').toLowerCase();
  if (!n) return false;
  return (
    n.includes('/extension/') ||
    n.includes('/extensions/') ||
    n.includes('/extended/') ||
    n.includes('/extented/') || // keep common misspelling
    n.startsWith('extension/') ||
    n.startsWith('extended/') ||
    n.startsWith('extented/') ||
    n.includes(' extension ') ||
    n.includes(' extended ') ||
    n.includes(' extented ')
  );
}

function isVariableAliasValue(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { type?: string }).type === 'VARIABLE_ALIAS';
}

const WIZ_PATH_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Tie-break when two variables share no `variableIds` index: compare each `/` segment,
 * case-insensitive + numeric per segment.
 */
function compareVariablePathName(a: string, b: string): number {
  const as = (a || '').split('/').filter(Boolean);
  const bs = (b || '').split('/').filter(Boolean);
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const ca = as[i];
    const cb = bs[i];
    if (ca === undefined) return -1;
    if (cb === undefined) return 1;
    const c = WIZ_PATH_COLLATOR.compare(ca, cb);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Match Figma’s Variables sidebar order: `VariableCollection.variableIds` is the canonical order.
 */
function sortVariablesLikeFigmaPanel(variables: Variable[], collection: VariableCollection): void {
  const order = new Map<string, number>();
  collection.variableIds.forEach((id, i) => order.set(id, i));
  const FALLBACK = 1_000_000;
  variables.sort((a, b) => {
    const ia = order.get(a.id) ?? FALLBACK;
    const ib = order.get(b.id) ?? FALLBACK;
    if (ia !== ib) return ia - ib;
    return compareVariablePathName(a.name, b.name);
  });
}

/** Collections excluded from the semantic-colors wizard (not shown as tabs or default table). */
function isSemanticWizardExcludedCollection(name: string): boolean {
  const n = (name || '').trim();
  return n === '.scheme' || n.toLowerCase() === 'scheme';
}

/** First hop from `modeId` lands on a variable in `coreCollId` (direct link to .core). */
async function isDirectColorAliasToCore(
  variable: Variable,
  modeId: string,
  coreCollId: string,
): Promise<boolean> {
  if (variable.resolvedType !== 'COLOR') return false;
  const modes = (variable.valuesByMode || {}) as Record<string, unknown>;
  let mid = modeId;
  if (!mid || modes[mid] === undefined) mid = Object.keys(modes)[0] ?? '';
  if (!mid) return false;
  const raw = modes[mid];
  if (!isVariableAliasValue(raw)) return false;
  const tid = (raw as { id?: string }).id;
  if (!tid) return false;
  const target = await figma.variables.getVariableByIdAsync(tid);
  return target !== null && target.variableCollectionId === coreCollId;
}

/**
 * Walk a COLOR variable's alias chain from `modeId` until a `.core` target, primitive RGB, or dead end.
 * Returns the `.core` variable id at chain end (for dropdown) and labels for UI ("a → b → core/…").
 */
async function followColorAliasChainToCore(
  startVar: Variable,
  modeId: string,
  coreCollId: string,
  maxDepth: number,
): Promise<{
  coreTargetId: string | null;
  chainLabels: string[];
  hasRawPrimitive: boolean;
}> {
  const chainLabels: string[] = [];
  let current: Variable | null = startVar;
  let mid = modeId;
  for (let d = 0; d < maxDepth && current; d++) {
    const modes = (current.valuesByMode || {}) as Record<string, unknown>;
    if (!mid || modes[mid] === undefined) mid = Object.keys(modes)[0] ?? '';
    if (!mid) break;
    const raw = modes[mid];
    if (raw && typeof raw === 'object' && 'r' in raw && 'g' in raw && 'b' in raw) {
      return { coreTargetId: null, chainLabels, hasRawPrimitive: true };
    }
    if (!isVariableAliasValue(raw)) {
      return { coreTargetId: null, chainLabels, hasRawPrimitive: false };
    }
    const tid = (raw as { id: string }).id;
    const next = await figma.variables.getVariableByIdAsync(tid);
    if (!next) break;
    chainLabels.push(next.name || tid);
    if (next.variableCollectionId === coreCollId) {
      return { coreTargetId: next.id, chainLabels, hasRawPrimitive: false };
    }
    current = next;
    mid = Object.keys((next.valuesByMode || {}) as Record<string, unknown>)[0] ?? mid;
  }
  return { coreTargetId: null, chainLabels, hasRawPrimitive: false };
}

function isRemoteCollection(c: VariableCollection): boolean {
  return !!(c as { remote?: boolean }).remote;
}

function isMasterLinkedVariable(variable: Variable, collectionName: string): boolean {
  if (hasExtensionKeyword(variable.name) || hasExtensionKeyword(collectionName)) return true;
  const modeIds = Object.keys(variable.valuesByMode || {});
  if (modeIds.length === 0) return false;
  let aliasCount = 0;
  for (const modeId of modeIds) {
    if (isVariableAliasValue(variable.valuesByMode[modeId])) aliasCount++;
  }
  return aliasCount > 0 && aliasCount === modeIds.length;
}

function hasOwnOrSharedVariableDescription(variable: Variable, collectionName: string): boolean {
  const hasOwn = !!(variable.description && variable.description.trim().length > 0);
  return hasOwn || isMasterLinkedVariable(variable, collectionName);
}

function hasOwnOrSharedStyleDescription(style: BaseStyle, groupName: string): boolean {
  const hasOwn = !!(style.description && style.description.trim().length > 0);
  return hasOwn || hasExtensionKeyword(style.name) || hasExtensionKeyword(groupName);
}

/**
 * Detect child/extended collections that should not surface independent issues.
 * We still scan them, but suppress their issues at the end of the collection pass.
 */
function isChildCollectionForIssueSuppression(collectionName: string, _variables: Variable[]): boolean {
  const lower = (collectionName || '').toLowerCase();
  if (
    hasExtensionKeyword(collectionName) ||
    lower.includes('child') ||
    lower.includes('/child/') ||
    lower.startsWith('child/')
  ) {
    return true;
  }
  // IMPORTANT: do not suppress by alias heuristics;
  // only suppress explicit child/extended collections.
  return false;
}

function isCoreSemanticCollectionName(collectionName: string): boolean {
  const n = (collectionName || '').toLowerCase();
  return (
    n.includes('semantic') ||
    n.includes('primitive') ||
    n.includes('primitives') ||
    n.includes('core') ||
    n.includes('base') ||
    n.includes('global') ||
    n.includes('theme')
  );
}

/**
 * Returns alias target variable id when ALL modes are alias-linked to the same target.
 * Otherwise returns null.
 */
function getUniformAliasTargetId(variable: Variable): string | null {
  const modeIds = Object.keys(variable.valuesByMode || {});
  if (modeIds.length === 0) return null;
  let aliasId: string | null = null;
  for (const modeId of modeIds) {
    const raw = variable.valuesByMode[modeId];
    if (!isVariableAliasValue(raw)) return null;
    const id = (raw as { id?: string }).id || null;
    if (!id) return null;
    if (aliasId === null) aliasId = id;
    else if (aliasId !== id) return null;
  }
  return aliasId;
}

/**
 * Secondary detector for child/extended collections:
 * if most variables are pure aliases to variables from another collection,
 * this collection behaves like an extension and should not emit independent issues.
 */
async function isLikelyChildCollectionByAliasInheritance(
  collection: VariableCollection,
  variables: Variable[]
): Promise<boolean> {
  if (isCoreSemanticCollectionName(collection.name)) return false;
  if (!variables || variables.length < 3) return false;

  const targetCache = new Map<string, Variable | null>();
  let aliasOnlyCount = 0;
  let aliasToExternalCollectionCount = 0;

  for (const v of variables) {
    const targetId = getUniformAliasTargetId(v);
    if (!targetId) continue;
    aliasOnlyCount++;

    if (!targetCache.has(targetId)) {
      const targetVar = await figma.variables.getVariableByIdAsync(targetId);
      targetCache.set(targetId, targetVar || null);
    }

    const target = targetCache.get(targetId);
    if (target && target.variableCollectionId && target.variableCollectionId !== collection.id) {
      aliasToExternalCollectionCount++;
    }
  }

  if (aliasOnlyCount === 0) return false;
  const aliasOnlyRatio = aliasOnlyCount / variables.length;
  const externalAliasRatio = aliasToExternalCollectionCount / variables.length;

  return aliasOnlyCount >= 3 && aliasOnlyRatio >= 0.7 && externalAliasRatio >= 0.6;
}

function targetToConfig(target: 'components' | 'variables' | 'styles'): ScanConfig {
  switch (target) {
    case 'components':
      return { scanStyles: true, scanVariables: false, scanPageNames: false, scanStructure: true };
    case 'variables':
      return { scanStyles: false, scanVariables: true, scanPageNames: false, scanStructure: false };
    case 'styles':
      return { scanStyles: true, scanVariables: false, scanPageNames: false, scanStructure: false };
    default:
      return { scanStyles: true, scanVariables: true, scanPageNames: true, scanStructure: true };
  }
}

// ============================================================================
// DS Context Maturity (file-level scoring)
// ============================================================================

async function maybeRunDSMaturity(): Promise<void> {
  // Run with whatever data is available (variables, styles, or both)
  const hasVars = cachedDSVars && cachedDSCollections;
  const hasStyles = cachedDSStyles;
  if (!hasVars && !hasStyles) return;

  const bakedRules = await getBakedRules();
  const input: DSContextInput = {
    variables: cachedDSVars || [],
    collections: cachedDSCollections || [],
    styles: cachedDSStyles || [],
    designRules: bakedRules.length > 0 ? bakedRules : undefined,
  };

  const result = scoreDSContextMaturity(input);

  // Indicate which layers were scanned
  const partial = !(hasVars && hasStyles);

  // Include minimal variable summaries for the UI token-actions section
  const varSummaries = (cachedDSVars || []).map(v => ({
    id: v.id,
    name: v.name,
    description: v.description || '',
    scopes: v.scopes || [],
    resolvedType: v.resolvedType || '',
  }));

  figma.ui.postMessage({
    type: 'DS_CONTEXT_MATURITY_RESULT',
    result,
    partial,
    scannedLayers: {
      variables: !!hasVars,
      styles: !!hasStyles,
    },
    variableSummaries: varSummaries,
    timestamp: new Date().toISOString(),
  });

  console.log(`DS Context Maturity: ${result.overallScore}/100 (${result.tier})${partial ? ' [partial]' : ''}`);
}

// ============================================================================
// Document-level scan (Variables & Styles - no selection required)
// ============================================================================

/**
 * Scan all variable collections in the document.
 * Like the export plugin - scans the full document.
 */
async function scanDocumentVariables(): Promise<void> {
  console.log('=== SCANNING DOCUMENT VARIABLES ===');

  const audits: ComponentAudit[] = [];

  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const colorHexCache = new Map<string, string | undefined>();

    // Build modeId → modeName map so getVariableColorHex can prefer "Neutral" modes
    // when resolving alias chains through scheme collections.
    const modeNameMap = new Map<string, string>();
    for (const col of collections) {
      for (const mode of (col as any).modes || []) {
        if (mode.modeId && mode.name) modeNameMap.set(mode.modeId, mode.name);
      }
    }

    if (collections.length === 0) {
      figma.ui.postMessage({
        type: 'SCAN_COMPLETE',
        audits: [],
        timestamp: new Date().toISOString()
      });
      figma.notify('No variable collections found in this file');
      return;
    }

    // DS Context Maturity accumulators
    const allDSVars: DSVariable[] = [];
    const allDSCollections: DSCollection[] = [];

    // ── RADD System Detection + Architecture Rule Check ───────────────────
    // Runs once per scan, before the per-collection loop.
    // Loads all variables in a single batch for the alias-chain checks.
    let systemInfo: SystemInfo | null = null;
    let architectureViolations: RuleViolation[] = [];
    try {
      const allVarsForRules = await figma.variables.getLocalVariablesAsync();
      const collectionNames = collections.map((c: any) => c.name as string);
      systemInfo = detectRADDSystem(collectionNames);

      figma.ui.postMessage({
        type: 'SCAN_PROGRESS',
        message: `System detected: ${systemLabel(systemInfo)} — running architecture checks…`,
      });

      if (systemInfo.version !== 'unknown') {
        const slimVars: FigmaVarSlim[] = allVarsForRules.map(v => ({
          id: v.id,
          name: v.name,
          variableCollectionId: v.variableCollectionId,
          resolvedType: v.resolvedType,
          valuesByMode: v.valuesByMode as Record<string, unknown>,
        }));
        const slimColls: FigmaCollectionSlim[] = collections.map((c: any) => ({
          id: c.id,
          name: c.name,
          modes: c.modes.map((m: any) => ({ modeId: m.modeId, name: m.name || '' })),
          variableIds: [...(c.variableIds as string[])],
        }));
        architectureViolations = runFoundationRules({
          version: systemInfo.version,
          vars: slimVars,
          collections: slimColls,
        });
        figma.ui.postMessage({
          type: 'SCAN_PROGRESS',
          message: `Architecture check complete — ${architectureViolations.length} issue(s) found`,
        });
      }

      // Post system info so the UI can display it
      figma.ui.postMessage({
        type: 'SYSTEM_DETECTED',
        systemInfo,
        violationCount: architectureViolations.length,
      });
    } catch (ruleErr) {
      console.warn('[FoundationRules] Rule check failed (non-blocking):', ruleErr);
    }

    for (const collection of collections) {
      await yieldToEventLoop();
      if (scanCancelled) break;
      const issues: Issue[] = [];
      const variableIds = collection.variableIds;

      // Cache collection for DS Context Maturity
      allDSCollections.push({
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((m: any) => ({ modeId: m.modeId, name: m.name || '' })),
        variableIds: [...variableIds],
      });
      const variables: Variable[] = [];

      for (let vi = 0; vi < variableIds.length; vi++) {
        if (vi % 20 === 0) await yieldToEventLoop(); // yield every 20 items
        if (scanCancelled) break;
        const variable = await figma.variables.getVariableByIdAsync(variableIds[vi]);
        if (variable) variables.push(variable);
      }

      // Send progress
      figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Scanning collection: ${collection.name} (${variables.length} variables)` });

      // ── MCP Enrichment (batch fetch for this collection) ──────────
      let mcpData: Record<string, any> = {};
      if (mcpConnected) {
        try {
          const entities = variables.map(v => ({ name: v.name }));
          mcpData = await requestMCPEnrichment(entities);
          figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `MCP enrichment received for ${Object.keys(mcpData).length} variables` });
        } catch { /* non-blocking */ }
      }

      // ── Notion Compliance Verification (batch) ────────────────────
      let notionCompliance: Record<string, any> = {};
      if (notionEnrichedRules.length > 0 && mcpConnected) {
        try {
          const complianceEntities = variables
            .filter(v => !hasOwnOrSharedVariableDescription(v, collection.name))
            .map(v => ({ name: v.name, entityType: 'variable', description: v.description || '' }));
          if (complianceEntities.length > 0) {
            notionCompliance = await requestNotionCompliance(complianceEntities);
            figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Notion compliance checked for ${Object.keys(notionCompliance).length} variables` });
          }
        } catch { /* non-blocking */ }
      }

      // Extract mode names once for the collection
      const collectionModeNames = collection.modes.map((m: any) => m.name || '');

      // Token maturity: use reverse index if available (T7: empty is ok)
      const revIndex = reverseIndexCache || {};

      // ── Foundation description conformance: build a document varMap ──────
      // Only paid once per scan run, only when the foundation collection is present.
      let foundationVarMap: Record<string, FoundationVariable> | null = null;
      if (collection.name === 'foundation') {
        const allDocVars = await figma.variables.getLocalVariablesAsync();
        foundationVarMap = {};
        for (const dv of allDocVars) {
          foundationVarMap[dv.id] = {
            id: dv.id,
            name: dv.name,
            description: dv.description || '',
            resolvedType: dv.resolvedType as FoundationVariable['resolvedType'],
            scopes: (dv as any).scopes || [],
            valuesByMode: dv.valuesByMode || {},
            variableCollectionId: dv.variableCollectionId,
          };
        }
      }

      for (let vi = 0; vi < variables.length; vi++) {
        if (vi % 10 === 0) await yieldToEventLoop(); // yield every 10 items
        if (scanCancelled) break;
        const variable = variables[vi];
        const colorHex = await getVariableColorHex(variable, colorHexCache, undefined, modeNameMap);

        // ── Cache for DS Context Maturity ──
        allDSVars.push({
          id: variable.id,
          name: variable.name,
          description: variable.description || '',
          scopes: (variable as any).scopes || [],
          resolvedType: variable.resolvedType || '',
          codeSyntax: (variable as any).codeSyntax || {},
          valuesByMode: variable.valuesByMode || {},
          variableCollectionId: variable.variableCollectionId || '',
        });

        // ── Token maturity (scoreToken) for every variable (T1) ──
        const revEntry = revIndex[variable.name] || null;
        const tokenResult = scoreToken(variable as any, collection.name, revEntry, currentRubric);
        const tokenMaturityAttach = {
          tokenScore: tokenResult.score,
          tokenTier: tokenResult.tier,
          tokenGaps: tokenResult.gaps,
          tokenDimensions: tokenResult.dimensions,
        };

        // ── DS Naming & Structure Validation (runs on ALL variables) ──
        const tokenHasDescription = hasOwnOrSharedVariableDescription(variable, collection.name);
        const tokenInput: TokenInput = {
          name: variable.name,
          collectionName: collection.name,
          resolvedType: variable.resolvedType,
          modeCount: Object.keys(variable.valuesByMode).length,
          modeNames: collectionModeNames,
          hasDescription: tokenHasDescription,
        };
        const namingViolations = validateToken(tokenInput);
        const tierLabel = getTokenTierLabel(collection.name);

        const variableSourceValue = getVariableSourceValue(variable);
        const variableScopes = (variable as any).scopes || [];
        for (const v of namingViolations) {
          const issueObj: any = {
            id: `${variable.id}-${v.ruleId}`,
            category: 'poor' as any,
            severity: v.severity,
            message: `[${v.category}] ${v.message}`,
            suggestion: v.suggestion,
            contextPoint: `${tierLabel} Token`,
            nodeId: variable.id,
            nodeName: variable.name,
            nodeType: 'Variable',
            fixable: false,
            propertyPath: 'name',
            resolvedType: variable.resolvedType,
            ruleId: v.ruleId,
            nodePath: `${collection.name} > ${variable.name}`,
            sourceValue: variableSourceValue,
            tokenScopes: variableScopes,
            collectionName: collection.name,
            ...tokenMaturityAttach,
          };
          if (colorHex) issueObj.colorHex = colorHex;
          issues.push(issueObj as Issue);
        }

        // ── Missing Description (existing logic) ──────────────────────
        const hasDescription = hasOwnOrSharedVariableDescription(variable, collection.name);
        if (!hasDescription) {
          // === Context Maturity & Auto-Description Engine ===
          const signals = signalsFromVariable(variable, collection.name, colorHex);
          const mcpEnrichInput = toMCPEnrichmentInput(mcpData[variable.name]);
          const notionInput = toNotionComplianceInput(notionCompliance[variable.name]);
          const mr: MaturityResult = maturityEngine.run(signals, mcpEnrichInput, notionInput);

          // Legacy CMP (kept for backward compat with UI rendering); baked rules add design-derived context for maturity
          const bakedRules = await getBakedRules();
          const evalCtx = ContextEvaluator.fromVariable(variable, collection.name, colorHex, bakedRules);
          const maturity = contextEvaluator.evaluate(evalCtx);

          const issueObj: any = {
            id: `${variable.id}-desc`,
            category: 'missing',
            severity: 'warning',
            message: 'Variable is missing a description',
            suggestion: 'Add a description explaining the token\'s purpose and usage',
            contextPoint: 'Variable',
            nodeId: variable.id,
            nodeName: variable.name,
            nodeType: 'Variable',
            fixable: true,
            propertyPath: 'description',
            resolvedType: variable.resolvedType,
            // Legacy CMP data (UI still reads these)
            maturityScore: maturity.score,
            maturityLevel: maturity.level,
            maturityAction: maturity.action,
            maturityDimensions: maturity.dimensions,
            missingElements: maturity.missingElements,
            confidenceNote: maturity.confidenceNote,
            // New engine data
            engineScore: mr.score,
            engineLevel: mr.maturityLevel,
            purposeCategory: mr.purposeCategory,
            engineDimensions: mr.dimensions,
            engineGaps: mr.gaps,
            wasAutoGenerated: mr.wasAutoGenerated,
            reEvaluatedScore: mr.reEvaluatedScore,
            // MCP enrichment data (when available)
            compositeScore: mr.compositeScore,
            reliabilityScore: mr.reliabilityScore,
            purposeFromGit: mr.purposeFromGit,
            // Notion rule compliance data (when available)
            notionComplianceRatio: mr.notionComplianceRatio,
            notionPenalty: mr.notionPenalty,
            notionViolatedCount: mr.notionViolatedCount,
          };

          // For foundation collection: override suggestion with the deterministic 4-slot description
          if (foundationVarMap) {
            const foundVar: FoundationVariable = {
              id: variable.id,
              name: variable.name,
              description: variable.description || '',
              resolvedType: variable.resolvedType as FoundationVariable['resolvedType'],
              scopes: (variable as any).scopes || [],
              valuesByMode: variable.valuesByMode || {},
              variableCollectionId: variable.variableCollectionId,
            };
            const { description: formulaDesc, validationErrors: formulaErrs } =
              generateFoundationDescription(foundVar, foundationVarMap);
            if (formulaDesc && formulaErrs.length === 0) {
              issueObj.suggestedValue = formulaDesc;
              issueObj.suggestedValueFormatted = formulaDesc;
              issueObj.foundationFormulaUsed = true;
            }
          } else if (mr.description && mr.description.length > 0) {
            // The new engine always produces a description when score < 0.5
            issueObj.suggestedValue = mr.description;
            issueObj.suggestedValueFormatted = mr.description;
          }
          if (colorHex) issueObj.colorHex = colorHex;
          issueObj.sourceValue = getVariableSourceValue(variable);
          issueObj.tokenScopes = (variable as any).scopes || [];
          issueObj.collectionName = collection.name;
          const bakedMatch = bakedRules.length ? ContextEvaluator.matchDesignRules(variable.name, bakedRules) : null;
          if (bakedMatch) issueObj.bakedRuleMeaning = bakedMatch.meaning;
          Object.assign(issueObj, tokenMaturityAttach);
          issues.push(issueObj as Issue);
        }

        // ── Foundation: flag non-conformant existing descriptions ────────────
        // Only runs for foundation collection variables that already have a description.
        // Validates against the 4-slot formula and raises a fixable 'poor' issue when
        // the existing text fails one or more quality rules.
        if (hasDescription && foundationVarMap) {
          const foundVar: FoundationVariable = {
            id: variable.id,
            name: variable.name,
            description: variable.description || '',
            resolvedType: variable.resolvedType as FoundationVariable['resolvedType'],
            scopes: (variable as any).scopes || [],
            valuesByMode: variable.valuesByMode || {},
            variableCollectionId: variable.variableCollectionId,
          };
          const conformanceErrors = validateFoundationDescription(
            variable.description || '',
            foundVar,
            foundationVarMap
          );
          if (conformanceErrors.length > 0) {
            // Generate a conforming replacement
            const { description: rewrittenDesc, validationErrors: rewriteErrs } =
              generateFoundationDescription(foundVar, foundationVarMap);

            const conformIssue: any = {
              id: `${variable.id}-desc-nonconformant`,
              category: 'poor',
              severity: 'warning',
              message: 'Description needs work in order to follow the rules of the overall Design System',
              suggestion: conformanceErrors.join('; '),
              contextPoint: 'Variable',
              nodeId: variable.id,
              nodeName: variable.name,
              nodeType: 'Variable',
              fixable: true,   // always show the edit textarea — user can also type manually
              propertyPath: 'description',
              resolvedType: variable.resolvedType,
              sourceValue: variable.description || '',
              tokenScopes: (variable as any).scopes || [],
              collectionName: collection.name,
              foundationConformanceErrors: conformanceErrors,
              ...tokenMaturityAttach,
            };
            if (rewrittenDesc && rewriteErrs.length === 0) {
              conformIssue.suggestedValue = rewrittenDesc;
              conformIssue.suggestedValueFormatted = rewrittenDesc;
            }
            if (colorHex) conformIssue.colorHex = colorHex;
            issues.push(conformIssue as Issue);
          }
        }
      }

      let suppressChildCollectionIssues = isChildCollectionForIssueSuppression(collection.name, variables);
      if (!suppressChildCollectionIssues) {
        suppressChildCollectionIssues = await isLikelyChildCollectionByAliasInheritance(collection, variables);
      }
      const finalIssues = suppressChildCollectionIssues ? [] : issues;
      const score = variables.length === 0 ? 100 : Math.max(0, 100 - finalIssues.length * 15);
      audits.push({
        nodeId: collection.id,
        nodeName: collection.name,
        nodeType: 'VariableCollection',
        score,
        checks: {
          hasDescription: true,
          hasVariants: false,
          hasProperties: false,
          hasDocumentation: false,
          hasDocumentationLink: false,
          properNaming: true,
          hasLayerNames: true,
          hasPropertyDescriptions: false,
          hasVariantDescriptions: false
        },
        issues: finalIssues,
        properties: [],
        variants: []
      });
    }

    // If cancelled, send cancellation message instead of results
    if (scanCancelled) {
      figma.ui.postMessage({ type: 'SCAN_CANCELLED' });
      figma.notify('⛔ Scan cancelled');
      return;
    }

    // Enrich issues with node path
    for (const audit of audits) {
      for (const issue of audit.issues) {
        issue.nodePath = `${audit.nodeName} > ${issue.nodeName}`;
      }
    }

    // ── Append architecture violations as a synthetic audit ──────────────
    if (architectureViolations.length > 0) {
      const archIssues: Issue[] = architectureViolations.map(v => ({
        id: `arch-${v.ruleId}-${v.variableId}`,
        category: v.severity === 'critical' ? 'inconsistent' : 'poor',
        severity: v.severity === 'critical' ? 'critical' : v.severity === 'warning' ? 'warning' : 'info',
        message: v.message,
        suggestion: v.suggestion,
        contextPoint: 'Architecture',
        nodeId: v.variableId,
        nodeName: v.variableName,
        nodeType: 'Variable',
        fixable: false,
        ruleId: v.ruleId,
        collectionName: v.collectionName,
        ...(v.sfId ? { sfId: v.sfId } : {}),
      } as Issue & { collectionName: string; sfId?: string }));

      audits.push({
        nodeId: 'architecture-check',
        nodeName: `Architecture — ${systemInfo ? systemLabel(systemInfo) : 'RADD'}`,
        nodeType: 'VariableCollection',
        score: Math.max(0, 100 - archIssues.filter(i => i.severity === 'critical').length * 20 - archIssues.filter(i => i.severity === 'warning').length * 8),
        checks: {
          hasDescription: true, hasVariants: false, hasProperties: false,
          hasDocumentation: false, hasDocumentationLink: false, properNaming: true,
          hasLayerNames: true, hasPropertyDescriptions: false, hasVariantDescriptions: false,
        },
        issues: archIssues,
        properties: [],
        variants: [],
      });
    }

    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits,
      timestamp: new Date().toISOString(),
      meta: {
        scanType: 'variables',
        usedReverseIndex: !!reverseIndexCache,
        raddVersion: systemInfo?.version ?? 'unknown',
        architectureViolations: architectureViolations.length,
      },
    });

    // Cache for DS Context Maturity and attempt file-level scoring
    cachedDSVars = allDSVars;
    cachedDSCollections = allDSCollections;
    await maybeRunDSMaturity();

    const totalIssues = audits.reduce((sum, a) => sum + a.issues.length, 0);
    figma.notify(`✅ Scanned ${collections.length} variable collections (${totalIssues} issues)`);
  } catch (error) {
    console.error('Variable scan error:', error);
    figma.notify('❌ Error scanning variables');
    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits: [],
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Scan all styles in the document (paint, text, effect).
 * No selection required.
 */
async function scanDocumentStyles(): Promise<void> {
  console.log('=== SCANNING DOCUMENT STYLES ===');

  const audits: ComponentAudit[] = [];

  try {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();

    const styleGroups: { name: string; styles: BaseStyle[] }[] = [
      { name: 'Paint Styles', styles: paintStyles },
      { name: 'Text Styles', styles: textStyles },
      { name: 'Effect Styles', styles: effectStyles }
    ];

    // Build DS Context Maturity style cache
    const allDSStyles: DSStyle[] = [];
    const styleTypeMap: Record<string, 'PAINT' | 'TEXT' | 'EFFECT'> = {
      'Paint Styles': 'PAINT', 'Text Styles': 'TEXT', 'Effect Styles': 'EFFECT',
    };
    for (const group of styleGroups) {
      const dsType = styleTypeMap[group.name] || 'PAINT';
      for (const s of group.styles) {
        allDSStyles.push({
          id: s.id,
          name: s.name,
          description: (s as any).description || '',
          type: dsType,
        });
      }
    }

    for (const group of styleGroups) {
      await yieldToEventLoop();
      if (scanCancelled) break;
      const issues: Issue[] = [];

      // Send progress
      figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Scanning ${group.name} (${group.styles.length} styles)` });

      // ── MCP Enrichment (batch fetch for this style group) ──────────
      let mcpStyleData: Record<string, any> = {};
      if (mcpConnected) {
        try {
          const entities = group.styles.map(s => ({ name: s.name }));
          mcpStyleData = await requestMCPEnrichment(entities);
        } catch { /* non-blocking */ }
      }

      // ── Notion Compliance Verification (batch) ────────────────────
      let notionStyleCompliance: Record<string, any> = {};
      if (notionEnrichedRules.length > 0 && mcpConnected) {
        try {
          const complianceEntities = group.styles
            .filter(s => !hasOwnOrSharedStyleDescription(s, group.name))
            .map(s => ({ name: s.name, entityType: 'style', description: s.description || '' }));
          if (complianceEntities.length > 0) {
            notionStyleCompliance = await requestNotionCompliance(complianceEntities);
          }
        } catch { /* non-blocking */ }
      }

      for (let si = 0; si < group.styles.length; si++) {
        if (si % 10 === 0) await yieldToEventLoop();
        if (scanCancelled) break;
        const style = group.styles[si];

        // ── DS Naming & Structure Validation (runs on ALL styles) ─────
        const styleHasDescription = hasOwnOrSharedStyleDescription(style, group.name);
        const styleValidInput: StyleInput = {
          name: style.name,
          styleType: style.type,
          hasDescription: styleHasDescription,
        };
        const styleNamingViolations = validateStyle(styleValidInput);

        let styleSourceValue = '';
        if (style.type === 'PAINT') styleSourceValue = getPaintStyleSourceValue(style as PaintStyle);
        else if (style.type === 'EFFECT') styleSourceValue = getEffectStyleSourceValue(style as EffectStyle);
        else if (style.type === 'TEXT') styleSourceValue = getTextStyleSourceValue(style as TextStyle);
        const styleColorHex = style.type === 'PAINT' ? getPaintStyleColorHex(style as PaintStyle) : undefined;
        for (const v of styleNamingViolations) {
          const issueObj: any = {
            id: `${style.id}-${v.ruleId}`,
            category: 'poor' as any,
            severity: v.severity,
            message: `[${v.category}] ${v.message}`,
            suggestion: v.suggestion,
            contextPoint: `${group.name.replace(' Styles', '')} Style`,
            nodeId: style.id,
            nodeName: style.name,
            nodeType: style.type,
            fixable: false,
            propertyPath: 'name',
            resolvedType: style.type,
            ruleId: v.ruleId,
            sourceValue: styleSourceValue || undefined,
          };
          if (styleColorHex) issueObj.colorHex = styleColorHex;
          issues.push(issueObj as Issue);
        }

        // ── Missing Description (existing logic) ──────────────────────
        const hasDescription = hasOwnOrSharedStyleDescription(style, group.name);
        if (!hasDescription) {
          let colorHex: string | undefined;
          if (style.type === 'PAINT') {
            colorHex = getPaintStyleColorHex(style as PaintStyle);
          }

          // === Context Maturity & Auto-Description Engine ===
          const styleSignals = signalsFromStyle(
            { name: style.name, description: style.description, type: style.type, paints: style.type === 'PAINT' ? [...(style as PaintStyle).paints] : undefined },
            colorHex
          );
          const mcpEnrichInput = toMCPEnrichmentInput(mcpStyleData[style.name]);
          const notionInput = toNotionComplianceInput(notionStyleCompliance[style.name]);
          const mr: MaturityResult = maturityEngine.run(styleSignals, mcpEnrichInput, notionInput);

          // Legacy CMP (kept for backward compat with UI rendering); baked rules add design-derived context for maturity
          const bakedRules = await getBakedRules();
          const evalCtx = ContextEvaluator.fromStyle(style, colorHex, bakedRules);
          const maturity = contextEvaluator.evaluate(evalCtx);

          const issueObj: any = {
            id: `${style.id}-desc`,
            category: 'missing',
            severity: 'warning',
            message: 'Style is missing a description',
            suggestion: 'Add a description explaining when and how to use this style',
            contextPoint: 'Style',
            nodeId: style.id,
            nodeName: style.name,
            nodeType: style.type,
            fixable: true,
            propertyPath: 'description',
            resolvedType: style.type,
            // Legacy CMP data (UI still reads these)
            maturityScore: maturity.score,
            maturityLevel: maturity.level,
            maturityAction: maturity.action,
            maturityDimensions: maturity.dimensions,
            missingElements: maturity.missingElements,
            confidenceNote: maturity.confidenceNote,
            // New engine data
            engineScore: mr.score,
            engineLevel: mr.maturityLevel,
            purposeCategory: mr.purposeCategory,
            engineDimensions: mr.dimensions,
            engineGaps: mr.gaps,
            wasAutoGenerated: mr.wasAutoGenerated,
            reEvaluatedScore: mr.reEvaluatedScore,
            // MCP enrichment data (when available)
            compositeScore: mr.compositeScore,
            reliabilityScore: mr.reliabilityScore,
            purposeFromGit: mr.purposeFromGit,
            // Notion rule compliance data (when available)
            notionComplianceRatio: mr.notionComplianceRatio,
            notionPenalty: mr.notionPenalty,
            notionViolatedCount: mr.notionViolatedCount,
          };

          // The new engine always produces a description when score < 0.5
          if (mr.description && mr.description.length > 0) {
            issueObj.suggestedValue = mr.description;
            issueObj.suggestedValueFormatted = mr.description;
          }
          if (colorHex) issueObj.colorHex = colorHex;
          if (style.type === 'PAINT') issueObj.sourceValue = getPaintStyleSourceValue(style as PaintStyle);
          else if (style.type === 'EFFECT') issueObj.sourceValue = getEffectStyleSourceValue(style as EffectStyle);
          else if (style.type === 'TEXT') issueObj.sourceValue = getTextStyleSourceValue(style as TextStyle);
          const styleBakedMatch = bakedRules.length ? ContextEvaluator.matchDesignRules(style.name, bakedRules) : null;
          if (styleBakedMatch) issueObj.bakedRuleMeaning = styleBakedMatch.meaning;
          issues.push(issueObj as Issue);
        }
      }

      const total = group.styles.length;
      const score = total === 0 ? 100 : Math.max(0, 100 - issues.length * 15);
      audits.push({
        nodeId: `styles-${group.name.replace(/\s/g, '-')}`,
        nodeName: group.name,
        nodeType: group.name.replace(' ', ''),
        score,
        checks: {
          hasDescription: true,
          hasVariants: false,
          hasProperties: false,
          hasDocumentation: false,
          hasDocumentationLink: false,
          properNaming: true,
          hasLayerNames: true,
          hasPropertyDescriptions: false,
          hasVariantDescriptions: false
        },
        issues,
        properties: [],
        variants: []
      });
    }

    // If cancelled, send cancellation message instead of results
    if (scanCancelled) {
      figma.ui.postMessage({ type: 'SCAN_CANCELLED' });
      figma.notify('⛔ Scan cancelled');
      return;
    }

    // Enrich issues with node path
    for (const audit of audits) {
      for (const issue of audit.issues) {
        issue.nodePath = `${audit.nodeName} > ${issue.nodeName}`;
      }
    }

    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits,
      timestamp: new Date().toISOString()
    });

    // Cache for DS Context Maturity and attempt file-level scoring
    cachedDSStyles = allDSStyles;
    await maybeRunDSMaturity();

    const totalIssues = audits.reduce((sum, a) => sum + a.issues.length, 0);
    const totalStyles = paintStyles.length + textStyles.length + effectStyles.length;
    figma.notify(`✅ Scanned ${totalStyles} styles (${totalIssues} issues)`);
  } catch (error) {
    console.error('Style scan error:', error);
    figma.notify('❌ Error scanning styles');
    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits: [],
      timestamp: new Date().toISOString()
    });
  }
}

// ============================================================================
// Component Token Usage — automatic collection & persistence during scan
// ============================================================================

const COMP_TOKENS_STORAGE_PREFIX = 'ds_comp_tokens_v1_';
const COMP_TOKENS_MAX_DEPTH = 8;
const COMP_TOKENS_MAX_NODES = 300;

interface TokenUsageEntry {
  tokenName: string;
  collection: string;
  resolvedType: string;
  property: string;     // raw Figma property key (e.g. "fills")
  cssProperty: string;  // mapped CSS property (e.g. "fill")
  layer: string;        // node name where the binding lives
  layerRole: string;    // inferred semantic role
}

interface ComponentTokenUsage {
  componentId: string;
  componentName: string;
  scannedAt: string;
  /** Keys are variant names (e.g. "Size=Large, State=Default") or "Default" for plain components */
  variants: Record<string, TokenUsageEntry[]>;
}

function _traverseNodeForTokens(
  node: SceneNode,
  varMap: Map<string, Variable>,
  collMap: Map<string, VariableCollection>,
  results: TokenUsageEntry[],
  depth: number,
  counter: { n: number },
): void {
  if (depth > COMP_TOKENS_MAX_DEPTH || counter.n >= COMP_TOKENS_MAX_NODES) return;
  counter.n++;

  const boundVars = (node as any).boundVariables as Record<string, unknown> | undefined;
  if (boundVars) {
    for (const [prop, binding] of Object.entries(boundVars)) {
      const bindings: unknown[] = Array.isArray(binding) ? binding : [binding];
      for (const b of bindings) {
        if (!b || (b as any).type !== 'VARIABLE_ALIAS') continue;
        const variable = varMap.get((b as any).id);
        if (!variable) continue;
        const collection = collMap.get(variable.variableCollectionId);
        results.push({
          tokenName: variable.name,
          collection: collection?.name ?? '',
          resolvedType: variable.resolvedType,
          property: prop,
          cssProperty: propToCssProperty(prop),
          layer: node.name,
          layerRole: inferLayerRole(node.name),
        });
      }
    }
  }

  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      if (counter.n >= COMP_TOKENS_MAX_NODES) break;
      _traverseNodeForTokens(child as SceneNode, varMap, collMap, results, depth + 1, counter);
    }
  }
}

async function collectAndSaveComponentTokens(
  node: ComponentNode | ComponentSetNode,
  varMap: Map<string, Variable>,
  collMap: Map<string, VariableCollection>,
): Promise<void> {
  const usage: ComponentTokenUsage = {
    componentId: node.id,
    componentName: node.name,
    scannedAt: new Date().toISOString(),
    variants: {},
  };

  if (node.type === 'COMPONENT_SET') {
    for (const child of node.children) {
      if (child.type !== 'COMPONENT') continue;
      const entries: TokenUsageEntry[] = [];
      _traverseNodeForTokens(child as SceneNode, varMap, collMap, entries, 0, { n: 0 });
      usage.variants[child.name] = entries;
    }
  } else {
    // Plain COMPONENT — single "Default" variant
    const entries: TokenUsageEntry[] = [];
    _traverseNodeForTokens(node as SceneNode, varMap, collMap, entries, 0, { n: 0 });
    usage.variants['Default'] = entries;
  }

  await figma.clientStorage.setAsync(COMP_TOKENS_STORAGE_PREFIX + node.id, usage);
}

// ============================================================================
// Scan Function (Components - requires selection)
// ============================================================================

async function scanSelection(config: ScanConfig) {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.notify('⚠️ Please select components to scan');
    return;
  }
  
  console.log('=== STARTING SCAN ===', config);
  console.log('Selection:', selection.map(n => `${n.type}: ${n.name}`));
  
  const audits: ComponentAudit[] = [];
  const SCAN_TIMEOUT_MS = 30_000; // 30 second hard timeout
  const COMPONENT_TIMEOUT_MS = 10_000; // 10 second per-component timeout
  const MAX_SUGGESTION_ISSUES = 80; // Cap CMP evaluation
  const scanStartTime = Date.now();

  /** Returns true when we've exceeded the scan timeout */
  function isTimedOut(): boolean {
    return (Date.now() - scanStartTime) > SCAN_TIMEOUT_MS;
  }

  /** Race an analyzeComponent call against a timeout */
  function analyzeWithTimeout(node: SceneNode): Promise<ComponentAudit | null> {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), COMPONENT_TIMEOUT_MS)
    );
    return Promise.race([
      componentAnalyzer.analyzeComponent(node),
      timeoutPromise
    ]);
  }

  let timedOut = false;

 try {
  // Fetch variable maps once — used for silent token-usage collection per component
  const [_tokVars, _tokColls] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
  ]);
  const _tokVarMap = new Map<string, Variable>();
  _tokVars.forEach(v => _tokVarMap.set(v.id, v));
  const _tokCollMap = new Map<string, VariableCollection>();
  _tokColls.forEach(c => _tokCollMap.set(c.id, c));

  // Component / structure scan (when scanStructure or scanStyles is enabled)
  const runComponentScan = config.scanStructure || config.scanStyles;
  
  let scannedCount = 0;
  const totalSelected = selection.length;

  for (const node of selection) {
    await yieldToEventLoop();
    if (scanCancelled) break;
    if (isTimedOut()) { timedOut = true; break; }
    if (!runComponentScan) continue;
    scannedCount++;
    console.log(`\nScanning ${node.type}: ${node.name}`);

    figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Scanning ${scannedCount}/${totalSelected}: ${node.name}` });
    
    // Scan COMPONENT_SET or COMPONENT
    if (node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') {
      console.log(`  → Analyzing ${node.type.toLowerCase()}...`);
      const audit = await analyzeWithTimeout(node);
      if (audit) {
        audits.push(audit);
        console.log(`  → Found ${audit.issues.length} issues`);
        // Silently collect & persist token usage — fire and forget
        collectAndSaveComponentTokens(node as ComponentNode | ComponentSetNode, _tokVarMap, _tokCollMap)
          .catch(() => { /* non-blocking */ });
      } else {
        console.log(`  → ⏱ Timed out analyzing ${node.name}, skipping`);
        figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Skipped ${node.name} (too complex)` });
      }
    }
    // Scan FRAME or SECTION (find components inside)
    else if (node.type === 'FRAME' || node.type === 'SECTION') {
      const components = node.findAll(n => 
        n.type === 'COMPONENT' || n.type === 'COMPONENT_SET'
      ) as (ComponentNode | ComponentSetNode)[];
      
      console.log(`  → Found ${components.length} components in ${node.type.toLowerCase()}`);
      
      for (let ci = 0; ci < components.length; ci++) {
        await yieldToEventLoop();
        if (scanCancelled) break;
        if (isTimedOut()) { timedOut = true; break; }
        const comp = components[ci];
        figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Scanning ${node.name}: ${ci + 1}/${components.length}` });
        console.log(`    → Analyzing ${comp.type}: ${comp.name}`);
        const audit = await analyzeWithTimeout(comp);
        if (audit) {
          audits.push(audit);
          console.log(`      → ${audit.issues.length} issues`);
          // Silently collect & persist token usage — fire and forget
          collectAndSaveComponentTokens(comp, _tokVarMap, _tokCollMap)
            .catch(() => { /* non-blocking */ });
        } else {
          console.log(`      → ⏱ Timed out, skipping ${comp.name}`);
        }
      }
    }
    // Unsupported node type
    else {
      console.log(`  → Skipping unsupported type: ${node.type}`);
    }
  }
  
  // If cancelled, send cancellation message and stop
  if (scanCancelled) {
    figma.ui.postMessage({ type: 'SCAN_CANCELLED' });
    figma.notify('⛔ Scan cancelled');
    return;
  }
  
  // Cache node lookups to avoid redundant getNodeByIdAsync calls
  const nodeCache = new Map<string, BaseNode | null>();
  async function getCachedNode(id: string): Promise<BaseNode | null> {
    if (nodeCache.has(id)) return nodeCache.get(id)!;
    const node = await figma.getNodeByIdAsync(id);
    nodeCache.set(id, node);
    return node;
  }

  // Generate suggestions for fixable issues (gated by CMP)
  // Capped to MAX_SUGGESTION_ISSUES to prevent long hangs on large component sets
  if (suggestionGenerator && !timedOut) {
    console.log('\n=== GENERATING SUGGESTIONS (with CMP) ===');
    figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: 'Generating suggestions...' });
    let suggestionIdx = 0;
    const totalIssueCount = audits.reduce((sum, a) => sum + a.issues.length, 0);
    const issueLimit = Math.min(totalIssueCount, MAX_SUGGESTION_ISSUES);
    let globalIdx = 0;

    outerSuggestion:
    for (const audit of audits) {
      for (const issue of audit.issues) {
        globalIdx++;
        if (globalIdx > MAX_SUGGESTION_ISSUES) break outerSuggestion;

        suggestionIdx++;
        if (suggestionIdx % 5 === 0) {
          await yieldToEventLoop();
          figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: `Generating suggestions (${suggestionIdx}/${issueLimit})` });
        }
        if (scanCancelled) break outerSuggestion;
        if (isTimedOut()) { timedOut = true; break outerSuggestion; }

        const node = await getCachedNode(issue.nodeId);
        if (!node || !('type' in node) || node.type === 'DOCUMENT') continue;

        // === Context Maturity & Auto-Description Engine (components) ===
        const compSignals = signalsFromComponent(node as any);
        // MCP enrichment for component (single entity)
        const compName = (node as any).name || issue.nodeName;
        let compMcpInput: MCPEnrichmentInput | undefined;
        if (mcpConnected) {
          try {
            const compMcpData = await requestMCPEnrichment([{ name: compName }]);
            compMcpInput = toMCPEnrichmentInput(compMcpData[compName]);
          } catch { /* non-blocking */ }
        }
        // Notion compliance for component
        let compNotionInput: NotionRuleComplianceInput | undefined;
        if (notionEnrichedRules.length > 0 && mcpConnected) {
          try {
            const compDesc = ('description' in node && typeof (node as any).description === 'string') ? (node as any).description : '';
            const compCompliance = await requestNotionCompliance([{ name: compName, entityType: 'component', description: compDesc }]);
            compNotionInput = toNotionComplianceInput(compCompliance[compName]);
          } catch { /* non-blocking */ }
        }
        const mr = maturityEngine.run(compSignals, compMcpInput, compNotionInput);

        // Legacy CMP (kept for backward compat with UI rendering); baked rules add design-derived context for maturity
        const bakedRules = await getBakedRules();
        const evalCtx = ContextEvaluator.fromComponent(node as SceneNode, bakedRules);
        const maturity = contextEvaluator.evaluate(evalCtx);
        const issueAny = issue as any;
        issueAny.maturityScore = maturity.score;
        issueAny.maturityLevel = maturity.level;
        issueAny.maturityAction = maturity.action;
        issueAny.maturityDimensions = maturity.dimensions;
        issueAny.missingElements = maturity.missingElements;
        issueAny.confidenceNote = maturity.confidenceNote;
        // New engine data
        issueAny.engineScore = mr.score;
        issueAny.engineLevel = mr.maturityLevel;
        issueAny.purposeCategory = mr.purposeCategory;
        issueAny.engineDimensions = mr.dimensions;
        issueAny.engineGaps = mr.gaps;
        issueAny.wasAutoGenerated = mr.wasAutoGenerated;
        // MCP enrichment data
        issueAny.compositeScore = mr.compositeScore;
        issueAny.reliabilityScore = mr.reliabilityScore;
        issueAny.purposeFromGit = mr.purposeFromGit;
        // Notion compliance data
        issueAny.notionComplianceRatio = mr.notionComplianceRatio;
        issueAny.notionPenalty = mr.notionPenalty;
        issueAny.notionViolatedCount = mr.notionViolatedCount;

        // Generate suggestion: engine auto-generates when score < 0.5,
        // otherwise fall back to the suggestion generator
        if (mr.wasAutoGenerated && mr.description) {
          issue.suggestedValue = mr.description;
          issue.suggestedValueFormatted = mr.description;
        } else if (issue.fixable && issue.suggestionConfig && maturity.action !== 'CLARIFY') {
          const suggestion = suggestionGenerator.generateSuggestion(issue, node as SceneNode);
          if (suggestion) {
            issue.suggestedValue = suggestion.value;
            issue.suggestedValueFormatted = suggestion.formatted;
          }
        }
      }
    }
    if (totalIssueCount > MAX_SUGGESTION_ISSUES) {
      console.log(`  ⚠️ Suggestion generation capped at ${MAX_SUGGESTION_ISSUES}/${totalIssueCount} issues`);
    }
  }

  // Check cancellation after suggestion generation
  if (scanCancelled) {
    figma.ui.postMessage({ type: 'SCAN_CANCELLED' });
    figma.notify('⛔ Scan cancelled');
    return;
  }
  
  const totalIssuesFinal = audits.reduce((sum, a) => sum + a.issues.length, 0);
  console.log('\n=== SCAN COMPLETE ===');
  console.log(`Total audits: ${audits.length}`);
  console.log(`Total issues: ${totalIssuesFinal}`);
  
  // Enrich each issue with node path (breadcrumb) - use cache, skip if timed out
  if (!timedOut) {
    figma.ui.postMessage({ type: 'SCAN_PROGRESS', message: 'Enriching results...' });
    let enrichIdx = 0;
    outerEnrich:
    for (const audit of audits) {
      for (const issue of audit.issues) {
        enrichIdx++;
        if (enrichIdx % 10 === 0) await yieldToEventLoop();
        if (scanCancelled) break outerEnrich;
        if (isTimedOut()) { timedOut = true; break outerEnrich; }
        const node = await getCachedNode(issue.nodeId);
        if (node && 'name' in node) {
          issue.nodePath = getNodePath(node as BaseNode);
        }
      }
    }
  }

  if (scanCancelled) {
    figma.ui.postMessage({ type: 'SCAN_CANCELLED' });
    figma.notify('⛔ Scan cancelled');
    return;
  }

  // For issues without enriched nodePath, use fallback
  for (const audit of audits) {
    for (const issue of audit.issues) {
      if (!issue.nodePath) {
        issue.nodePath = `${audit.nodeName} > ${issue.nodeName}`;
      }
    }
  }

  // Send results to UI (partial if timed out)
  figma.ui.postMessage({
    type: 'SCAN_COMPLETE',
    audits: audits,
    timestamp: new Date().toISOString(),
    partial: timedOut
  });
  
  // Show summary notification
  const totalIssues = audits.reduce((sum, a) => sum + a.issues.length, 0);
  const criticalCount = audits.reduce((sum, a) => 
    sum + a.issues.filter(i => i.severity === 'critical').length, 0
  );
  
  const elapsed = ((Date.now() - scanStartTime) / 1000).toFixed(1);
  if (totalIssues === 0) {
    figma.notify('🎉 No issues found! Perfect score!');
  } else if (timedOut) {
    figma.notify(`⚠️ Found ${totalIssues} issues (${criticalCount} critical) — partial results (${elapsed}s timeout)`);
  } else {
    figma.notify(`⚠️ Found ${totalIssues} issues (${criticalCount} critical) — completed in ${elapsed}s`);
  }

 } catch (error) {
    // CRITICAL: Guarantee the loading screen is dismissed even on unexpected errors
    console.error('❌ Scan error (caught):', error);
    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits: audits, // send whatever we have so far
      timestamp: new Date().toISOString(),
      partial: true
    });
    figma.notify(`❌ Scan error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ============================================================================
// Design Intelligence Scan — structural extraction (spec v1.0)
// ============================================================================

interface DesignIntelligenceTokenBinding {
  property: string;
  tokenName: string;
  tokenValue: string;
  collection: string;
}

interface DesignIntelligenceHardcoded {
  property: string;
  value: string;
}

interface DesignIntelligenceNode {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  tokens: DesignIntelligenceTokenBinding[];
  hardcodedValues: DesignIntelligenceHardcoded[];
  children?: DesignIntelligenceNode[];
}

function variableValueToString(v: Variable): string {
  const modeId = Object.keys(v.valuesByMode)[0];
  if (!modeId) return '';
  const raw = v.valuesByMode[modeId];
  if (raw === undefined) return '';
  if (v.resolvedType === 'COLOR' && typeof raw === 'object' && raw !== null && 'r' in raw) {
    const r = Math.round((raw as { r: number }).r * 255);
    const g = Math.round((raw as { g: number }).g * 255);
    const b = Math.round((raw as { b: number }).b * 255);
    const a = (raw as { a?: number }).a ?? 1;
    if (a < 1) return `rgba(${r},${g},${b},${a.toFixed(2)})`;
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  if (v.resolvedType === 'FLOAT' || v.resolvedType === 'STRING' || v.resolvedType === 'BOOLEAN') return String(raw);
  return String(raw);
}

function extractDesignIntelligenceTokenBindings(
  node: SceneNode,
  varMap: Map<string, Variable>,
  collMap: Map<string, VariableCollection>
): DesignIntelligenceTokenBinding[] {
  const nodeAny = node as any;
  const bound = nodeAny.boundVariables || {};
  const bindings: DesignIntelligenceTokenBinding[] = [];
  for (const [prop, binding] of Object.entries(bound)) {
    const arr = Array.isArray(binding) ? binding : [binding];
    for (const b of arr) {
      const alias = b as { id?: string };
      const id = alias && alias.id;
      if (!id) continue;
      const variable = varMap.get(id);
      if (!variable) continue;
      const collection = collMap.get(variable.variableCollectionId);
      const collectionName = collection?.name ?? 'unknown';
      bindings.push({
        property: prop,
        tokenName: variable.name,
        tokenValue: variableValueToString(variable),
        collection: collectionName,
      });
    }
  }
  return bindings;
}

function extractDesignIntelligenceHardcoded(node: SceneNode): DesignIntelligenceHardcoded[] {
  const n = node as { boundVariables?: Record<string, unknown>; fills?: ReadonlyArray<Paint>; strokes?: ReadonlyArray<Paint>; opacity?: number };
  const out: DesignIntelligenceHardcoded[] = [];
  const bound = n.boundVariables ?? {};
  const fills = n.fills;
  if (fills && Array.isArray(fills) && !bound.fills) {
    for (const fill of fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID') {
        const c = fill.color;
        const hex = '#' + [c.r, c.g, c.b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
        out.push({ property: 'fill', value: hex });
        break;
      }
    }
  }
  const strokes = n.strokes;
  if (strokes && Array.isArray(strokes) && !bound.strokes) {
    for (const stroke of strokes) {
      if (stroke.visible === false) continue;
      if (stroke.type === 'SOLID') {
        const c = stroke.color;
        const hex = '#' + [c.r, c.g, c.b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
        out.push({ property: 'stroke', value: hex });
        break;
      }
    }
  }
  if (n.opacity !== undefined && n.opacity < 1 && !bound.opacity) {
    out.push({ property: 'opacity', value: String(Math.round(n.opacity * 100) + '%') });
  }
  return out;
}

const DESIGN_INTELLIGENCE_MAX_NODES = 120;
const DESIGN_INTELLIGENCE_MAX_DEPTH = 4;
const DESIGN_INTELLIGENCE_MAX_CHILDREN_PER_NODE = 12;

function extractDesignIntelligenceStructure(
  node: SceneNode,
  depth: number,
  maxDepth: number,
  varMap: Map<string, Variable>,
  collMap: Map<string, VariableCollection>,
  nodeCount: { current: number }
): DesignIntelligenceNode {
  if (nodeCount.current >= DESIGN_INTELLIGENCE_MAX_NODES) {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      width: (node as { width?: number }).width ?? 0,
      height: (node as { height?: number }).height ?? 0,
      tokens: [],
      hardcodedValues: [],
    };
  }
  nodeCount.current += 1;
  const n = node as { width?: number; height?: number };
  const width = typeof n.width === 'number' ? n.width : 0;
  const height = typeof n.height === 'number' ? n.height : 0;
  const tokens = extractDesignIntelligenceTokenBindings(node, varMap, collMap);
  const hardcodedValues = extractDesignIntelligenceHardcoded(node);
  const result: DesignIntelligenceNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    width,
    height,
    tokens,
    hardcodedValues,
  };
  if (depth < maxDepth && 'children' in node) {
    const children = (node as ChildrenMixin).children as SceneNode[];
    const slice = children.slice(0, DESIGN_INTELLIGENCE_MAX_CHILDREN_PER_NODE);
    result.children = slice.map(c =>
      extractDesignIntelligenceStructure(c, depth + 1, maxDepth, varMap, collMap, nodeCount)
    );
  }
  return result;
}

// ============================================================================
// AI Design Analysis — node metadata extractor (legacy / lightweight)
// ============================================================================

function extractAINodeMeta(node: SceneNode, depth: number): Record<string, unknown> {
  const n = node as any;
  const meta: Record<string, unknown> = { name: n.name, type: n.type };

  if (n.layoutMode && n.layoutMode !== 'NONE') meta.layoutMode = n.layoutMode;
  if (n.paddingTop !== undefined) meta.padding = { top: n.paddingTop, right: n.paddingRight, bottom: n.paddingBottom, left: n.paddingLeft };
  if (n.itemSpacing !== undefined) meta.gap = n.itemSpacing;
  if (n.cornerRadius !== undefined && n.cornerRadius > 0) meta.cornerRadius = n.cornerRadius;
  if (n.opacity !== undefined && n.opacity < 1) meta.opacity = n.opacity;
  if (n.visible === false) meta.hidden = true;
  if (n.fills?.length) meta.fillsCount = n.fills.length;
  if (n.fillStyleId) meta.fillStyleId = String(n.fillStyleId).split(':')[0];
  if (n.textStyleId) meta.textStyleId = String(n.textStyleId).split(':')[0];
  if (n.fontSize) meta.fontSize = n.fontSize;
  if (n.fontWeight) meta.fontWeight = n.fontWeight;
  if (n.characters) meta.text = String(n.characters).substring(0, 100);

  if (n.boundVariables && Object.keys(n.boundVariables).length > 0) {
    const bv: Record<string, string[]> = {};
    for (const prop of Object.keys(n.boundVariables)) {
      const binding = n.boundVariables[prop];
      const arr = Array.isArray(binding) ? binding : [binding];
      bv[prop] = arr.map((b: any) => b?.id ?? '').filter(Boolean);
    }
    meta.boundVariables = bv;
  }

  if (n.componentProperties) meta.componentProperties = Object.keys(n.componentProperties);

  if (depth < 3 && n.children?.length) {
    meta.childCount = n.children.length;
    meta.children = (n.children as SceneNode[]).slice(0, 12).map(c => extractAINodeMeta(c, depth + 1));
  }
  return meta;
}

// Auto-run on selection change (optional)
// ============================================================================

// Uncomment to enable auto-scan on selection change:
// figma.on('selectionchange', () => {
//   if (figma.currentPage.selection.length > 0) {
//     scanSelection();
//   }
// });

// ============================================================================
// Learning Layer Message Handlers
// ============================================================================

// ── WIZARD: Module-level undo stack ────────────────────────────────────────
// Declared at module scope so it persists across message invocations and is
// never re-initialised. Stack is capped at 5 snapshots, cleared on plugin reload.
interface WizUndoSnapshot {
  label: string;
  vars: Array<{ id: string; modeId: string; value: RGBA | VariableAlias | undefined }>;
}
const _wizSnapshots: WizUndoSnapshot[] = [];

async function _wizSnapAndPush(label: string, variables: Variable[], modeId: string): Promise<void> {
  const snapshot = variables.map(v => ({
    id: v.id,
    modeId,
    value: v.valuesByMode[modeId] as RGBA | VariableAlias | undefined,
  }));
  _wizSnapshots.push({ label, vars: snapshot });
  if (_wizSnapshots.length > 5) _wizSnapshots.shift();
  console.log('[wizard-undo] snapshot pushed:', label, 'vars=' + snapshot.length, 'stack=' + _wizSnapshots.length);
  figma.ui.postMessage({ type: 'WIZARD_UNDO_COUNT', count: _wizSnapshots.length });
}

// Appended to the existing figma.ui.onmessage handler via a secondary listener.
// These handlers are additive — they do not replace the primary handler above.
figma.ui.on('message', async (msg: { type: string; [key: string]: unknown }) => {
  // ── PROCESS_SCAN_LEARNING ──────────────────────────────────────────────────
  if (msg.type === 'PROCESS_SCAN_LEARNING') {
    try {
      await learningEngine.processScanResult(msg.scanResult as Parameters<typeof learningEngine.processScanResult>[0]);
      figma.ui.postMessage({ type: 'LEARNING_COMPLETE' });
    } catch (err) {
      console.error('[Learning] processScanResult failed:', err);
      figma.ui.postMessage({ type: 'LEARNING_ERROR', error: String(err) });
    }
    return;
  }

  // ── RUN_AI_ANALYSIS ───────────────────────────────────────────────────────
  if (msg.type === 'RUN_AI_ANALYSIS') {
    try {
      const result = await aiAnalysisModule.analyze({
        apiKey: String(msg.apiKey ?? ''),
        analysisPrompt: String(
          msg.prompt ??
            'Analyze this design system scan and identify patterns, anomalies, and recommendations.'
        ),
        scanSummary: JSON.stringify(msg.scanSummary),
      });
      await knowledgeBase.addInsights(result.insights);
      figma.ui.postMessage({ type: 'AI_ANALYSIS_COMPLETE', insights: result.insights });
    } catch (err) {
      console.error('[Learning] AI analysis failed:', err);
      figma.ui.postMessage({ type: 'AI_ANALYSIS_ERROR', error: String(err) });
    }
    return;
  }

  // ── GET_KB_SUMMARY ────────────────────────────────────────────────────────
  if (msg.type === 'GET_KB_SUMMARY') {
    const data = await knowledgeBase.load();
    figma.ui.postMessage({
      type: 'KB_SUMMARY',
      summary: {
        patternCount: data.patterns.length,
        ruleCount: data.rules.length,
        scoreHistoryCount: data.scoreHistory.length,
        insightCount: data.aiInsights.length,
        updatedAt: data.updatedAt,
      },
    });
    return;
  }

  // ── EXPORT_KB ─────────────────────────────────────────────────────────────
  if (msg.type === 'EXPORT_KB') {
    const json = await knowledgeBase.export();
    figma.ui.postMessage({ type: 'KB_EXPORT', json });
    return;
  }

  // ── CONFIRM_RULE ──────────────────────────────────────────────────────────
  if (msg.type === 'CONFIRM_RULE') {
    const rules = await knowledgeBase.getRules();
    const rule = rules.find(r => r.id === String(msg.ruleId));
    if (rule) {
      rule.confirmedByUser = true;
      if (msg.meaning) rule.meaning = String(msg.meaning);
      await knowledgeBase.mergeRules(rules);
    }
    figma.ui.postMessage({ type: 'RULE_CONFIRMED', ruleId: msg.ruleId });
    return;
  }

  // ── RECORD_DESCRIPTION_FEEDBACK ───────────────────────────────────────────
  if (msg.type === 'RECORD_DESCRIPTION_FEEDBACK') {
    await feedbackProcessor.recordDescriptionFeedback(
      String(msg.componentId ?? ''),
      String(msg.componentName ?? ''),
      String(msg.description ?? ''),
      (msg.quality as 'excellent' | 'good' | 'poor' | 'unrated') ?? 'unrated',
      (msg.generatedBy as 'ai' | 'manual') ?? 'manual'
    );
    figma.ui.postMessage({ type: 'DESCRIPTION_FEEDBACK_RECORDED' });
    return;
  }

  // ── CLEAR_KB ──────────────────────────────────────────────────────────────
  if (msg.type === 'CLEAR_KB') {
    await knowledgeBase.clear();
    figma.ui.postMessage({ type: 'KB_CLEARED' });
    return;
  }

  // ── GET_RULES (for the dedicated Rules panel) ─────────────────────────────
  if (msg.type === 'GET_RULES') {
    const rules = await knowledgeBase.getRules();
    figma.ui.postMessage({ type: 'RULES_DATA', rules });
    return;
  }

  // ── SYNC_TO_NOTION ────────────────────────────────────────────────────────
  if (msg.type === 'SYNC_TO_NOTION') {
    try {
      const syncConfig: SyncConfig = { notion: msg.notionConfig as SyncConfig['notion'] };
      const adapter = new SyncAdapter(syncConfig);
      const insights = await knowledgeBase.getInsights();
      const result = await adapter.pushInsightsToNotion(insights);
      // If the DB was just created, persist the new databaseId
      if (result.databaseId && syncConfig.notion) {
        syncConfig.notion.databaseId = result.databaseId;
        const raw = await figma.clientStorage.getAsync('dsci_sync_config');
        const saved = raw ? (JSON.parse(raw as string) as SyncConfig) : {};
        saved.notion = syncConfig.notion;
        await figma.clientStorage.setAsync('dsci_sync_config', JSON.stringify(saved));
      }
      figma.ui.postMessage({
        type: 'SYNC_TO_NOTION_COMPLETE',
        databaseId: result.databaseId,
        created: result.created,
        errors: result.errors,
      });
    } catch (err) {
      console.error('[Learning] Notion sync failed:', err);
      figma.ui.postMessage({ type: 'SYNC_TO_NOTION_ERROR', error: String(err) });
    }
    return;
  }

  // ── SYNC_TO_GITHUB ────────────────────────────────────────────────────────
  // msg.githubConfig  — SyncConfig['github'] (token, owner, repo, branch, paths)
  // msg.foundationsRawJson — optional: raw Figma token export JSON string
  //                          (pass null / omit to skip the foundationsJson path)
  if (msg.type === 'SYNC_TO_GITHUB') {
    try {
      const syncConfig: SyncConfig = { github: msg.githubConfig as SyncConfig['github'] };
      const adapter = new SyncAdapter(syncConfig);

      const [componentsJson, foundationsJson] = await Promise.all([
        knowledgeBase.exportSlice('component'),
        knowledgeBase.exportSlice('foundation'),
      ]);

      const foundationsRawJson =
        typeof msg.foundationsRawJson === 'string' ? msg.foundationsRawJson : null;

      const result = await adapter.pushSplitToGitHub(
        componentsJson,
        foundationsJson,
        foundationsRawJson
      );

      figma.ui.postMessage({
        type: 'SYNC_TO_GITHUB_COMPLETE',
        results: {
          components: result.components.success,
          foundations: result.foundations.success,
          foundationsJson: result.foundationsJson.success,
        },
      });
    } catch (err) {
      console.error('[Learning] GitHub sync failed:', err);
      figma.ui.postMessage({ type: 'SYNC_TO_GITHUB_ERROR', error: String(err) });
    }
    return;
  }

  // ── PULL_FROM_GITHUB ──────────────────────────────────────────────────────
  // Pull a specific path back from GitHub.
  // msg.githubConfig — SyncConfig['github']
  // msg.target       — 'components' | 'foundations' | 'foundationsJson'
  if (msg.type === 'PULL_FROM_GITHUB') {
    try {
      const syncConfig: SyncConfig = { github: msg.githubConfig as SyncConfig['github'] };
      const adapter = new SyncAdapter(syncConfig);
      const target = msg.target as 'components' | 'foundations' | 'foundationsJson';
      const content = await adapter.pullFromGitHub(target);
      figma.ui.postMessage({ type: 'PULL_FROM_GITHUB_COMPLETE', target, content });
    } catch (err) {
      console.error('[Learning] GitHub pull failed:', err);
      figma.ui.postMessage({ type: 'PULL_FROM_GITHUB_ERROR', error: String(err) });
    }
    return;
  }

  // ── SEED_DS_KNOWLEDGE ─────────────────────────────────────────────────────
  // Receives pre-fetched DS assistant MCP results from the UI and stores them
  // in the KB. The UI is responsible for querying the MCP (it has network access);
  // the plugin stores and indexes the results.
  if (msg.type === 'SEED_DS_KNOWLEDGE') {
    try {
      const raw = msg.results as MCPKnowledgeResult[];
      const entries = dsKnowledgeSeeder.fromMCPResults(raw, 'ds_assistant');
      await knowledgeBase.mergeExternalKnowledge(entries);
      // Re-derive rules immediately so new knowledge boosts confidence right away
      const [patterns, externalKnowledge] = await Promise.all([
        knowledgeBase.getPatterns(),
        knowledgeBase.getExternalKnowledge('ds_assistant'),
      ]);
      const { RuleDeriver } = await import('./learning/RuleDeriver');
      const deriver = new RuleDeriver();
      const updatedRules = deriver.derive(patterns, externalKnowledge);
      await knowledgeBase.mergeRules(updatedRules);
      figma.ui.postMessage({
        type: 'DS_KNOWLEDGE_SEEDED',
        count: entries.length,
        externallyValidatedRules: updatedRules.filter(r => r.externallyValidated).length,
      });
    } catch (err) {
      console.error('[Learning] DS knowledge seed failed:', err);
      figma.ui.postMessage({ type: 'DS_KNOWLEDGE_SEED_ERROR', error: String(err) });
    }
    return;
  }

  // ── INFER_COMPONENT_TYPES ─────────────────────────────────────────────────
  // UI sends a scan result; plugin returns the component type keywords it can
  // infer. UI uses these to query the DS assistant MCP for each type, then
  // calls SEED_DS_KNOWLEDGE with the results.
  if (msg.type === 'INFER_COMPONENT_TYPES') {
    const scanResult = msg.scanResult as Parameters<typeof learningEngine.processScanResult>[0];
    const inferred = dsKnowledgeSeeder.inferComponentTypesFromScan(scanResult);
    const cached = await knowledgeBase.getExternalKnowledge('ds_assistant');
    const missing = dsKnowledgeSeeder.missingTypes(inferred, cached);
    figma.ui.postMessage({ type: 'COMPONENT_TYPES_INFERRED', inferred, missing });
    return;
  }

  // ── GET_EXTERNAL_KNOWLEDGE ────────────────────────────────────────────────
  if (msg.type === 'GET_EXTERNAL_KNOWLEDGE') {
    const entries = await knowledgeBase.getExternalKnowledge(
      msg.source as string | undefined,
      msg.componentType as string | undefined
    );
    figma.ui.postMessage({ type: 'EXTERNAL_KNOWLEDGE_DATA', entries });
    return;
  }

  // ── GENERATE_FOUNDATION_DESCRIPTIONS (dry-run) ───────────────────────────
  // Generates descriptions for all variables in the 'foundation' collection
  // and returns a report without writing anything.
  // msg.force — boolean: when true, also generate for vars that already have descriptions
  if (msg.type === 'GENERATE_FOUNDATION_DESCRIPTIONS') {
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const allVars = await figma.variables.getLocalVariablesAsync();

      const foundationColl = collections.find(c => c.name === 'foundation');
      if (!foundationColl) {
        figma.ui.postMessage({
          type: 'FOUNDATION_DESCRIPTIONS_ERROR',
          error: 'No collection named "foundation" found in this file.',
        });
        return;
      }

      const varMap: Record<string, FoundationVariable> = {};
      for (const v of allVars) {
        varMap[v.id] = {
          id: v.id,
          name: v.name,
          description: v.description,
          resolvedType: v.resolvedType as FoundationVariable['resolvedType'],
          scopes: v.scopes as string[],
          valuesByMode: v.valuesByMode as Record<string, unknown>,
          variableCollectionId: v.variableCollectionId,
        };
      }

      const foundVars = allVars
        .filter(v => v.variableCollectionId === foundationColl.id)
        .map(v => varMap[v.id]);

      const force = msg.force === true;
      const results = generateFoundationDescriptions(foundVars, varMap, force);
      const report = buildRunReport(results);

      figma.ui.postMessage({
        type: 'FOUNDATION_DESCRIPTIONS_PREVIEW',
        report,
        results,
      });
    } catch (err) {
      console.error('[FoundationGen] Dry-run failed:', err);
      figma.ui.postMessage({
        type: 'FOUNDATION_DESCRIPTIONS_ERROR',
        error: String(err),
      });
    }
    return;
  }

  // ── WRITE_FOUNDATION_DESCRIPTIONS ────────────────────────────────────────
  // Writes the approved descriptions (from a prior dry-run) to Figma variables.
  // msg.approved — Array<{ varId: string; description: string }>
  if (msg.type === 'WRITE_FOUNDATION_DESCRIPTIONS') {
    try {
      const approved = (msg.approved as Array<{ varId: string; description: string }>) ?? [];
      let written = 0;
      const errors: Array<{ varId: string; error: string }> = [];

      // Chunk to avoid blocking the main thread
      const chunkSize = 50;
      for (let i = 0; i < approved.length; i += chunkSize) {
        const chunk = approved.slice(i, i + chunkSize);
        for (const { varId, description } of chunk) {
          try {
            const variable = await figma.variables.getVariableByIdAsync(varId);
            if (!variable) {
              errors.push({ varId, error: 'Variable not found' });
              continue;
            }
            variable.description = description;
            written++;
          } catch (e: unknown) {
            errors.push({ varId, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }

      figma.ui.postMessage({
        type: 'FOUNDATION_DESCRIPTIONS_WRITTEN',
        written,
        errors,
      });
    } catch (err) {
      console.error('[FoundationGen] Write failed:', err);
      figma.ui.postMessage({
        type: 'FOUNDATION_DESCRIPTIONS_ERROR',
        error: String(err),
      });
    }
    return;
  }

  // ── WIZARD: DETECT_ARCHITECTURE ──────────────────────────────────────────
  if (msg.type === 'WIZARD_DETECT_ARCHITECTURE') {
    try {
      const arch = await detectFileArchitecture();
      figma.ui.postMessage({ type: 'WIZARD_ARCHITECTURE', data: arch });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'detect_architecture', error: String(err) });
    }
    return;
  }

  // ── WIZARD: GENERATE_SHADES ───────────────────────────────────────────────
  if (msg.type === 'WIZARD_GENERATE_SHADES') {
    try {
      const palette = generateTonalPalette(String(msg.seedHex ?? ''));
      const shades  = generateShadeScale(String(msg.seedHex ?? ''));
      // context is echoed back so the UI knows which palette preview to update
      figma.ui.postMessage({ type: 'WIZARD_SHADES', palette, shades, context: msg.context ?? 'brand' });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'generate_shades', error: String(err) });
    }
    return;
  }

  // ── WIZARD: APPLY_FULL_CONFIG ─────────────────────────────────────────────
  if (msg.type === 'WIZARD_APPLY_CONFIG') {
    try {
      const result = await wizardApplyFullConfig(msg.config as WizardConfig);
      figma.ui.postMessage({ type: 'WIZARD_CONFIG_APPLIED', data: result });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'apply_config', error: String(err) });
    }
    return;
  }

  // ── WIZARD: GET_FOUNDATION_COLORS ────────────────────────────────────────
  // Reads from '.core': brand seed color (COLOR) and font family (STRING under font-family/).
  // Returns: { seedColor?, fontFamily? }
  if (msg.type === 'WIZARD_GET_FOUNDATION_COLORS') {
    try {
      const wizColls = await figma.variables.getLocalVariableCollectionsAsync();

      // Build modeId → modeName map
      const wizModeNameMap = new Map<string, string>();
      for (const col of wizColls) {
        for (const mode of (col as any).modes || []) {
          if (mode.modeId && mode.name) wizModeNameMap.set(mode.modeId, mode.name);
        }
      }

      const wizAllVars = await figma.variables.getLocalVariablesAsync();
      const wizCache = new Map<string, string | undefined>();

      // ── Read font families from .core only (brand color is now fetched separately) ──
      let fontFamily: string | undefined;
      let fontFamilySecondary: string | undefined;
      const coreColl = wizColls.find((c: any) => c.name === '.core') ??
                       wizColls.find((c: any) => c.name === 'core');
      if (coreColl) {
        const fonts = await readFontFamiliesFromCore(coreColl);
        fontFamily = fonts.primary;
        fontFamilySecondary = fonts.secondary;
      }

      figma.ui.postMessage({ type: 'WIZARD_FOUNDATION_COLORS', fontFamily, fontFamilySecondary });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'get_foundation_colors', error: String(err) });
    }
    return;
  }

  // ── WIZARD: GET_FILE_NAME ─────────────────────────────────────────────────
  // The UI can request the current file name at any time (e.g. to display in the header).
  // Also returns the saved DS display name (if any) so the wizard can show it.
  if (msg.type === 'WIZARD_GET_FILE_NAME') {
    figma.clientStorage.getAsync(DS_SETTINGS_STORAGE_KEY).then((stored: unknown) => {
      const config = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
      const savedName = typeof config.name === 'string' ? config.name.trim() : '';
      figma.ui.postMessage({ type: 'WIZARD_FILE_NAME', name: figma.root.name || '', savedName });
    }).catch(() => {
      figma.ui.postMessage({ type: 'WIZARD_FILE_NAME', name: figma.root.name || '', savedName: '' });
    });
    return;
  }

  // ── WIZARD: SAVE_DS_NAME ──────────────────────────────────────────────────
  // Saves only the DS display name, merging into existing settings.
  if (msg.type === 'WIZARD_SAVE_DS_NAME') {
    const newName = String((msg as any).name || '').trim();
    figma.clientStorage.getAsync(DS_SETTINGS_STORAGE_KEY).then((stored: unknown) => {
      const config: Record<string, unknown> = stored && typeof stored === 'object' ? { ...(stored as object) } : {};
      config.name = newName;
      return figma.clientStorage.setAsync(DS_SETTINGS_STORAGE_KEY, config).then(() => config);
    }).then((config: Record<string, unknown>) => {
      figma.ui.postMessage({ type: 'WIZARD_DS_NAME_SAVED', name: newName });
      // Also update DS_SETTINGS_LOADED so the main header reflects the new name
      figma.ui.postMessage({ type: 'DS_SETTINGS_LOADED', config, fileName: figma.root.name || '' });
    }).catch((e: unknown) => {
      figma.ui.postMessage({ type: 'WIZARD_DS_NAME_ERROR', error: String((e as Error)?.message ?? e) });
    });
    return;
  }

  // ── WIZARD: GET_SECONDARY_COLORS ─────────────────────────────────────────
  // Scans '.core' collection for variables under the group 'core-colours/secondary/'.
  // Groups them by sub-folder name (the folder between 'secondary/' and the shade number).
  // Returns: { secondaries: Array<{ name, hex500, shadeCount, shades: Record<string,string> }> }
  if (msg.type === 'WIZARD_GET_SECONDARY_COLORS') {
    try {
      const secColls = await figma.variables.getLocalVariableCollectionsAsync();
      const secModeNameMap = new Map<string, string>();
      for (const c of secColls) {
        for (const m of c.modes) secModeNameMap.set(m.modeId, m.name);
      }
      const coreColl = secColls.find(c => c.name === '.core');
      if (!coreColl) {
        figma.ui.postMessage({ type: 'WIZARD_SECONDARY_COLORS', secondaries: [] });
        return;
      }
      const allVars = await figma.variables.getLocalVariablesAsync();
      const coreVars = allVars.filter(v => v.variableCollectionId === coreColl.id);

      // Collect variables under 'core-colours/secondary/{name}/{shade}'
      const PREFIX = 'core-colours/secondary/';
      const groups: Record<string, { shade: string; hex: string }[]> = {};

      for (const v of coreVars) {
        if (v.resolvedType !== 'COLOR') continue;
        if (!v.name.startsWith(PREFIX)) continue;
        const rest = v.name.slice(PREFIX.length); // e.g. "purple/500"
        const slashIdx = rest.indexOf('/');
        if (slashIdx < 0) continue;
        const groupName = rest.slice(0, slashIdx);   // e.g. "purple"
        const shade     = rest.slice(slashIdx + 1);  // e.g. "500"
        if (!groups[groupName]) groups[groupName] = [];
        // resolve hex using the single .core mode
        const modeId = coreColl.modes[0]?.modeId;
        const hex = modeId ? await getVariableColorHex(v, undefined, undefined, secModeNameMap) : undefined;
        groups[groupName].push({ shade, hex: hex ?? '' });
      }

      const secondaries = Object.keys(groups).sort().map(name => {
        const shades = groups[name];
        const shade500 = shades.find(s => s.shade === '500');
        const hex500 = shade500?.hex ?? shades[0]?.hex ?? '';
        const shadesMap: Record<string, string> = {};
        shades.forEach(s => { if (s.shade) shadesMap[s.shade] = s.hex; });
        return { name, hex500, shadeCount: shades.length, shades: shadesMap };
      });

      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_COLORS', secondaries });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_COLORS', secondaries: [], error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: DELETE_SECONDARY ──────────────────────────────────────────────
  // Deletes all variables in '.core' under core-colours/secondary/{name}/.
  if (msg.type === 'WIZARD_DELETE_SECONDARY') {
    try {
      const delName: string = String(msg.name);
      const delPrefix = `core-colours/secondary/${delName}/`;
      const delColls = await figma.variables.getLocalVariableCollectionsAsync();
      const delCore = delColls.find(c => c.name === '.core');
      if (!delCore) {
        figma.ui.postMessage({ type: 'WIZARD_SECONDARY_DELETED', name: delName, ok: false, error: '.core not found' });
        return;
      }
      const delVars = await figma.variables.getLocalVariablesAsync();
      const toDelete = delVars.filter(v => v.variableCollectionId === delCore.id && v.name.startsWith(delPrefix));
      for (const v of toDelete) v.remove();
      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_DELETED', name: delName, ok: true, count: toDelete.length });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_DELETED', name: msg.name, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: Undo handler ────────────────────────────────────────────────
  // Pops the most recent snapshot and restores each variable's previous value.
  if (msg.type === 'WIZARD_UNDO') {
    console.log('[wizard-undo] UNDO received; stack=' + _wizSnapshots.length);
    const snap = _wizSnapshots.pop();
    if (!snap) {
      console.log('[wizard-undo] stack empty — nothing to undo');
      figma.ui.postMessage({ type: 'WIZARD_UNDO_COUNT', count: 0 });
      figma.ui.postMessage({ type: 'WIZARD_UNDO_DONE', label: 'nothing', count: 0 });
      return;
    }
    try {
      const snapAny = snap as unknown as { _styleSnap?: { styleId: string; field: string; variableId: string | null } };
      let restoredCount = 0;
      if (snapAny._styleSnap) {
        // Restore a text style variable binding
        const { styleId, field, variableId } = snapAny._styleSnap;
        const style = await figma.getStyleByIdAsync(styleId);
        if (style && style.type === 'TEXT') {
          const ts = style as TextStyle;
          const oldVar = variableId ? await figma.variables.getVariableByIdAsync(variableId) : null;
          await figma.loadFontAsync(ts.fontName);
          ts.setBoundVariable(field as VariableBindableTextField, oldVar);
          restoredCount = 1;
        }
      } else {
        // Restore variable values
        const allVars = await figma.variables.getLocalVariablesAsync();
        for (const entry of snap.vars) {
          const v = allVars.find(x => x.id === entry.id);
          if (v && entry.value !== undefined) {
            v.setValueForMode(entry.modeId, entry.value as RGBA);
            restoredCount++;
          }
        }
      }
      console.log('[wizard-undo] restored ' + restoredCount + ' item(s) for "' + snap.label + '"');
      figma.ui.postMessage({ type: 'WIZARD_UNDO_DONE', label: snap.label, count: _wizSnapshots.length, restored: restoredCount });
    } catch (e: any) {
      console.error('[wizard-undo] UNDO error:', e);
      figma.ui.postMessage({ type: 'WIZARD_UNDO_ERROR', error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: SAVE_SECONDARY ────────────────────────────────────────────────
  // Writes updated shade hex values back to '.core' under core-colours/secondary/{name}/.
  // Existing variables are updated; any missing shades are created.
  if (msg.type === 'WIZARD_SAVE_SECONDARY') {
    try {
      const saveName: string = String(msg.name);
      const saveShades: Record<string, string> = (msg.shades && typeof msg.shades === 'object') ? (msg.shades as Record<string, string>) : {};
      const saveColls = await figma.variables.getLocalVariableCollectionsAsync();
      const saveCore = saveColls.find(c => c.name === '.core');
      if (!saveCore) {
        figma.ui.postMessage({ type: 'WIZARD_SECONDARY_SAVED', name: saveName, ok: false, error: '.core not found' });
        return;
      }
      const saveModeId = saveCore.modes[0]?.modeId;
      if (!saveModeId) throw new Error('.core has no modes');
      const saveVars = await figma.variables.getLocalVariablesAsync();
      const prefix = `core-colours/secondary/${saveName}/`;
      // Index existing vars by shade
      const existing: Record<string, Variable> = {};
      for (const v of saveVars) {
        if (v.variableCollectionId === saveCore.id && v.name.startsWith(prefix)) {
          const shade = v.name.slice(prefix.length);
          existing[shade] = v;
        }
      }
      // Snapshot current values before overwriting
      await _wizSnapAndPush(`secondary/${saveName}`, Object.values(existing), saveModeId);
      const resultShades: Record<string, string> = {};
      for (const [shade, hexStr] of Object.entries(saveShades)) {
        if (!/^#[0-9A-Fa-f]{6}$/i.test(hexStr)) continue;
        const r = parseInt(hexStr.slice(1,3),16)/255;
        const g = parseInt(hexStr.slice(3,5),16)/255;
        const b = parseInt(hexStr.slice(5,7),16)/255;
        const colorVal: RGBA = { r, g, b, a: 1 };
        let variable = existing[shade];
        if (!variable) {
          variable = figma.variables.createVariable(`${prefix}${shade}`, saveCore, 'COLOR');
        }
        variable.setValueForMode(saveModeId, colorVal);
        resultShades[shade] = hexStr.toUpperCase();
      }
      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_SAVED', name: saveName, ok: true, shades: resultShades });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_SECONDARY_SAVED', name: msg.name, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: GET_BRAND_COLORS ──────────────────────────────────────────────
  // Scans '.core' for variables under 'core-colours/brand/Primary/{name}/{shade}'.
  // Returns the two sub-folders (brand-light, brand-dark) as editable palette groups.
  if (msg.type === 'WIZARD_GET_BRAND_COLORS') {
    try {
      const brColls = await figma.variables.getLocalVariableCollectionsAsync();
      const brModeNameMap = new Map<string, string>();
      for (const c of brColls) {
        for (const m of c.modes) brModeNameMap.set(m.modeId, m.name);
      }
      const brCore = brColls.find(c => c.name === '.core') ??
                     brColls.find(c => c.name === 'core') ??
                     brColls.find(c => c.name.toLowerCase() === '.core');
      if (!brCore) {
        figma.ui.postMessage({ type: 'WIZARD_BRAND_COLORS', brands: [], standalone: [] });
        return;
      }
      const brAllVars = await figma.variables.getLocalVariablesAsync();
      const brCoreVars = brAllVars.filter(v => v.variableCollectionId === brCore.id);

      // ── Candidate prefixes — checked in priority order ────────────────────
      // We try the canonical path first, then progressively broader patterns so
      // alternative architectures (brand-light/ at root, brand/brand-light/, etc.)
      // are also recognised and displayed the same way.
      const BRAND_CANDIDATE_PREFIXES = [
        'core-colours/brand/Primary/',   // canonical: Primary sub-folder
        'core-colours/brand/',           // no Primary sub-folder
        'core-colours/brand-light/',     // flat: brand-light at root
        'core-colours/brand-dark/',      // flat: brand-dark at root
      ];

      const brGroups: Record<string, { shade: string; hex: string }[]> = {};
      const brGroupNamed: Record<string, { name: string; hex: string; varName: string }[]> = {};
      const brStandalone: { name: string; hex: string; varName: string }[] = [];

      // Track which variable IDs have already been processed to avoid double-counting
      const processedVarIds = new Set<string>();

      for (const prefix of BRAND_CANDIDATE_PREFIXES) {
        const matching = brCoreVars.filter(
          v => v.resolvedType === 'COLOR' && v.name.startsWith(prefix) && !processedVarIds.has(v.id)
        );
        if (matching.length === 0) continue;

        for (const v of matching) {
          processedVarIds.add(v.id);
          const rest = v.name.slice(prefix.length); // e.g. "brand-light/500", "500", "brand"
          const slashIdx = rest.indexOf('/');
          const hex = await getVariableColorHex(v, undefined, undefined, brModeNameMap);

          if (slashIdx < 0) {
            // No sub-folder: determine whether this is a named standalone or belongs to a group
            // For flat prefixes like core-colours/brand-light/, the group IS the prefix leaf
            const groupFromPrefix = prefix.replace('core-colours/', '').replace(/\/$/, ''); // e.g. "brand-light"
            const isFlatGroup = groupFromPrefix.includes('light') || groupFromPrefix.includes('dark');
            if (isFlatGroup) {
              // Treat as shade/named token inside the flat group
              if (isNaN(parseInt(rest, 10))) {
                if (!brGroupNamed[groupFromPrefix]) brGroupNamed[groupFromPrefix] = [];
                brGroupNamed[groupFromPrefix].push({ name: rest, hex: hex ?? '', varName: v.name });
              } else {
                if (!brGroups[groupFromPrefix]) brGroups[groupFromPrefix] = [];
                brGroups[groupFromPrefix].push({ shade: rest, hex: hex ?? '' });
              }
            } else {
              brStandalone.push({ name: rest, hex: hex ?? '', varName: v.name });
            }
          } else {
            const groupName = rest.slice(0, slashIdx);
            const shade     = rest.slice(slashIdx + 1);
            if (isNaN(parseInt(shade, 10))) {
              if (!brGroupNamed[groupName]) brGroupNamed[groupName] = [];
              brGroupNamed[groupName].push({ name: shade, hex: hex ?? '', varName: v.name });
            } else {
              if (!brGroups[groupName]) brGroups[groupName] = [];
              brGroups[groupName].push({ shade, hex: hex ?? '' });
            }
          }
        }
      }

      // Sort groups: brand-light first, brand-dark second, others alphabetically
      const sortedKeys = Object.keys(brGroups).sort((a, b) => {
        const order = (k: string) => k.includes('light') ? 0 : k.includes('dark') ? 1 : 2;
        return order(a) - order(b);
      });

      const brands = sortedKeys.map(name => {
        const shades = brGroups[name];
        const shade500 = shades.find(s => s.shade === '500');
        const hex500 = shade500?.hex ?? shades[0]?.hex ?? '';
        const shadesMap: Record<string, string> = {};
        shades.forEach(s => { if (s.shade) shadesMap[s.shade] = s.hex; });
        const namedTokens = brGroupNamed[name] ?? [];
        return { name, hex500, shadeCount: shades.length, shades: shadesMap, namedTokens };
      });

      // Debug hint if still nothing found
      const debugPaths = brands.length === 0 && brStandalone.length === 0
        ? brCoreVars.filter(v => v.name.toLowerCase().includes('brand')).slice(0, 8).map(v => v.name)
        : undefined;
      figma.ui.postMessage({ type: 'WIZARD_BRAND_COLORS', brands, standalone: brStandalone, debugPaths });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_BRAND_COLORS', brands: [], standalone: [], error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: SAVE_BRAND ────────────────────────────────────────────────────
  // Writes updated shades to '.core' under core-colours/brand/Primary/{name}/{shade}.
  if (msg.type === 'WIZARD_SAVE_BRAND') {
    try {
      const brSaveName: string = String(msg.name);
      const brSaveShades: Record<string, string> = (msg.shades && typeof msg.shades === 'object') ? (msg.shades as Record<string, string>) : {};
      const brSaveColls = await figma.variables.getLocalVariableCollectionsAsync();
      const brSaveCore = brSaveColls.find(c => c.name === '.core');
      if (!brSaveCore) {
        figma.ui.postMessage({ type: 'WIZARD_BRAND_SAVED', name: brSaveName, ok: false, error: '.core not found' });
        return;
      }
      const brSaveModeId = brSaveCore.modes[0]?.modeId;
      if (!brSaveModeId) throw new Error('.core has no modes');
      const brSaveVars = await figma.variables.getLocalVariablesAsync();
      const brPrefix = `core-colours/brand/Primary/${brSaveName}/`;
      const brExisting: Record<string, Variable> = {};
      for (const v of brSaveVars) {
        if (v.variableCollectionId === brSaveCore.id && v.name.startsWith(brPrefix)) {
          const shade = v.name.slice(brPrefix.length);
          brExisting[shade] = v;
        }
      }
      await _wizSnapAndPush(`brand/${brSaveName}`, Object.values(brExisting), brSaveModeId);
      const brResultShades: Record<string, string> = {};
      for (const [shade, hexStr] of Object.entries(brSaveShades)) {
        if (!/^#[0-9A-Fa-f]{6}$/i.test(hexStr)) continue;
        const r = parseInt(hexStr.slice(1,3),16)/255;
        const g = parseInt(hexStr.slice(3,5),16)/255;
        const b = parseInt(hexStr.slice(5,7),16)/255;
        const colorVal: RGBA = { r, g, b, a: 1 };
        let variable = brExisting[shade];
        if (!variable) {
          variable = figma.variables.createVariable(`${brPrefix}${shade}`, brSaveCore, 'COLOR');
        }
        variable.setValueForMode(brSaveModeId, colorVal);
        brResultShades[shade] = hexStr.toUpperCase();
      }
      figma.ui.postMessage({ type: 'WIZARD_BRAND_SAVED', name: brSaveName, ok: true, shades: brResultShades });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_BRAND_SAVED', name: msg.name, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: SAVE_BRAND_TOKEN ──────────────────────────────────────────────
  // Updates a single standalone token using its exact varName (full path in .core).
  if (msg.type === 'WIZARD_SAVE_BRAND_TOKEN') {
    try {
      const brtName:    string = String(msg.tokenName);  // e.g. "brand"
      const brtVarName: string = String(msg.varName);    // full path e.g. "core-colours/brand/Primary/brand-light/brand"
      const brtHex:     string = String(msg.hex ?? '');
      if (!/^#[0-9A-Fa-f]{6}$/i.test(brtHex)) {
        figma.ui.postMessage({ type: 'WIZARD_BRAND_TOKEN_SAVED', tokenName: brtName, ok: false, error: 'Invalid hex' });
        return;
      }
      const brtColls = await figma.variables.getLocalVariableCollectionsAsync();
      const brtCore = brtColls.find(c => c.name === '.core');
      if (!brtCore) {
        figma.ui.postMessage({ type: 'WIZARD_BRAND_TOKEN_SAVED', tokenName: brtName, ok: false, error: '.core not found' });
        return;
      }
      const brtModeId = brtCore.modes[0]?.modeId;
      if (!brtModeId) throw new Error('.core has no modes');
      const brtAllVars = await figma.variables.getLocalVariablesAsync();
      let brtVar = brtAllVars.find(v => v.variableCollectionId === brtCore.id && v.name === brtVarName);
      // Snapshot the existing var (if any) BEFORE overwriting so undo can restore it
      if (brtVar) await _wizSnapAndPush(`brand-token/${brtName}`, [brtVar], brtModeId);
      if (!brtVar) brtVar = figma.variables.createVariable(brtVarName, brtCore, 'COLOR');
      const r = parseInt(brtHex.slice(1,3),16)/255;
      const g = parseInt(brtHex.slice(3,5),16)/255;
      const b = parseInt(brtHex.slice(5,7),16)/255;
      brtVar.setValueForMode(brtModeId, { r, g, b, a: 1 });
      figma.ui.postMessage({ type: 'WIZARD_BRAND_TOKEN_SAVED', tokenName: brtName, hex: brtHex.toUpperCase(), ok: true });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_BRAND_TOKEN_SAVED', tokenName: msg.tokenName, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: GET_FUNCTIONAL_COLORS ────────────────────────────────────────
  // Scans '.core' collection for variables under 'core-colours/functional/{name}/{shade}'.
  // Groups by sub-folder name (success, warning, danger, info, etc.).
  // Returns: { functionals: Array<{ name, hex500, shadeCount, shades: Record<string,string> }> }
  // ── WIZARD: GET_BASE_COLORS ───────────────────────────────────────────────
  // Scans '.core' for variables under 'core-colours/base/'.
  // Sub-folders become editable palette groups; flat tokens become standalone items.
  if (msg.type === 'WIZARD_GET_BASE_COLORS') {
    try {
      const baseColls = await figma.variables.getLocalVariableCollectionsAsync();
      const baseModeNameMap = new Map<string, string>();
      for (const c of baseColls) {
        for (const m of c.modes) baseModeNameMap.set(m.modeId, m.name);
      }
      const baseCore = baseColls.find(c => c.name === '.core') ??
                       baseColls.find(c => c.name === 'core') ??
                       baseColls.find(c => c.name.toLowerCase() === '.core');
      if (!baseCore) {
        figma.ui.postMessage({ type: 'WIZARD_BASE_COLORS', groups: [], standalone: [] });
        return;
      }
      const baseAllVars = await figma.variables.getLocalVariablesAsync();
      const baseCoreVars = baseAllVars.filter(v => v.variableCollectionId === baseCore.id);

      // Scan both base/ flat tokens and grey/gray/ palette groups
      const BASE_PREFIXES = [
        { prefix: 'core-colours/base/',  asGroup: false }, // flat tokens (white, black, …)
        { prefix: 'core-colours/grey/',  asGroup: true  }, // grey tonal palette
        { prefix: 'core-colours/gray/',  asGroup: true  }, // alternate spelling
      ];
      const baseGroups: Record<string, { shade: string; hex: string }[]> = {};
      const baseStandalone: { name: string; hex: string; varName: string }[] = [];
      const baseProcessed = new Set<string>();

      for (const { prefix, asGroup } of BASE_PREFIXES) {
        for (const v of baseCoreVars) {
          if (v.resolvedType !== 'COLOR') continue;
          if (!v.name.startsWith(prefix)) continue;
          if (baseProcessed.has(v.id)) continue;
          baseProcessed.add(v.id);

          const rest = v.name.slice(prefix.length);
          const slashIdx = rest.indexOf('/');
          const hex = await getVariableColorHex(v, undefined, undefined, baseModeNameMap);

          if (asGroup) {
            // Everything under grey/ is a palette group.
            // If no sub-folder: shade is the token name itself (e.g. "500")
            // If sub-folder: groupName/shade
            if (slashIdx < 0) {
              const groupName = prefix.replace('core-colours/', '').replace(/\/$/, ''); // "grey" or "gray"
              if (!baseGroups[groupName]) baseGroups[groupName] = [];
              baseGroups[groupName].push({ shade: rest, hex: hex ?? '' });
            } else {
              const groupName = rest.slice(0, slashIdx);
              const shade     = rest.slice(slashIdx + 1);
              if (!baseGroups[groupName]) baseGroups[groupName] = [];
              baseGroups[groupName].push({ shade, hex: hex ?? '' });
            }
          } else {
            // base/ — flat standalone or sub-group
            if (slashIdx < 0) {
              baseStandalone.push({ name: rest, hex: hex ?? '', varName: v.name });
            } else {
              const groupName = rest.slice(0, slashIdx);
              const shade     = rest.slice(slashIdx + 1);
              if (!baseGroups[groupName]) baseGroups[groupName] = [];
              baseGroups[groupName].push({ shade, hex: hex ?? '' });
            }
          }
        }
      }

      // Sort standalone: named first (white, black, etc.), then numeric ascending
      baseStandalone.sort((a, b) => {
        const aNum = parseInt(a.name, 10);
        const bNum = parseInt(b.name, 10);
        if (isNaN(aNum) && isNaN(bNum)) return a.name.localeCompare(b.name);
        if (isNaN(aNum)) return -1;
        if (isNaN(bNum)) return 1;
        return aNum - bNum;
      });

      const groups = Object.keys(baseGroups).sort().map(name => {
        const shades = baseGroups[name];
        const shade500 = shades.find(s => s.shade === '500');
        const hex500 = shade500?.hex ?? shades[0]?.hex ?? '';
        const shadesMap: Record<string, string> = {};
        shades.forEach(s => { if (s.shade) shadesMap[s.shade] = s.hex; });
        return { name, hex500, shadeCount: shades.length, shades: shadesMap };
      });

      figma.ui.postMessage({ type: 'WIZARD_BASE_COLORS', groups, standalone: baseStandalone });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_BASE_COLORS', groups: [], standalone: [], error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: SAVE_BASE ─────────────────────────────────────────────────────
  // Writes updated shades or a single token back to '.core' under core-colours/base/.
  if (msg.type === 'WIZARD_SAVE_BASE') {
    try {
      const bsSaveName:   string = String(msg.name);
      const bsVarName:    string | undefined = msg.varName ? String(msg.varName) : undefined;
      const bsSaveShades: Record<string, string> = (msg.shades && typeof msg.shades === 'object') ? (msg.shades as Record<string, string>) : {};
      const bsSingleHex:  string | undefined = msg.hex ? String(msg.hex) : undefined;
      const bsColls = await figma.variables.getLocalVariableCollectionsAsync();
      const bsCore = bsColls.find(c => c.name === '.core') ?? bsColls.find(c => c.name === 'core');
      if (!bsCore) {
        figma.ui.postMessage({ type: 'WIZARD_BASE_SAVED', name: bsSaveName, ok: false, error: '.core not found' });
        return;
      }
      const bsModeId = bsCore.modes[0]?.modeId;
      if (!bsModeId) throw new Error('.core has no modes');
      const bsAllVars = await figma.variables.getLocalVariablesAsync();

      const toRGBA = (hexStr: string): RGBA => {
        const r = parseInt(hexStr.slice(1,3),16)/255;
        const g = parseInt(hexStr.slice(3,5),16)/255;
        const b = parseInt(hexStr.slice(5,7),16)/255;
        return { r, g, b, a: 1 };
      };

      if (bsVarName && bsSingleHex && /^#[0-9A-Fa-f]{6}$/i.test(bsSingleHex)) {
        // Single standalone token save — snapshot the one var
        let bsVar = bsAllVars.find(v => v.variableCollectionId === bsCore.id && v.name === bsVarName);
        if (bsVar) await _wizSnapAndPush(`base-token/${bsSaveName}`, [bsVar], bsModeId);
        if (!bsVar) bsVar = figma.variables.createVariable(bsVarName, bsCore, 'COLOR');
        bsVar.setValueForMode(bsModeId, toRGBA(bsSingleHex));
        figma.ui.postMessage({ type: 'WIZARD_BASE_SAVED', name: bsSaveName, varName: bsVarName, hex: bsSingleHex.toUpperCase(), ok: true });
      } else {
        // Group palette save — resolve the correct prefix by finding an existing var first
        const bsCandidatePrefixes = [
          `core-colours/base/${bsSaveName}/`,
          `core-colours/grey/${bsSaveName}/`,
          `core-colours/gray/${bsSaveName}/`,
          `core-colours/grey/`,
          `core-colours/gray/`,
        ];
        let bsPrefix = `core-colours/base/${bsSaveName}/`;
        for (const cp of bsCandidatePrefixes) {
          if (bsAllVars.some(v => v.variableCollectionId === bsCore.id && v.name.startsWith(cp))) {
            bsPrefix = cp; break;
          }
        }
        const bsExisting: Record<string, Variable> = {};
        for (const v of bsAllVars) {
          if (v.variableCollectionId === bsCore.id && v.name.startsWith(bsPrefix)) {
            bsExisting[v.name.slice(bsPrefix.length)] = v;
          }
        }
        await _wizSnapAndPush(`base/${bsSaveName}`, Object.values(bsExisting), bsModeId);
        const bsResultShades: Record<string, string> = {};
        for (const [shade, hexStr] of Object.entries(bsSaveShades)) {
          if (!/^#[0-9A-Fa-f]{6}$/i.test(hexStr)) continue;
          let variable = bsExisting[shade];
          if (!variable) variable = figma.variables.createVariable(`${bsPrefix}${shade}`, bsCore, 'COLOR');
          variable.setValueForMode(bsModeId, toRGBA(hexStr));
          bsResultShades[shade] = hexStr.toUpperCase();
        }
        figma.ui.postMessage({ type: 'WIZARD_BASE_SAVED', name: bsSaveName, ok: true, shades: bsResultShades });
      }
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_BASE_SAVED', name: msg.name, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  if (msg.type === 'WIZARD_GET_FUNCTIONAL_COLORS') {
    try {
      const fnColls = await figma.variables.getLocalVariableCollectionsAsync();
      const fnModeNameMap = new Map<string, string>();
      for (const c of fnColls) {
        for (const m of c.modes) fnModeNameMap.set(m.modeId, m.name);
      }
      const fnCore = fnColls.find(c => c.name === '.core');
      if (!fnCore) {
        figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_COLORS', functionals: [] });
        return;
      }
      const fnAllVars = await figma.variables.getLocalVariablesAsync();
      const fnCoreVars = fnAllVars.filter(v => v.variableCollectionId === fnCore.id);

      const FN_PREFIX = 'core-colours/functional/';
      const fnGroups: Record<string, { shade: string; hex: string }[]> = {};

      for (const v of fnCoreVars) {
        if (v.resolvedType !== 'COLOR') continue;
        if (!v.name.startsWith(FN_PREFIX)) continue;
        const rest = v.name.slice(FN_PREFIX.length); // e.g. "success/500"
        const slashIdx = rest.indexOf('/');
        if (slashIdx < 0) continue;
        const groupName = rest.slice(0, slashIdx);
        const shade     = rest.slice(slashIdx + 1);
        if (!fnGroups[groupName]) fnGroups[groupName] = [];
        const hex = await getVariableColorHex(v, undefined, undefined, fnModeNameMap);
        fnGroups[groupName].push({ shade, hex: hex ?? '' });
      }

      const functionals = Object.keys(fnGroups).sort().map(name => {
        const shades = fnGroups[name];
        const shade500 = shades.find(s => s.shade === '500');
        const hex500 = shade500?.hex ?? shades[0]?.hex ?? '';
        const shadesMap: Record<string, string> = {};
        shades.forEach(s => { if (s.shade) shadesMap[s.shade] = s.hex; });
        return { name, hex500, shadeCount: shades.length, shades: shadesMap };
      });

      figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_COLORS', functionals });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_COLORS', functionals: [], error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: SAVE_FUNCTIONAL ───────────────────────────────────────────────
  // Writes updated shade hex values to '.core' under core-colours/functional/{name}/.
  if (msg.type === 'WIZARD_SAVE_FUNCTIONAL') {
    try {
      const fnSaveName: string = String(msg.name);
      const fnSaveShades: Record<string, string> = (msg.shades && typeof msg.shades === 'object') ? (msg.shades as Record<string, string>) : {};
      const fnSaveColls = await figma.variables.getLocalVariableCollectionsAsync();
      const fnSaveCore = fnSaveColls.find(c => c.name === '.core');
      if (!fnSaveCore) {
        figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_SAVED', name: fnSaveName, ok: false, error: '.core not found' });
        return;
      }
      const fnSaveModeId = fnSaveCore.modes[0]?.modeId;
      if (!fnSaveModeId) throw new Error('.core has no modes');
      const fnSaveVars = await figma.variables.getLocalVariablesAsync();
      const fnPrefix = `core-colours/functional/${fnSaveName}/`;
      const fnExisting: Record<string, Variable> = {};
      for (const v of fnSaveVars) {
        if (v.variableCollectionId === fnSaveCore.id && v.name.startsWith(fnPrefix)) {
          const shade = v.name.slice(fnPrefix.length);
          fnExisting[shade] = v;
        }
      }
      await _wizSnapAndPush(`functional/${fnSaveName}`, Object.values(fnExisting), fnSaveModeId);
      const fnResultShades: Record<string, string> = {};
      for (const [shade, hexStr] of Object.entries(fnSaveShades)) {
        if (!/^#[0-9A-Fa-f]{6}$/i.test(hexStr)) continue;
        const r = parseInt(hexStr.slice(1,3),16)/255;
        const g = parseInt(hexStr.slice(3,5),16)/255;
        const b = parseInt(hexStr.slice(5,7),16)/255;
        const colorVal: RGBA = { r, g, b, a: 1 };
        let variable = fnExisting[shade];
        if (!variable) {
          variable = figma.variables.createVariable(`${fnPrefix}${shade}`, fnSaveCore, 'COLOR');
        }
        variable.setValueForMode(fnSaveModeId, colorVal);
        fnResultShades[shade] = hexStr.toUpperCase();
      }
      figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_SAVED', name: fnSaveName, ok: true, shades: fnResultShades });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'WIZARD_FUNCTIONAL_SAVED', name: msg.name, ok: false, error: String(e?.message ?? e) });
    }
    return;
  }

  // ── WIZARD: GET_PREVIEW_TOKENS ────────────────────────────────────────────
  // Reads the exact token values the preview card needs from the 'foundation'
  // collection, resolving through alias chains using the Neutral mode.
  // Returns a flat { key: cssValue } map that the UI applies as CSS custom props.
  if (msg.type === 'WIZARD_GET_PREVIEW_TOKENS') {
    try {
      const pvColls = await figma.variables.getLocalVariableCollectionsAsync();
      const pvModeNameMap = new Map<string, string>();
      for (const col of pvColls) {
        for (const mode of (col as any).modes || []) {
          if (mode.modeId && mode.name) pvModeNameMap.set(mode.modeId, mode.name);
        }
      }

      const pvAllVars = await figma.variables.getLocalVariablesAsync();
      const pvFoundColl = pvColls.find((c: any) => c.name === 'foundation');

      if (!pvFoundColl) {
        figma.ui.postMessage({ type: 'WIZARD_PREVIEW_TOKENS', tokens: {} });
        return;
      }

      // Map: foundation variable name → CSS token key
      const TOKEN_MAP: Record<string, { key: string; unit?: string }> = {
        'colours/basic/background':        { key: 'bg' },
        'colours/basic/background-subtle': { key: 'surface' },
        'colours/basic/text':              { key: 'text' },
        'colours/basic/text-recessive':    { key: 'text-muted' },
        'colours/basic/stroke':            { key: 'stroke' },
        'radius/medium':                   { key: 'radius',      unit: 'px' },
        'radius/full':                     { key: 'radius-full', unit: 'px' },
        'spacing/component/1':             { key: 'space-1',     unit: 'px' },
        'spacing/component/2':             { key: 'space-2',     unit: 'px' },
        'spacing/component/3':             { key: 'space-3',     unit: 'px' },
        'spacing/component/5':             { key: 'space-5',     unit: 'px' },
        'spacing/component/6':             { key: 'space-6',     unit: 'px' },
        'typography/title-l/font-family':  { key: 'font-title' },
        'typography/title-l/size':         { key: 'title-size',  unit: 'px' },
        'typography/title-l/line-height':  { key: 'title-lh',   unit: 'px' },
        'typography/title-l/letter-spacing':{ key: 'title-ls',  unit: 'px' },
        'typography/title-l/weight':       { key: 'title-weight' },
        'typography/body-s-bold/font-family':{ key: 'font-body-s' },
        'typography/body-s-bold/size':     { key: 'body-s-size', unit: 'px' },
        'typography/body-s-bold/line-height':{ key: 'body-s-lh', unit: 'px' },
        'typography/body-s-bold/weight':   { key: 'body-s-weight' },
        'typography/body-m-bold/font-family':{ key: 'font-body-m' },
        'typography/body-m-bold/size':     { key: 'body-m-size', unit: 'px' },
        'typography/body-m-bold/line-height':{ key: 'body-m-lh', unit: 'px' },
        'typography/body-m-bold/weight':   { key: 'body-m-weight' },
      };

      // Build name → variable lookup
      const pvVarByName: Record<string, Variable> = {};
      for (const v of pvAllVars) {
        if (v.variableCollectionId === pvFoundColl.id) pvVarByName[v.name] = v as Variable;
      }

      const pvColorCache = new Map<string, string | undefined>();
      const tokens: Record<string, string> = {};

      for (const [tokenName, { key, unit }] of Object.entries(TOKEN_MAP)) {
        const v = pvVarByName[tokenName];
        if (!v) continue;
        try {
          if (v.resolvedType === 'COLOR') {
            const hex = await getVariableColorHex(v, pvColorCache, undefined, pvModeNameMap);
            if (hex) tokens[key] = hex;
          } else if (v.resolvedType === 'FLOAT') {
            const num = await resolveVariableFloat(v, pvModeNameMap);
            if (num !== null) tokens[key] = unit ? `${num}${unit}` : String(num);
          } else if (v.resolvedType === 'STRING') {
            const str = await resolveVariableString(v);
            if (str !== null) tokens[key] = str;
          }
        } catch (_) { /* skip this token */ }
      }

      figma.ui.postMessage({ type: 'WIZARD_PREVIEW_TOKENS', tokens });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_PREVIEW_TOKENS', tokens: {} });
    }
    return;
  }

  // ── WIZARD: Breakpoint typography text styles + tokens (Styles sub-step) ─
  if (msg.type === 'WIZARD_BP_TYPO_FETCH') {
    try {
      const all = await figma.getLocalTextStylesAsync();
      const filtered = all.filter(s => isBreakpointTypographyStyleName(s.name));
      const styles = filtered.map(s => snapshotTextStyle(s));
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const bpColl = collections.find(c => c.name === '.breakpoint') ?? null;
      const bpModeId = bpColl?.modes[0]?.modeId;
      if (bpModeId) await enrichBreakpointTextStyleSnapshots(styles, bpModeId);
      const tokens = await getBreakpointTypographyTokenOptions();
      const styleGroups = groupTypographyTokensByStyle(tokens);
      try {
        figma.ui.postMessage({
          type: 'WIZARD_BP_TYPO_DATA',
          styles,
          tokens,
          styleGroups,
          breakpointCollectionModeId: bpModeId ?? '',
        });
      } catch (postErr) {
        figma.ui.postMessage({
          type: 'WIZARD_ERROR',
          op: 'bp_typo_fetch',
          error: `Could not send data to UI (${String(postErr)}). Try a smaller file or fewer variables.`,
        });
      }
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'bp_typo_fetch', error: String(err) });
    }
    return;
  }

  // ── WIZARD: Semantic colors (non-.core collections whose COLOR vars can alias .core) ─
  if (msg.type === 'WIZARD_SEMANTIC_COLORS_FETCH') {
    const mFetch = msg as { collectionId?: string };
    try {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const coreColl =
        collections.find(c => c.name === '.core') ?? collections.find(c => c.name === 'core') ?? null;
      const allVars = await figma.variables.getLocalVariablesAsync();
      const coreVars = coreColl
        ? allVars.filter(v => v.variableCollectionId === coreColl.id && v.resolvedType === 'COLOR')
        : [];
      const coreOptions: Array<{ id: string; name: string; hex: string | null }> = [];
      if (coreColl) {
        sortVariablesLikeFigmaPanel(coreVars, coreColl);
        const coreModeId = coreColl.modes[0]?.modeId ?? '';
        for (const v of coreVars) {
          const hex = (await getVariableColorHexForMode(v, coreModeId)) ?? null;
          coreOptions.push({ id: v.id, name: v.name || '', hex });
        }
      }
      if (!coreColl) {
        figma.ui.postMessage({
          type: 'WIZARD_SEMANTIC_COLORS_DATA',
          rows: [],
          semanticCollections: [],
          selectedCollectionId: '',
          coreOptions,
          semanticModeId: '',
          coreModeId: '',
          semanticCollectionName: null,
          coreCollectionName: null,
          semanticResolutionReason: 'no_core',
        });
        return;
      }
      const coreCollId = coreColl.id;
      type CollSummary = {
        id: string;
        name: string;
        colorCount: number;
        aliasToCoreCount: number;
      };
      const candidates: CollSummary[] = [];
      for (const c of collections) {
        if (isRemoteCollection(c)) continue;
        if (isSemanticWizardExcludedCollection(c.name)) continue;
        if (c.id === coreCollId) continue;
        const colorVars = allVars.filter(
          v => v.variableCollectionId === c.id && v.resolvedType === 'COLOR',
        );
        if (colorVars.length === 0) continue;
        const modeId = c.modes[0]?.modeId ?? '';
        if (!modeId) continue;
        let aliasToCoreCount = 0;
        for (const v of colorVars) {
          if (await isDirectColorAliasToCore(v, modeId, coreCollId)) aliasToCoreCount++;
        }
        candidates.push({
          id: c.id,
          name: c.name,
          colorCount: colorVars.length,
          aliasToCoreCount,
        });
      }
      candidates.sort((a, b) => compareVariablePathName(a.name, b.name));
      /** Segment tabs: collections with at least one **direct** alias (one hop) into `.core`. */
      const connectedCollections = candidates.filter(s => s.aliasToCoreCount > 0);
      if (candidates.length === 0) {
        figma.ui.postMessage({
          type: 'WIZARD_SEMANTIC_COLORS_DATA',
          rows: [],
          semanticCollections: [],
          selectedCollectionId: '',
          coreOptions,
          semanticModeId: '',
          coreModeId: coreColl.modes[0]?.modeId ?? '',
          semanticCollectionName: null,
          coreCollectionName: coreColl.name,
          semanticResolutionReason: 'no_semantic_collections',
        });
        return;
      }
      const requestedId = mFetch.collectionId;
      function pickDefaultCollectionId(): string {
        if (requestedId) {
          if (connectedCollections.some(s => s.id === requestedId)) return requestedId;
          if (candidates.some(s => s.id === requestedId)) return requestedId;
        }
        if (connectedCollections.length > 0) {
          let best = connectedCollections[0];
          for (const s of connectedCollections) {
            if (s.aliasToCoreCount > best.aliasToCoreCount) best = s;
            else if (
              s.aliasToCoreCount === best.aliasToCoreCount &&
              compareVariablePathName(s.name, best.name) < 0
            ) {
              best = s;
            }
          }
          return best.id;
        }
        return candidates[0].id;
      }
      const selectedId = pickDefaultCollectionId();
      const semanticColl = collections.find(c => c.id === selectedId) ?? null;
      const semanticModeId = semanticColl?.modes[0]?.modeId ?? '';
      if (!semanticColl || !semanticModeId) {
        figma.ui.postMessage({
          type: 'WIZARD_SEMANTIC_COLORS_DATA',
          rows: [],
          semanticCollections: connectedCollections.map(s => ({
            id: s.id,
            name: s.name,
            colorCount: s.colorCount,
            aliasToCoreCount: s.aliasToCoreCount,
          })),
          selectedCollectionId: '',
          coreOptions,
          semanticModeId: '',
          coreModeId: coreColl.modes[0]?.modeId ?? '',
          semanticCollectionName: null,
          coreCollectionName: coreColl.name,
          semanticResolutionReason: 'invalid_selection',
        });
        return;
      }
      const semanticVars = allVars.filter(
        v => v.variableCollectionId === semanticColl.id && v.resolvedType === 'COLOR',
      );
      sortVariablesLikeFigmaPanel(semanticVars, semanticColl);
      const rows: Array<{
        id: string;
        name: string;
        selectedCoreId: string | null;
        connectionChain: string;
        resolvedHex: string | null;
      }> = [];
      // Order matches Figma Variables: same as semanticVars (sorted by name above).
      for (const v of semanticVars) {
        const r = await followColorAliasChainToCore(v, semanticModeId, coreCollId, 12);
        let connectionChain: string;
        if (r.hasRawPrimitive) connectionChain = 'Raw color (not an alias)';
        else if (r.chainLabels.length === 0) connectionChain = '—';
        else if (r.coreTargetId != null) connectionChain = r.chainLabels.join(' → ');
        else connectionChain = `${r.chainLabels.join(' → ')} (does not end in .core)`;
        const resolvedHex = (await getVariableColorHexForMode(v, semanticModeId)) ?? null;
        rows.push({
          id: v.id,
          name: v.name || '',
          selectedCoreId: r.coreTargetId,
          connectionChain,
          resolvedHex,
        });
      }
      figma.ui.postMessage({
        type: 'WIZARD_SEMANTIC_COLORS_DATA',
        rows,
        semanticCollections: connectedCollections.map(s => ({
          id: s.id,
          name: s.name,
          colorCount: s.colorCount,
          aliasToCoreCount: s.aliasToCoreCount,
        })),
        selectedCollectionId: selectedId,
        coreOptions,
        semanticModeId,
        coreModeId: coreColl.modes[0]?.modeId ?? '',
        semanticCollectionName: semanticColl.name,
        coreCollectionName: coreColl.name,
        semanticResolutionReason: null,
      });
    } catch (err) {
      figma.ui.postMessage({ type: 'WIZARD_ERROR', op: 'semantic_colors_fetch', error: String(err) });
    }
    return;
  }

  if (msg.type === 'WIZARD_TEXT_STYLE_BIND') {
    const m = msg as unknown as {
      styleId: string;
      field: VariableBindableTextField;
      variableId: string | null;
    };
    try {
      const style = await figma.getStyleByIdAsync(m.styleId);
      if (!style || style.type !== 'TEXT') throw new Error('Text style not found');
      const ts = style as TextStyle;
      await figma.loadFontAsync(ts.fontName);
      const variable = m.variableId ? await figma.variables.getVariableByIdAsync(m.variableId) : null;
      if (m.variableId && !variable) throw new Error('Variable not found');
      // Snapshot the existing binding so undo can restore it
      const oldBoundVar = (ts.boundVariables as Record<string, { type: string; id: string } | undefined>)?.[m.field];
      const oldVarId = oldBoundVar?.id ?? null;
      _wizSnapshots.push({
        label: `text-style/${ts.name}/${m.field}`,
        vars: [],
        _styleSnap: { styleId: m.styleId, field: m.field as string, variableId: oldVarId },
      } as unknown as WizUndoSnapshot);
      if (_wizSnapshots.length > 5) _wizSnapshots.shift();
      figma.ui.postMessage({ type: 'WIZARD_UNDO_COUNT', count: _wizSnapshots.length });
      ts.setBoundVariable(m.field, variable);
      let resolvedDisplay: string | undefined;
      if (variable) {
        const cols = await figma.variables.getLocalVariableCollectionsAsync();
        const bpCol = cols.find(c => c.name === '.breakpoint') ?? null;
        const modeId = bpCol?.modes[0]?.modeId;
        if (modeId) resolvedDisplay = await resolveVariableValueDisplay(variable, modeId);
      }
      figma.ui.postMessage({
        type: 'WIZARD_TEXT_STYLE_BOUND',
        styleId: m.styleId,
        field: m.field,
        ok: true,
        resolvedDisplay,
      });
    } catch (err) {
      figma.ui.postMessage({
        type: 'WIZARD_TEXT_STYLE_BOUND',
        styleId: m.styleId,
        field: m.field,
        ok: false,
        error: String(err),
      });
    }
    return;
  }

  // ── ONBOARDING_LOAD_DRAFT ─────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_LOAD_DRAFT') {
    try {
      const draft = await onbLoadDraft();
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_LOADED', draft });
    } catch (err) {
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_LOADED', draft: null, error: String(err) });
    }
    return;
  }

  // ── ONBOARDING_SAVE_DRAFT ─────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_SAVE_DRAFT') {
    try {
      await onbSaveDraft(msg.draft as OnboardingDraft);
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_SAVED', ok: true });
    } catch (err) {
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_SAVED', ok: false, error: String(err) });
    }
    return;
  }

  // ── ONBOARDING_CLEAR_DRAFT ────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_CLEAR_DRAFT') {
    try {
      await onbClearDraft();
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_CLEARED', ok: true });
    } catch (err) {
      figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_CLEARED', ok: false, error: String(err) });
    }
    return;
  }

  // ── ONBOARDING_NEW_DRAFT ──────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_NEW_DRAFT') {
    const draft = onbEmptyDraft();
    figma.ui.postMessage({ type: 'ONBOARDING_DRAFT_LOADED', draft });
    return;
  }

  // ── ONBOARDING_DETECT_SYSTEM ──────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_DETECT_SYSTEM') {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    const info = detectRADDSystem(cols.map(c => c.name));
    figma.ui.postMessage({
      type: 'ONBOARDING_SYSTEM_DETECTED',
      info,
      label: systemLabel(info),
      fileName: figma.root.name,
    });
    return;
  }

  // ── ONBOARDING_AUTO_PLACE ─────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_AUTO_PLACE') {
    const rawInput = typeof msg.input === 'string' ? msg.input : '';
    const context = typeof msg.context === 'string' ? msg.context : 'primary';
    const hexes = onbParseHexList(rawInput);
    try {
      const result = onbAutoPlace(hexes);
      figma.ui.postMessage({ type: 'ONBOARDING_AUTO_PLACE_RESULT', context, result });
    } catch (err) {
      figma.ui.postMessage({
        type: 'ONBOARDING_AUTO_PLACE_RESULT',
        context,
        result: { slots: [], log: [], unplaced: [] },
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  // ── ONBOARDING_MIRROR_SUGGEST ─────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_MIRROR_SUGGEST') {
    const d = msg.draft as OnboardingDraft;
    const suggestions = onbMirrorSuggestions(d?.palette?.primary ?? null);
    figma.ui.postMessage({ type: 'ONBOARDING_MIRROR_SUGGEST_RESULT', suggestions });
    return;
  }

  // ── ONBOARDING_VALIDATE_SEMANTIC ──────────────────────────────────────────
  if (msg.type === 'ONBOARDING_VALIDATE_SEMANTIC') {
    const d = msg.draft as OnboardingDraft;
    const report = onbValidateAll(d?.semanticLight ?? {});
    figma.ui.postMessage({ type: 'ONBOARDING_VALIDATE_SEMANTIC_RESULT', report });
    return;
  }

  // ── ONBOARDING_COMMIT ─────────────────────────────────────────────────────
  if (msg.type === 'ONBOARDING_COMMIT') {
    const draft = msg.draft as OnboardingDraft;
    try {
      const result = await onbRunCommit(draft, (p: CommitProgress) => {
        figma.ui.postMessage({ type: 'ONBOARDING_COMMIT_PROGRESS', progress: p });
      });
      if (result.success) {
        await onbClearDraft();
      }
      figma.ui.postMessage({ type: 'ONBOARDING_COMMIT_RESULT', result, fileName: figma.root.name });
    } catch (err) {
      figma.ui.postMessage({
        type: 'ONBOARDING_COMMIT_RESULT',
        result: {
          success: false,
          variablesWritten: 0,
          error: err instanceof Error ? err.message : String(err),
        },
        fileName: figma.root.name,
      });
    }
    return;
  }

  // ── GET_SYNC_CONFIG ───────────────────────────────────────────────────────
  if (msg.type === 'GET_SYNC_CONFIG') {
    const raw = await figma.clientStorage.getAsync('dsci_sync_config');
    const config = raw ? (JSON.parse(raw as string) as SyncConfig) : {};
    // Seed default paths so the UI can pre-fill the form without manual typing
    if (!config.github) {
      config.github = {
        token: '',
        owner: '',
        repo: '',
        branch: 'main',
        paths: { ...DEFAULT_GITHUB_PATHS },
      };
    } else if (!config.github.paths) {
      (config.github as SyncConfig['github'] & { paths?: typeof DEFAULT_GITHUB_PATHS }).paths =
        { ...DEFAULT_GITHUB_PATHS };
    }
    figma.ui.postMessage({ type: 'SYNC_CONFIG_DATA', config });
    return;
  }
});

console.log('✅ DS Context Intelligence plugin initialized');