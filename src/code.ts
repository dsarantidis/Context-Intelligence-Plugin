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
const PLUGIN_UI_HEIGHT_DEFAULT = 900;

figma.showUI(__html__, {
  width: PLUGIN_UI_WIDTH,
  height: PLUGIN_UI_HEIGHT_DEFAULT,
  themeColors: true
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

      figma.ui.postMessage({
        type: 'RULES_AND_CONTEXT',
        rules: rulesSummary,
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
      if (typeof value === 'string' && value.startsWith('VariableID:')) {
        value = { type: 'VARIABLE_ALIAS', id: value };
      } else if (variable.resolvedType === 'COLOR' && typeof value === 'string') {
        value = _dbHexToRGB(value);
      }
      variable.setValueForMode(m.modeId, value);
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
                  figma.variables.getVariableByIdAsync(val.id).then(aliasedVar => {
                    if (aliasedVar) {
                      const aliasedVarCollection = variableIdToCollection.get(aliasedVar.id);
                      const aliasPath = _jex_buildAliasPath(aliasedVar, aliasedVarCollection || null, col.name, collections as any[]);
                      aliasInfo[mId] = { isAlias: true, aliasPath, aliasedVarId: aliasedVar.id, aliasedVarCollection };
                      const parentVals = aliasedVar.valuesByMode as Record<string, any>;
                      resolvedValuesByMode[mId] = parentVals[Object.keys(parentVals)[0]] ?? null;
                    }
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

        figma.ui.postMessage({ type: 'JSON_EXPORT_EXTRACTED', collections: colResults });
      } catch (e: any) {
        figma.ui.postMessage({ type: 'JSON_EXPORT_ERROR', message: e.message });
      }
    })();
  }

  else if (msg.type === 'JSON_EXPORT_TRANSFORM') {
    try {
      const result = _jex_transformToFinalFormat(msg.raw);
      figma.ui.postMessage({
        type: 'JSON_EXPORT_TRANSFORMED',
        payload: result,
        validation: {
          actual: { totalTokens: result.count, topLevelCollections: Object.keys(result.tokens).length },
          matchPercentage: 100
        }
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
async function getVariableColorHex(
  variable: Variable,
  cache?: Map<string, string | undefined>,
  visited?: Set<string>
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
    const value = variable.valuesByMode[modeIds[0]];
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
      const resolved = await getVariableColorHex(targetVar, cache, seen);
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
  if (variable.resolvedType === 'FLOAT' || variable.resolvedType === 'STRING' || variable.resolvedType === 'BOOLEAN') {
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
    n.includes('foundation') ||
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

      for (let vi = 0; vi < variables.length; vi++) {
        if (vi % 10 === 0) await yieldToEventLoop(); // yield every 10 items
        if (scanCancelled) break;
        const variable = variables[vi];
        const colorHex = await getVariableColorHex(variable, colorHexCache);

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

          // The new engine always produces a description when score < 0.5
          if (mr.description && mr.description.length > 0) {
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

    figma.ui.postMessage({
      type: 'SCAN_COMPLETE',
      audits,
      timestamp: new Date().toISOString(),
      meta: { scanType: 'variables', usedReverseIndex: !!reverseIndexCache },
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