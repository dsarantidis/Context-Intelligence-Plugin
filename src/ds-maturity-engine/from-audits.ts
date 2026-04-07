/**
 * Build RawInput from plugin ComponentAudit[] and optional token usage data.
 * Enables runPipeline() to be fed from existing scan results.
 */

import type { RawInput } from './raw-input';
import type { ComponentAudit } from '../types';

export function rawInputFromAudits(audits: ComponentAudit[]): RawInput {
  const components = audits.map((a) => ({
    id: a.nodeId,
    name: a.nodeName,
    description: undefined,
    variantProperties: a.variants?.map((v) => ({ name: v.property, values: v.values || [] })) ?? [],
    properties: a.properties?.map((p) => ({ name: p.name, type: p.type, hasDescription: false })) ?? [],
    children: [],
    tokenBindings: [],
    totalStylableProperties: 0,
    tokenBoundCount: 0,
    hardcodedCount: 0,
  }));

  const tokenIds = new Set<string>();
  const tokens = Array.from(tokenIds).map((id) => ({
    id,
    name: id,
    category: 'unknown',
    usageCount: 0,
  }));

  const relationships: RawInput['relationships'] = [];
  for (const a of audits) {
    if (a.issues?.length) {
      for (const i of a.issues) {
        if (i.nodeId && i.nodeId !== a.nodeId) {
          relationships.push({
            sourceId: a.nodeId,
            targetId: i.nodeId,
            type: 'contains',
          });
        }
      }
    }
  }

  return { components, tokens, relationships };
}
