/**
 * Raw input shape that the pipeline accepts.
 * Can be built from Figma plugin scan results or from MCP snapshot.
 */

export interface RawComponent {
  id: string;
  name: string;
  description?: string;
  variantProperties?: Array<{ name: string; values: string[] }>;
  properties?: Array<{ name: string; type: string; hasDescription?: boolean }>;
  children?: string[];
  /** Token bindings: property path → token name/id */
  tokenBindings?: Array<{ propertyPath: string; tokenId?: string; tokenName: string }>;
  totalStylableProperties?: number;
  tokenBoundCount?: number;
  hardcodedCount?: number;
}

export interface RawToken {
  id: string;
  name: string;
  category: string;
  usageCount: number;
}

export interface RawRelationship {
  sourceId: string;
  targetId: string;
  type: 'contains' | 'extends' | 'uses' | 'instanceOf';
}

export interface RawInput {
  components: RawComponent[];
  tokens: RawToken[];
  relationships: RawRelationship[];
}
