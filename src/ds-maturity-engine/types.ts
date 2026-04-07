/**
 * Design System Context Maturity Engine — Canonical types and output schema.
 * Spec: Logical Analysis Architecture & Scoring Specification.
 */

// ════════════════════════════════════════════════════════════════════════════
// Canonical data model
// ════════════════════════════════════════════════════════════════════════════

export interface VariantAxis {
  name: string;
  values: string[];
}

export interface Property {
  name: string;
  type: string;
  hasDescription: boolean;
}

export interface TokenBinding {
  propertyPath: string;
  tokenId: string;
  tokenName: string;
}

export interface Component {
  id: string;
  name: string;
  namespace: string[];
  description?: string;
  variantAxes: VariantAxis[];
  properties: Property[];
  tokenBindings: TokenBinding[];
  children: string[];
  parents: string[];
  /** Derived: total variant combinations */
  variantCombinationsCount?: number;
  /** Derived: depth in hierarchy */
  depth?: number;
  /** Stylable property count (fills, strokes, effects, etc.) */
  totalStylableProperties?: number;
  /** Count of properties bound to tokens */
  tokenBoundPropertiesCount?: number;
  /** Hardcoded (non-token) stylable property count */
  hardcodedPropertyCount?: number;
}

export interface Token {
  id: string;
  name: string;
  category: string;
  usageCount: number;
}

export interface Layer {
  id: string;
  name: string;
  componentId: string;
  propertyBindings?: TokenBinding[];
}

export type RelationshipType = 'contains' | 'extends' | 'uses' | 'instanceOf';

export interface Relationship {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
}

export interface CanonicalModel {
  components: Component[];
  tokens: Token[];
  layers: Layer[];
  relationships: Relationship[];
}

// ════════════════════════════════════════════════════════════════════════════
// Feature vector (per component)
// ════════════════════════════════════════════════════════════════════════════

export interface FeatureVector {
  // Structural
  namingDepth: number;
  childCount: number;
  dependencyCount: number;
  graphDegree: number;
  // Semantic
  hasDescription: 0 | 1;
  descriptionLength: number;
  guidelinePresence: 0 | 1;
  // Variant
  variantAxesCount: number;
  variantCombinationsCount: number;
  redundancyRatio: number;
  explosionFactor: number;
  // Token
  tokenBoundProperties: number;
  totalStylableProperties: number;
  hardcodedPropertyCount: number;
  tokenUsageRatio: number;
}

// ════════════════════════════════════════════════════════════════════════════
// Dimension result (per dimension module)
// ════════════════════════════════════════════════════════════════════════════

export interface DimensionIssue {
  severity: 'high' | 'medium' | 'low';
  message: string;
  componentId?: string;
}

export interface DimensionResult {
  dimension: string;
  rawScore: number;   // 0–100
  confidence: number; // 0–1
  issues: DimensionIssue[];
  evidence: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// Output schema (spec §13)
// ════════════════════════════════════════════════════════════════════════════

export interface MaturityReport {
  overallScore: number;           // 0–100
  level: number;                  // 0–5
  overallConfidence: number;      // 0–1
  dimensionScores: Record<string, number>;
  dimensionConfidence: Record<string, number>;
  variance: number;               // Var(S_d) across dimensions
  varianceFlag?: 'asymmetrically_mature' | 'structurally_unstable' | 'governance_risk_exposed';
  issues: DimensionIssue[];
  recommendations: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// Config
// ════════════════════════════════════════════════════════════════════════════

export type DimensionId =
  | 'completeness'
  | 'naming'
  | 'semantic'
  | 'variant'
  | 'token'
  | 'structural';

export interface EngineWeights {
  completeness: number;
  naming: number;
  semantic: number;
  variant: number;
  token: number;
  structural: number;
}
