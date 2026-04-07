import type { VariableRecord } from '../usage-types';

export interface AliasGraph {
  /** varId → list of varIds this variable points to (aliases) */
  forward: Record<string, string[]>;
  /** varId → list of varIds that alias this variable */
  reverse: Record<string, string[]>;
}

export function buildAliasGraph(variables: VariableRecord[]): AliasGraph {
  const forward: Record<string, string[]> = {};
  const reverse: Record<string, string[]> = {};

  for (const v of variables) {
    forward[v.id] = [];
    for (const modeId in v.valuesByMode) {
      const val = v.valuesByMode[modeId] as { type?: string; id?: string } | null;
      if (val && val.type === 'VARIABLE_ALIAS' && val.id) {
        forward[v.id].push(val.id);
        if (!reverse[val.id]) reverse[val.id] = [];
        reverse[val.id].push(v.id);
      }
    }
    // Deduplicate
    forward[v.id] = [...new Set(forward[v.id])];
  }

  return { forward, reverse };
}

export type VariablePosition = 'primitive' | 'semantic' | 'brand-override' | 'standalone';

export function classifyPosition(varId: string, graph: AliasGraph): VariablePosition {
  const pointsTo = graph.forward[varId]?.length ?? 0;
  const pointedToBy = graph.reverse[varId]?.length ?? 0;

  if (pointsTo === 0 && pointedToBy > 0) return 'primitive';
  if (pointsTo > 0 && pointedToBy > 0) return 'semantic';
  if (pointsTo > 0 && pointedToBy === 0) return 'brand-override';
  return 'standalone';
}
