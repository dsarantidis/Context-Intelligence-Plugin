/**
 * Core type definitions for the DS Context Intelligence plugin
 */

// ============================================================================
// Issue Types
// ============================================================================

export type IssueCategory = 
  | 'missing'      // Missing critical information
  | 'poor'         // Poor quality content
  | 'inconsistent' // Inconsistent with standards
  | 'outdated';    // Outdated or needs updating

export type IssueSeverity = 
  | 'critical'  // Must be fixed
  | 'warning'   // Should be fixed
  | 'info';     // Nice to have

export type FixState = 
  | 'pending'     // Initial state, can click Fix
  | 'previewing'  // Preview shown, can click Apply
  | 'applied'     // Fix has been applied
  | 'rejected';   // User rejected the fix

export interface Issue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  message: string;
  suggestion: string; // Human-readable suggestion text
  contextPoint: string;
  nodeId: string;
  nodeName: string;
  nodeType?: string; // Node type (COMPONENT, COMPONENT_SET, Variable, etc.)
  fixable: boolean;
  propertyPath?: string;
  currentValue?: any;
  suggestedValue?: any; // Generated value for preview/apply
  suggestedValueFormatted?: string; // Formatted version for display
  fixState?: FixState;
  variantProperty?: string; // For variant-specific issues
  variantValue?: string; // For variant-specific issues  
  ruleId?: string; // Rule that generated this issue
  suggestionConfig?: Suggestion; // Full suggestion config from rule
  manualValue?: string; // User's manual edit value
  previewValue?: string; // Current preview value (manual or suggested)
  /** Breadcrumb path in Figma (e.g. "Page > Frame > Component Set > Variant") */
  nodePath?: string;
  /** Token maturity (variables scan): score 0–100 */
  tokenScore?: number;
  /** Token maturity: good | fair | needs-work */
  tokenTier?: 'good' | 'fair' | 'needs-work';
  /** Token maturity: gaps (orphan, missing description, etc.) */
  tokenGaps?: Array<{ type: string; severity: string; message: string; suggestion: string }>;
  /** Token maturity: dimension scores 0–1 */
  tokenDimensions?: Record<string, number>;
  /** Source value preview for this context point (e.g. effect params, text style font/size, variable value) */
  sourceValue?: string;
  /** Resolved hex for COLOR / PAINT issues when available */
  colorHex?: string;
  /** When variable/style name matches a baked Context Rule, the rule's meaning */
  bakedRuleMeaning?: string;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface Audit {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  score: number;
  issues: Issue[];
  timestamp: Date;
}

// ============================================================================
// Component Analysis Types
// ============================================================================

export interface Property {
  name: string;
  type: string;
  defaultValue?: any;
  hasDescription: boolean;
  description?: string;
}

export interface Variant {
  property: string;
  values: string[];
  hasDescription: boolean;
  description?: string;
}

export interface ComponentMetrics {
  hasDescription: boolean;
  hasDocumentation: boolean;
  propertyCount: number;
  variantCount: number;
  propertiesWithDescriptions: number;
  variantsWithDescriptions: number;
}

/** Summary of checks for a component (naming, description, docs, etc.) */
export interface ComponentChecks {
  hasDescription: boolean;
  hasVariants: boolean;
  hasProperties: boolean;
  hasDocumentation: boolean;
  hasDocumentationLink: boolean;
  properNaming: boolean;
  hasLayerNames: boolean;
  hasPropertyDescriptions: boolean;
  hasVariantDescriptions: boolean;
}

/** Variant property info with optional description */
export interface VariantInfo {
  property: string;
  values: string[];
  description?: string;
}

/** Full audit result for a single component node */
export interface ComponentAudit {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  score: number;
  checks: ComponentChecks;
  issues: Issue[];
  properties: Array<{ name: string; type: string }>;
  variants: VariantInfo[];
  /** The component's actual description text (empty string if none) */
  description?: string;
  /** External documentation URLs from Figma's documentationLinks */
  documentationLinks?: string[];
  /** Per-variant-component descriptions (individual COMPONENT children of a COMPONENT_SET) */
  variantDescriptions?: Array<{ name: string; description: string }>;
}

/** Summary of a batch audit (scoring-calculator) */
export interface AuditSummary {
  totalNodes: number;
  componentsScanned: number;
  componentSets: number;
  stylesFound: number;
  variablesFound: number;
  averageScore: number;
  issuesFound: number;
}

// ============================================================================
// Rules Engine Types
// ============================================================================

export interface RulesConfig {
  version: string;
  rules: Rule[];
  contexts: Context[];
  suggestions: { [key: string]: Suggestion };
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: IssueSeverity;
  category: IssueCategory;
  check: RuleCheck;
  message: string;
  suggestion: string;
  fixable: boolean;
  suggestionKey?: string; // Key to lookup in suggestions config
}

export interface RuleCheck {
  type: 'missing' | 'pattern' | 'length' | 'custom';
  property: string;
  condition?: any;
}

export interface Context {
  id: string;
  name: string;
  description: string;
  matcher: ContextMatcher;
}

export interface ContextMatcher {
  nodeType?: string;
  namePattern?: string;
  hasVariants?: boolean;
  propertyPattern?: string;
}

// ============================================================================
// Suggestion Types
// ============================================================================

export type SuggestionType = 'text' | 'variable' | 'component' | 'action';

export interface Suggestion {
  type: SuggestionType;
  propertyPath?: string; // Optional for rule-engine style config
  valueType?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Human-readable message (rule-engine / suggestion-generator) */
  message?: string;
  /** Key into textSuggestions (rule-engine) */
  source?: string;
  /** Direct value or variable key (rule-engine / suggestion-generator) */
  value?: any;
  /** Action type; add_component used by rule-engine for fixable check */
  action?: 'create' | 'update' | 'delete' | 'link' | 'add_component' | 'fill_description';
  actionTarget?: string;
  template?: string;
  examples?: string[];
  variableFilter?: { collection?: string; type?: string };
  componentFilter?: { type?: string; library?: string };
}

// ============================================================================
// Context Detection Types
// ============================================================================

export interface DetectedContext {
  component_type?: string;      // e.g., "button", "input", "card"
  variation_types?: string;      // e.g., "size and state"
  usage_guidance?: string;       // e.g., "Use for primary actions"
  variant_purpose?: string;      // e.g., "indicates active state"
  variant_usage?: string;        // e.g., "Use when item is selected"
  variant_name?: string;         // e.g., "Primary"
  component_name?: string;       // e.g., "Button"
  specific_usage?: string;       // e.g., "Use for destructive actions"
  property_name?: string;        // e.g., "Size"
  property_purpose?: string;     // e.g., "controls button dimensions"
}

// ============================================================================
// Scanner Types
// ============================================================================

export interface ScanOptions {
  includeHidden?: boolean;
  scanDepth?: number;
  selectedOnly?: boolean;
}

/** UI scan configuration (what to scan) */
export interface ScanConfig {
  scanStyles: boolean;
  scanVariables: boolean;
  scanPageNames: boolean;
  scanStructure: boolean;
}

/** Autosuggestion state per issue (UI) */
export interface AutosuggestionState {
  text: string;
  confidence?: number;
  state: 'pending' | 'accepted' | 'rejected';
}

export interface ScanProgress {
  current: number;
  total: number;
  currentNode: string;
}

// ============================================================================
// Enriched Analyzer Types
// ============================================================================

export interface Finding {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  impact?: number;
  suggestion?: string;
}

export interface HardcodedValue {
  property: string;
  value: any;
  suggestedToken?: string;
}

export interface SemanticViolation {
  property?: string;
  tokenName: string;
  reason?: string;
}

export interface TokenSuggestion {
  property: string;
  suggestedToken?: string;
  reason?: string;
  confidence?: number;
}

export interface TokenCoverage {
  percentage: number;
  hardcoded?: number;
  usedTokens?: string[];
  missingTokens?: Array<{ property: string; currentValue: any }>;
}

export interface EnrichedComponentAudit extends ComponentAudit {
  findings: Finding[];
  tokenCoverage?: TokenCoverage;
  semanticTokens?: {
    correct: string[];
    incorrect: SemanticViolation[];
    suggestions: TokenSuggestion[];
  };
  exports?: {
    css?: string;
    tailwind?: string;
    typescript?: string;
  };
}

// All types above are exported via export interface / export type