/**
 * Types for the Usage-Aware Description Generator module.
 * Separate from types.ts to avoid disrupting existing scanner types.
 */

export interface VariableRecord {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  codeSyntax: { WEB?: string; ANDROID?: string; iOS?: string };
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  valuesByMode: Record<string, unknown>;
  variableCollectionId: string;
  hiddenFromPublishing: boolean;
}

export interface CollectionRecord {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variableIds: string[];
}

export interface NodeBinding {
  varId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  property: string;
  pageName: string;
  pageId: string;
  depth: number;
  isInsideComponent: boolean;
}

export interface UsageProfile {
  varId: string;
  totalBindings: number;
  byNodeType: Record<string, number>;
  byProperty: Record<string, number>;
  dsCount: number;
  uiCount: number;
  pages: string[];
  aliasedFrom: string[];
  aliasesTo: string[];
  position: 'primitive' | 'semantic' | 'brand-override' | 'standalone' | 'unused';
}

export interface DescriptionCandidate {
  variable: VariableRecord;
  profile: UsageProfile;
  collectionName: string;
  generatedDescription: string;
  source: 'rule-based' | 'ai-enhanced' | 'unused-flag';
  confidence: number;
  needsAI: boolean;
  approved: boolean;
  edited: boolean;
}

export interface ScanPayload {
  variables: VariableRecord[];
  collections: CollectionRecord[];
  usageProfiles: Record<string, UsageProfile>;
  candidates: DescriptionCandidate[];
  scanDurationMs: number;
  pagesScanned: string[];
  totalBindings: number;
  externalLibraryVarCount: number;
  fromCache?: boolean;
}

/** User-provided context that enriches AI descriptions */
export interface DsContext {
  systemName?: string;
  systemBrief?: string;
  collectionNotes?: Record<string, string>;
  namingRules?: Array<{ pattern: string; meaning: string }>;
}
