/**
 * Canonical normalization layer: RawInput → CanonicalModel.
 * Spec §4: flatten, namespaces, variant axes, token bindings, adjacency, derived metadata.
 */

import type {
  CanonicalModel,
  Component,
  Token,
  Layer,
  Relationship,
  VariantAxis,
  Property,
  TokenBinding,
} from './types';
import type { RawInput, RawComponent, RawToken, RawRelationship } from './raw-input';

function parseNamespace(name: string): string[] {
  return name
    .split(/[/\-_.\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeComponent(raw: RawComponent): Component {
  const namespace = parseNamespace(raw.name);
  const variantAxes: VariantAxis[] = (raw.variantProperties || []).map((vp) => ({
    name: vp.name,
    values: vp.values || [],
  }));
  const variantCombinationsCount = variantAxes.reduce(
    (acc, ax) => acc * Math.max(1, ax.values.length),
    1
  );
  const properties: Property[] = (raw.properties || []).map((p) => ({
    name: p.name,
    type: p.type,
    hasDescription: !!p.hasDescription,
  }));
  const tokenBindings: TokenBinding[] = (raw.tokenBindings || []).map((b) => ({
    propertyPath: b.propertyPath,
    tokenId: b.tokenId || '',
    tokenName: b.tokenName,
  }));
  const children = raw.children || [];
  const totalStylable = raw.totalStylableProperties ?? 0;
  const tokenBound = raw.tokenBoundCount ?? tokenBindings.length;
  const hardcoded = raw.hardcodedCount ?? Math.max(0, totalStylable - tokenBound);

  return {
    id: raw.id,
    name: raw.name,
    namespace,
    description: raw.description,
    variantAxes,
    properties,
    tokenBindings,
    children,
    parents: [],
    variantCombinationsCount,
    totalStylableProperties: totalStylable || undefined,
    tokenBoundPropertiesCount: tokenBound,
    hardcodedPropertyCount: hardcoded,
  };
}

function buildParentLists(components: Component[], relationships: Relationship[]): void {
  const childToParents = new Map<string, string[]>();
  for (const r of relationships) {
    if (r.type === 'contains' || r.type === 'instanceOf') {
      const list = childToParents.get(r.targetId) || [];
      if (!list.includes(r.sourceId)) list.push(r.sourceId);
      childToParents.set(r.targetId, list);
    }
  }
  for (const c of components) {
    c.parents = childToParents.get(c.id) || [];
  }
}

function computeDepth(components: Component[]): void {
  const byId = new Map(components.map((c) => [c.id, c]));
  function depth(id: string, visited: Set<string>): number {
    if (visited.has(id)) return 0;
    visited.add(id);
    const comp = byId.get(id);
    if (!comp || comp.parents.length === 0) return 0;
    return 1 + Math.max(0, ...comp.parents.map((p) => depth(p, visited)));
  }
  for (const c of components) {
    c.depth = depth(c.id, new Set());
  }
}

export function normalize(raw: RawInput): CanonicalModel {
  const components: Component[] = raw.components.map(normalizeComponent);
  const tokens: Token[] = raw.tokens.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    usageCount: t.usageCount,
  }));
  const relationships: Relationship[] = raw.relationships.map((r) => ({
    sourceId: r.sourceId,
    targetId: r.targetId,
    type: r.type,
  }));

  buildParentLists(components, relationships);
  computeDepth(components);

  const componentIds = new Set(components.map((c) => c.id));
  const layers: Layer[] = []; // Optional: populate if we have layer-level data

  return {
    components,
    tokens,
    layers,
    relationships,
  };
}
