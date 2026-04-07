import type { VariableRecord, CollectionRecord } from '../usage-types';

export interface VariableRegistry {
  variables: VariableRecord[];
  collections: CollectionRecord[];
  varById: Record<string, VariableRecord>;
  collectionById: Record<string, CollectionRecord>;
}

export async function buildVariableRegistry(): Promise<VariableRegistry> {
  const rawVars = await figma.variables.getLocalVariablesAsync();
  const rawCols = await figma.variables.getLocalVariableCollectionsAsync();

  const variables: VariableRecord[] = rawVars.map(v => ({
    id: v.id,
    name: v.name,
    description: v.description || '',
    scopes: v.scopes as string[],
    codeSyntax: v.codeSyntax as { WEB?: string; ANDROID?: string; iOS?: string },
    resolvedType: v.resolvedType as 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN',
    valuesByMode: v.valuesByMode as Record<string, unknown>,
    variableCollectionId: v.variableCollectionId,
    hiddenFromPublishing: v.hiddenFromPublishing,
  }));

  const collections: CollectionRecord[] = rawCols.map(c => ({
    id: c.id,
    name: c.name,
    modes: c.modes,
    variableIds: c.variableIds,
  }));

  const varById: Record<string, VariableRecord> = {};
  variables.forEach(v => { varById[v.id] = v; });

  const collectionById: Record<string, CollectionRecord> = {};
  collections.forEach(c => { collectionById[c.id] = c; });

  return { variables, collections, varById, collectionById };
}
