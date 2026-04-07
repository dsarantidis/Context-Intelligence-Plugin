/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Notion Rule Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Integrates Notion-sourced rules with the Context Maturity Engine and
 * the local MCP server.
 *
 * Architecture:
 *
 *  ┌─────────────────┐  Notion API   ┌──────────────────┐
 *  │  Figma UI        │ ◄────────────► │  Notion Database │
 *  │  (fetch rules)   │               │  (Design Rules)  │
 *  └──────┬──────────┘               └──────────────────┘
 *         │ postMessage                      │
 *  ┌──────▼──────────┐                      │ last_edited_time
 *  │  Plugin Sandbox  │                      │ Scope, Check, etc.
 *  │  (code.ts)       │                      ▼
 *  │                  │  JSON-RPC   ┌───────────────────────┐
 *  │  Maturity Engine │ ◄──────────►│  Local MCP Server     │
 *  │  + Notion Rules  │            │  verify_rule_compliance│
 *  └─────────────────┘            └───────────────────────┘
 *
 * Data Flow:
 *   1. UI fetches rules from Notion with full metadata (last_edited_time, Scope)
 *   2. Each rule gets a Context Weight based on recency of its last edit
 *   3. Rules are filtered by Scope (matched against the active file path)
 *   4. MCP bridge verifies whether the code actually follows each rule
 *   5. Non-compliant rules penalize the Context Maturity Score
 *
 * This module is a **pure domain module** — no Figma globals, no Node.js APIs.
 * It receives pre-extracted data and returns deterministic output.
 */

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

/** A rule enriched with Notion metadata */
export interface NotionRule {
  /** Rule ID (from Notion row or generated) */
  id: string;
  /** The pattern to match against (context wildcard, e.g. "component.*") */
  context: string;
  /** What property / condition to check */
  check: string;
  /** Severity when violated */
  severity: 'critical' | 'warning' | 'info';
  /** Human-readable suggestion message */
  message: string;
  /** Static weight from Notion (author-assigned importance) */
  staticWeight: number;

  // ── Notion Metadata ────────────────────────────────────────────────
  /** ISO-8601 timestamp of the last edit in Notion */
  lastEditedTime: string;
  /** Scope glob pattern(s) — matched against file paths */
  scopes: string[];
  /** Optional tags / categories from Notion */
  tags: string[];
  /** Optional description / rationale from Notion */
  rationale: string;
  /** Notion page/row ID for traceability */
  notionPageId: string;

  // ── Computed at runtime ────────────────────────────────────────────
  /** Recency-based Context Weight (0.0 – 1.0) */
  contextWeight: number;
  /** Whether this rule applies to the currently active file */
  matchesActiveFile: boolean;
}

/** Summary of compliance verification for a single entity */
export interface RuleComplianceResult {
  /** Rule that was verified */
  ruleId: string;
  /** Whether the code follows this rule */
  compliant: boolean;
  /** The weighted severity of the violation (contextWeight × staticWeight) */
  penaltyWeight: number;
  /** Details about why it's non-compliant */
  violationDetail: string;
  /** The raw MCP verification response */
  mcpResponse?: unknown;
}

/** Aggregate compliance data fed into the Maturity Engine */
export interface NotionRuleComplianceInput {
  /** Total number of Notion rules that apply to this entity */
  applicableRuleCount: number;
  /** Number of rules the entity is compliant with */
  compliantCount: number;
  /** Number of rules violated */
  violatedCount: number;
  /** Overall compliance ratio (0.0 – 1.0) */
  complianceRatio: number;
  /** Weighted penalty to subtract from maturity score (0.0 – 1.0) */
  weightedPenalty: number;
  /** Individual rule results */
  results: RuleComplianceResult[];
  /** Best "Why" (rationale) from the most relevant violated rule */
  bestRationale: string | null;
}

/** Payload sent from the UI with the enriched Notion data */
export interface NotionRulesPayload {
  rules: NotionRule[];
  /** The active file path in Cursor (for scope matching) */
  activeFilePath: string;
  /** Token/secret for attribution (never stored in plugin) */
  notionDbId: string;
  fetchedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Context Weight Calculator
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calculate a recency-based Context Weight for a rule.
 *
 * The weight decays over time using a half-life model:
 *   weight = BASE + (1 - BASE) × 2^(-age / halfLife)
 *
 * Where:
 *   - age    = days since last_edited_time
 *   - halfLife = 30 days (configurable)
 *   - BASE   = 0.2 (a rule is never fully irrelevant)
 *
 * Intuition:
 *   - Edited today         → weight ≈ 1.0
 *   - Edited 30 days ago   → weight ≈ 0.6
 *   - Edited 90 days ago   → weight ≈ 0.3
 *   - Edited 365+ days ago → weight ≈ 0.2 (floor)
 *
 * @param lastEditedTime  ISO-8601 timestamp from Notion
 * @param now             Current timestamp (injectable for testing)
 * @param halfLifeDays    How fast the weight decays (default 30)
 */
export function calculateContextWeight(
  lastEditedTime: string,
  now: Date = new Date(),
  halfLifeDays: number = 30,
): number {
  const BASE = 0.2;

  const editedDate = new Date(lastEditedTime);
  if (isNaN(editedDate.getTime())) return BASE; // Invalid date → floor

  const ageDays = (now.getTime() - editedDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 1.0; // Edited in the future or right now

  const decay = Math.pow(2, -ageDays / halfLifeDays);
  const weight = BASE + (1 - BASE) * decay;

  return Math.round(Math.min(1, Math.max(BASE, weight)) * 100) / 100;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Scope Matcher
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if a rule's Scope glob patterns match a given file path.
 *
 * Supports:
 *   - Exact match:   "src/tokens.ts"
 *   - Wildcard:      "src/components/*"
 *   - Double-star:   "src/**\/*.tsx"
 *   - Negation:      "!src/test/**"
 *   - Empty scopes → matches everything (rule applies globally)
 *
 * @param scopes    Array of glob patterns from the Notion rule
 * @param filePath  The active file path in Cursor
 */
export function matchesScope(scopes: string[], filePath: string): boolean {
  if (!scopes || scopes.length === 0) return true; // No scope = global

  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

  let matched = false;
  let negated = false;

  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('!')) {
      // Negation pattern
      const pattern = trimmed.slice(1);
      if (globMatch(normalizedPath, pattern.toLowerCase())) {
        negated = true;
      }
    } else {
      // Positive pattern
      if (globMatch(normalizedPath, trimmed.toLowerCase())) {
        matched = true;
      }
    }
  }

  // Negation overrides positive matches
  return matched && !negated;
}

/**
 * Minimal glob matcher supporting *, **, and ?.
 * For use in the UI iframe without external dependencies.
 */
function globMatch(str: string, pattern: string): boolean {
  // Convert glob to regex
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any path segment(s)
        regexStr += '.*';
        i += 2;
        // Skip optional trailing /
        if (pattern[i] === '/') i++;
        continue;
      } else {
        // * matches anything except /
        regexStr += '[^/]*';
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else if (ch === '.') {
      regexStr += '\\.';
    } else if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '+' || ch === '^' || ch === '$' || ch === '|') {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
    i++;
  }

  regexStr += '$';

  try {
    return new RegExp(regexStr).test(str);
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Rule-to-Entity Mapper
// ════════════════════════════════════════════════════════════════════════════

/**
 * Given a set of enriched Notion rules and an entity name/type,
 * return the subset of rules that apply to this entity.
 *
 * Rules are matched by:
 *   1. Scope (already filtered by matchesActiveFile)
 *   2. Context pattern (wildcard matching against entity type)
 *   3. Context Weight > 0 threshold
 *
 * @param rules       All enriched Notion rules
 * @param entityType  The entity type (e.g. "component", "variable", "style")
 * @param entityName  The entity name (e.g. "colors/brand/primary")
 */
export function getApplicableRules(
  rules: NotionRule[],
  entityType: string,
  entityName: string,
): NotionRule[] {
  const normalizedType = entityType.toLowerCase()
    .replace('component_set', 'component_set')
    .replace('paintstyle', 'style')
    .replace('textstyle', 'style')
    .replace('effectstyle', 'style')
    .replace('variable', 'variable');

  return rules.filter(rule => {
    // Must match active file
    if (!rule.matchesActiveFile) return false;

    // Must have non-zero weight
    if (rule.contextWeight <= 0) return false;

    // Context pattern matching
    const ctx = rule.context.toLowerCase();
    if (ctx === '*' || ctx === '**') return true; // Universal rule

    if (ctx.endsWith('.*')) {
      const prefix = ctx.slice(0, -2);
      if (normalizedType.startsWith(prefix)) return true;
    }

    if (ctx === normalizedType) return true;

    // Check if rule context matches entity name pattern
    if (entityName && ctx.includes('/')) {
      const nameLower = entityName.toLowerCase();
      if (globMatch(nameLower, ctx)) return true;
    }

    return false;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 4. MCP Compliance Verifier
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build an MCP tool call request to verify whether a code entity
 * complies with a specific Notion rule.
 *
 * This produces the arguments for `mcpCallTool('verify_rule_compliance', args)`.
 *
 * The MCP server is expected to:
 *   1. Read the code/entity at `entityPath`
 *   2. Evaluate it against the rule's `check` condition
 *   3. Return { compliant: boolean, detail: string }
 */
export function buildComplianceVerificationRequest(
  rule: NotionRule,
  entityName: string,
  entityDescription: string,
  filePath?: string,
): Record<string, unknown> {
  return {
    rule_id: rule.id,
    rule_check: rule.check,
    rule_context: rule.context,
    rule_message: rule.message,
    rule_severity: rule.severity,
    rule_rationale: rule.rationale,
    entity_name: entityName,
    entity_description: entityDescription,
    file_path: filePath || entityName,
    // Structured prompt for the MCP server's LLM integration
    verification_prompt: buildVerificationPrompt(rule, entityName, entityDescription),
  };
}

/**
 * Build a structured prompt for the MCP server to use when verifying
 * rule compliance. This can be consumed by an LLM tool on the server side.
 */
function buildVerificationPrompt(
  rule: NotionRule,
  entityName: string,
  entityDescription: string,
): string {
  return [
    `RULE COMPLIANCE CHECK`,
    `====================`,
    `Rule ID: ${rule.id}`,
    `Rule: "${rule.message}"`,
    `Check: ${rule.check}`,
    `Severity: ${rule.severity}`,
    rule.rationale ? `Rationale: ${rule.rationale}` : '',
    ``,
    `ENTITY UNDER REVIEW`,
    `===================`,
    `Name: ${entityName}`,
    `Description: ${entityDescription || '(no description)'}`,
    ``,
    `QUESTION: Does this entity comply with the rule above?`,
    `Answer with JSON: { "compliant": true/false, "detail": "..." }`,
  ].filter(Boolean).join('\n');
}

/**
 * Parse the raw MCP response from a compliance verification into a
 * structured `RuleComplianceResult`.
 */
export function parseComplianceResponse(
  rule: NotionRule,
  mcpResponse: unknown,
): RuleComplianceResult {
  let compliant = true;
  let detail = '';

  if (mcpResponse && typeof mcpResponse === 'object') {
    const resp = mcpResponse as any;
    if (typeof resp.compliant === 'boolean') {
      compliant = resp.compliant;
    }
    if (typeof resp.detail === 'string') {
      detail = resp.detail;
    }
  } else if (typeof mcpResponse === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(mcpResponse);
      compliant = parsed.compliant !== false;
      detail = parsed.detail || '';
    } catch {
      // If the string contains "non-compliant" or "violation", treat as non-compliant
      const lower = mcpResponse.toLowerCase();
      if (lower.includes('non-compliant') || lower.includes('violation') || lower.includes('does not comply')) {
        compliant = false;
        detail = mcpResponse;
      }
    }
  }

  // Calculate penalty: non-compliant rules incur a weighted penalty
  const severityMultiplier = rule.severity === 'critical' ? 1.0 : rule.severity === 'warning' ? 0.6 : 0.3;
  const penaltyWeight = compliant ? 0 : rule.contextWeight * severityMultiplier * (rule.staticWeight / 100);

  return {
    ruleId: rule.id,
    compliant,
    penaltyWeight: Math.round(penaltyWeight * 100) / 100,
    violationDetail: detail,
    mcpResponse,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Compliance Aggregator
// ════════════════════════════════════════════════════════════════════════════

/**
 * Aggregate individual rule compliance results into a single
 * `NotionRuleComplianceInput` that the Maturity Engine can consume.
 *
 * The `weightedPenalty` is capped at 0.4 (40% of the maturity score)
 * to prevent Notion rules from completely overriding the structural analysis.
 */
export function aggregateCompliance(
  results: RuleComplianceResult[],
  applicableRules: NotionRule[],
): NotionRuleComplianceInput {
  const applicableRuleCount = applicableRules.length;
  const compliantCount = results.filter(r => r.compliant).length;
  const violatedCount = results.filter(r => !r.compliant).length;
  const complianceRatio = applicableRuleCount > 0
    ? compliantCount / applicableRuleCount
    : 1.0;

  // Sum of all penalty weights, capped at 0.4
  const rawPenalty = results.reduce((sum, r) => sum + r.penaltyWeight, 0);
  const weightedPenalty = Math.min(0.4, Math.round(rawPenalty * 100) / 100);

  // Find the best "Why" from violated rules — the one with highest contextWeight
  let bestRationale: string | null = null;
  if (violatedCount > 0) {
    const violated = results
      .filter(r => !r.compliant)
      .sort((a, b) => b.penaltyWeight - a.penaltyWeight);

    if (violated.length > 0) {
      const topRule = applicableRules.find(r => r.id === violated[0].ruleId);
      bestRationale = topRule?.rationale || violated[0].violationDetail || null;
    }
  }

  return {
    applicableRuleCount,
    compliantCount,
    violatedCount,
    complianceRatio: Math.round(complianceRatio * 100) / 100,
    weightedPenalty,
    results,
    bestRationale,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Notion Database Row Parser (enhanced)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parse a Notion database query result into enriched NotionRule objects.
 *
 * Expected Notion DB columns (flexible naming):
 *   - ID / id:           Rule identifier (title/rich_text)
 *   - Context / When:    Context pattern (rich_text)
 *   - Check / Missing:   What to check (rich_text)
 *   - Severity:          critical / warning / info (select)
 *   - Weight:            Static weight 0–100 (number)
 *   - Message:           Suggestion text (rich_text)
 *   - Scope:             File path glob(s), comma-separated (rich_text)
 *   - Tags:              Tags (multi_select)
 *   - Rationale / Why:   Explanation of *why* this rule exists (rich_text)
 *
 * Also reads:
 *   - row.last_edited_time (automatic Notion property)
 *   - row.id (Notion page ID)
 *
 * @param data         Raw Notion database query response
 * @param activeFile   Current file path in Cursor (for scope matching)
 */
export function parseNotionDatabaseToRules(
  data: any,
  activeFile: string,
): NotionRule[] {
  const results = data?.results || [];
  const now = new Date();

  return results.map((row: any, idx: number) => {
    const props = row.properties || {};

    const scopeRaw = getNotionProp(props, ['Scope', 'scope', 'Scopes', 'scopes', 'File', 'file', 'Path', 'path']);
    const scopes = scopeRaw
      ? scopeRaw.split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    const tagsRaw = props['Tags'] || props['tags'] || props['Category'] || props['category'];
    const tags = extractMultiSelect(tagsRaw);

    const lastEditedTime = row.last_edited_time || row.created_time || now.toISOString();
    const contextWeight = calculateContextWeight(lastEditedTime, now);

    const rule: NotionRule = {
      id: getNotionProp(props, ['ID', 'id', 'Rule ID', 'rule_id']) || `notion-rule-${idx}`,
      context: getNotionProp(props, ['Context', 'context', 'When', 'when']) || 'component.*',
      check: getNotionProp(props, ['Check', 'check', 'Missing', 'missing']) || 'description',
      severity: normalizeSeverity(getNotionProp(props, ['Severity', 'severity'])),
      message: getNotionProp(props, ['Message', 'message', 'Suggestion', 'suggestion']) || 'Fix this issue',
      staticWeight: parseInt(getNotionProp(props, ['Weight', 'weight']), 10) || 15,
      lastEditedTime,
      scopes,
      tags,
      rationale: getNotionProp(props, ['Rationale', 'rationale', 'Why', 'why', 'Reason', 'reason']),
      notionPageId: row.id || '',
      contextWeight,
      matchesActiveFile: matchesScope(scopes, activeFile),
    };

    return rule;
  });
}

// ── Notion property helpers ──────────────────────────────────────────────

function getNotionProp(props: any, keys: string[]): string {
  for (const key of keys) {
    const prop = props[key];
    if (!prop) continue;
    const text = extractNotionText(prop);
    if (text) return text;
  }
  return '';
}

function extractNotionText(prop: any): string {
  if (!prop) return '';
  if (prop.type === 'title' && prop.title) {
    return prop.title.map((t: any) => t.plain_text).join('');
  }
  if (prop.type === 'rich_text' && prop.rich_text) {
    return prop.rich_text.map((t: any) => t.plain_text).join('');
  }
  if (prop.type === 'select' && prop.select) {
    return prop.select.name || '';
  }
  if (prop.type === 'number' && prop.number != null) {
    return String(prop.number);
  }
  if (prop.type === 'url') {
    return prop.url || '';
  }
  if (prop.type === 'date' && prop.date) {
    return prop.date.start || '';
  }
  return '';
}

function extractMultiSelect(prop: any): string[] {
  if (!prop) return [];
  if (prop.type === 'multi_select' && Array.isArray(prop.multi_select)) {
    return prop.multi_select.map((s: any) => s.name || '').filter(Boolean);
  }
  if (prop.type === 'select' && prop.select) {
    return [prop.select.name].filter(Boolean);
  }
  return [];
}

function normalizeSeverity(raw: string): 'critical' | 'warning' | 'info' {
  const lower = (raw || '').toLowerCase().trim();
  if (lower === 'critical' || lower === 'error' || lower === 'high') return 'critical';
  if (lower === 'info' || lower === 'low') return 'info';
  return 'warning';
}

// ════════════════════════════════════════════════════════════════════════════
// 7. LLM Injection Prompt Builder
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build a context injection block for LLM consumption.
 *
 * When scope-matched Notion rules exist, they should be injected into
 * the LLM context so the auto-description generator produces output
 * that is already aligned with the team's rules.
 *
 * @param applicableRules  Rules that match the current entity and file
 * @returns A formatted string to prepend to the LLM prompt
 */
export function buildRuleInjectionPrompt(applicableRules: NotionRule[]): string {
  if (applicableRules.length === 0) return '';

  const ruleLines = applicableRules
    .sort((a, b) => b.contextWeight - a.contextWeight) // Most relevant first
    .slice(0, 10) // Cap at 10 rules to limit prompt size
    .map((rule, i) => {
      const weight = Math.round(rule.contextWeight * 100);
      const scope = rule.scopes.length > 0 ? ` [scope: ${rule.scopes.join(', ')}]` : '';
      return [
        `  Rule ${i + 1} (weight: ${weight}%, severity: ${rule.severity})${scope}:`,
        `    Check: ${rule.check}`,
        `    Message: ${rule.message}`,
        rule.rationale ? `    Why: ${rule.rationale}` : '',
      ].filter(Boolean).join('\n');
    });

  return [
    `ACTIVE DESIGN SYSTEM RULES (from Notion)`,
    `=========================================`,
    `The following rules apply to this entity. Your description MUST`,
    `acknowledge and comply with these rules:`,
    ``,
    ...ruleLines,
    ``,
    `IMPORTANT: Ensure the generated description addresses compliance`,
    `with the rules above. If a rule requires a specific property or`,
    `pattern, mention it in the purpose statement.`,
  ].join('\n');
}
