import type { NodeBinding, UsageProfile, VariableRecord } from '../usage-types';
import { buildAliasGraph, classifyPosition } from './aliasGraph';

export function buildUsageProfiles(
  variables: VariableRecord[],
  bindings: NodeBinding[],
  varById: Record<string, VariableRecord>
): Record<string, UsageProfile> {
  const aliasGraph = buildAliasGraph(variables);

  // Group bindings by varId
  const bindingsByVar: Record<string, NodeBinding[]> = {};
  for (const b of bindings) {
    if (!bindingsByVar[b.varId]) bindingsByVar[b.varId] = [];
    bindingsByVar[b.varId].push(b);
  }

  const profiles: Record<string, UsageProfile> = {};

  for (const v of variables) {
    const raw = bindingsByVar[v.id] || [];

    const byNodeType: Record<string, number> = {};
    const byProperty: Record<string, number> = {};

    for (const b of raw) {
      byNodeType[b.nodeType] = (byNodeType[b.nodeType] || 0) + 1;
      byProperty[b.property] = (byProperty[b.property] || 0) + 1;
    }

    const dsCount = raw.filter(b => b.isInsideComponent).length;
    const uiCount = raw.filter(b => !b.isInsideComponent).length;
    const pages = [...new Set(raw.map(b => b.pageName))];

    const aliasedFrom = (aliasGraph.reverse[v.id] || [])
      .map(id => varById[id]?.name)
      .filter((n): n is string => Boolean(n));

    const aliasesTo = (aliasGraph.forward[v.id] || [])
      .map(id => varById[id]?.name)
      .filter((n): n is string => Boolean(n));

    const basePosition = classifyPosition(v.id, aliasGraph);
    const position: UsageProfile['position'] =
      raw.length === 0 && aliasedFrom.length === 0 && aliasesTo.length === 0
        ? 'unused'
        : basePosition;

    profiles[v.id] = {
      varId: v.id,
      totalBindings: raw.length,
      byNodeType,
      byProperty,
      dsCount,
      uiCount,
      pages,
      aliasedFrom,
      aliasesTo,
      position,
    };
  }

  return profiles;
}
