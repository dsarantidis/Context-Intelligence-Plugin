import type { NodeBinding } from '../usage-types';

export interface WalkOptions {
  maxDepth?: number;
  maxNodes?: number;
  knownVarIds: Set<string>;
  onProgress?: (scanned: number, page: string) => void;
}

export interface WalkResult {
  bindings: NodeBinding[];
  externalVarIds: Set<string>;
  nodesWalked: number;
  pagesScanned: string[];
}

const SKIP_PAGES = new Set(['---', 'Cover', 'Changelog', '🗑️ Archive']);

export async function walkDocument(options: WalkOptions): Promise<WalkResult> {
  const {
    maxDepth = 6,
    maxNodes = 5000,
    knownVarIds,
    onProgress,
  } = options;

  const bindings: NodeBinding[] = [];
  const externalVarIds = new Set<string>();
  const pagesScanned: string[] = [];
  let nodesWalked = 0;

  function walk(
    node: SceneNode,
    pageId: string,
    pageName: string,
    depth: number,
    isInsideComponent: boolean
  ): void {
    if (nodesWalked >= maxNodes || depth > maxDepth) return;
    nodesWalked++;

    // Collect boundVariables
    const bv = (node as unknown as Record<string, unknown>)['boundVariables'];
    if (bv && typeof bv === 'object') {
      for (const [property, binding] of Object.entries(bv as Record<string, unknown>)) {
        const binds = Array.isArray(binding) ? binding : [binding];
        for (const b of binds) {
          const alias = b as { type?: string; id?: string } | null;
          if (alias?.type === 'VARIABLE_ALIAS' && alias.id) {
            if (knownVarIds.has(alias.id)) {
              bindings.push({
                varId: alias.id,
                nodeId: node.id,
                nodeType: node.type,
                nodeName: node.name.substring(0, 60),
                property,
                pageName,
                pageId,
                depth,
                isInsideComponent,
              });
            } else {
              externalVarIds.add(alias.id);
            }
          }
        }
      }
    }

    // Recurse into children
    if ('children' in node && depth < maxDepth) {
      const nextIsComp =
        isInsideComponent ||
        node.type === 'COMPONENT' ||
        node.type === 'COMPONENT_SET';
      const children = (node as FrameNode).children;
      for (const child of children) {
        walk(child, pageId, pageName, depth + 1, nextIsComp);
      }
    }
  }

  for (const page of figma.root.children) {
    if (SKIP_PAGES.has(page.name) || page.name.startsWith('---')) continue;
    await page.loadAsync();
    pagesScanned.push(page.name);
    for (const child of page.children) {
      walk(child, page.id, page.name, 0, false);
    }
    onProgress?.(nodesWalked, page.name);
  }

  return { bindings, externalVarIds, nodesWalked, pagesScanned };
}
