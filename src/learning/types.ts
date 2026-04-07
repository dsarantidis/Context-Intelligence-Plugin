// ─── Knowledge Base root ─────────────────────────────────────────────────────

export const CURRENT_KB_VERSION = 3;

export interface KnowledgeBase {
  version: number;
  fileId: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  patterns: PatternEntry[];
  rules: DerivedRule[];
  scoreHistory: ScoreHistoryEntry[];
  descriptionFeedback: DescriptionFeedbackEntry[];
  aiInsights: AIInsightEntry[];
  externalKnowledge: ExternalKnowledgeEntry[];  // added in v3
}

// ─── Patterns ────────────────────────────────────────────────────────────────

export type PatternType = 'prefix' | 'suffix' | 'segment' | 'structure';
export type PatternScope = 'component' | 'token' | 'style' | 'any';

export interface PatternEntry {
  id: string;
  type: PatternType;
  scope: PatternScope;
  value: string;
  occurrences: number;
  exampleNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

// ─── Derived Rules ────────────────────────────────────────────────────────────

export interface DerivedRule {
  id: string;
  pattern: string;
  meaning: string;
  position: 'prefix' | 'segment' | 'suffix' | 'any';
  scope: PatternScope;
  confidence: number;
  /** True when confidence was boosted by an external knowledge match. */
  externallyValidated: boolean;       // added in v3
  derivedAt: string;
  confirmedByUser: boolean;
}

// ─── Score History ────────────────────────────────────────────────────────────

/**
 * category added in v2.
 * - 'foundation' — token collections (variables, styles)
 * - 'component'  — component nodes
 * - 'file'       — file-level aggregate
 */
export type ScoreCategory = 'foundation' | 'component' | 'file';

export interface ScoreHistoryEntry {
  id: string;
  entityType: 'component' | 'file' | 'collection';
  entityId: string;
  entityName: string;
  score: number;
  category: ScoreCategory;
  dimensionBreakdown: Record<string, number>;
  scannedAt: string;
}

// ─── Description Feedback ─────────────────────────────────────────────────────

export type DescriptionQuality = 'excellent' | 'good' | 'poor' | 'unrated';

export interface DescriptionFeedbackEntry {
  id: string;
  componentId: string;
  componentName: string;
  description: string;
  generatedBy: 'ai' | 'manual';
  quality: DescriptionQuality;
  aiConfidenceScore?: number;
  usedInGeneration: boolean;
  recordedAt: string;
}

// ─── AI Insights ─────────────────────────────────────────────────────────────

export type InsightType =
  | 'pattern_anomaly'
  | 'naming_inconsistency'
  | 'coverage_gap'
  | 'recommendation'
  | 'trend';

export interface AIInsightEntry {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  affectedEntities: string[];
  severity: 'info' | 'warning' | 'critical';
  generatedAt: string;
  acknowledged: boolean;
}

// ─── External Knowledge (DS assistant MCP, v3) ────────────────────────────────

export type ExternalKnowledgeSource = 'ds_assistant' | string;
export type ExternalKnowledgeConfidence = 'high' | 'medium' | 'low';

export interface ExternalKnowledgeEntry {
  id: string;
  source: ExternalKnowledgeSource;
  /** Maps to DS assistant MCP category ('components', 'tokens', 'foundations', etc.) */
  category: string;
  /** Canonical component/token type, e.g. 'button', 'input', 'color'. */
  componentType?: string;
  title: string;
  /** Trimmed knowledge snippet — max 500 chars to keep prompt budget lean. */
  content: string;
  /** Known states, variants, or required properties extracted from content. */
  knownStates: string[];
  tags: string[];
  confidence: ExternalKnowledgeConfidence;
  sourceUrl?: string;
  fetchedAt: string;
}

/** Raw result shape coming from the DS assistant MCP search_design_knowledge tool. */
export interface MCPKnowledgeResult {
  title: string;
  category: string;
  system?: string;
  tags: string[];
  confidence: string;
  source?: string;
  content: string;
}
