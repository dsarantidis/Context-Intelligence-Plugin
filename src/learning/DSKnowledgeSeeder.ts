import type { ExternalKnowledgeEntry, ExternalKnowledgeConfidence, MCPKnowledgeResult } from './types';
import type { ScanResult } from './LearningEngine';
import { uuidV4 } from './utils';

// Known component type keywords — used to infer component type from scan names
const COMPONENT_TYPE_KEYWORDS: string[] = [
  'button', 'btn', 'input', 'text-field', 'textfield', 'checkbox', 'radio',
  'toggle', 'switch', 'modal', 'dialog', 'tooltip', 'popover', 'dropdown',
  'select', 'menu', 'nav', 'navigation', 'tab', 'tabs', 'badge', 'chip',
  'tag', 'avatar', 'icon', 'link', 'breadcrumb', 'pagination', 'table',
  'card', 'banner', 'alert', 'snackbar', 'toast', 'progress', 'spinner',
  'slider', 'accordion', 'drawer', 'sidebar', 'header', 'footer', 'form',
];

// Regex patterns that extract state/variant names from design system content
const STATE_EXTRACTION_PATTERNS = [
  /\b(default|hover|focus|active|pressed|disabled|loading|selected|checked|indeterminate|error|warning|success)\b/gi,
  /state[s]?:\s*([^.]+)/gi,
  /variant[s]?:\s*([^.]+)/gi,
];

function normalizeConfidence(raw: string): ExternalKnowledgeConfidence {
  const s = raw.toLowerCase();
  if (s === 'high') return 'high';
  if (s === 'low') return 'low';
  return 'medium';
}

function extractKnownStates(content: string): string[] {
  const found = new Set<string>();
  for (const pattern of STATE_EXTRACTION_PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(content)) !== null) {
      const segment = match[1] ?? match[0];
      segment
        .split(/[\s,;/]+/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 1 && s.length < 20)
        .forEach(s => found.add(s));
    }
  }
  return Array.from(found).slice(0, 20);
}

function inferComponentType(title: string, tags: string[]): string | undefined {
  const combined = `${title} ${tags.join(' ')}`.toLowerCase();
  for (const keyword of COMPONENT_TYPE_KEYWORDS) {
    if (combined.includes(keyword)) return keyword;
  }
  return undefined;
}

export class DSKnowledgeSeeder {
  /**
   * Infers distinct component type keywords from a scan's component names.
   * Returns deduplicated lowercase keywords the DS assistant MCP can be queried with.
   */
  inferComponentTypesFromScan(scan: ScanResult): string[] {
    const found = new Set<string>();
    for (const component of scan.components) {
      const nameLower = component.name.toLowerCase();
      for (const keyword of COMPONENT_TYPE_KEYWORDS) {
        if (nameLower.includes(keyword)) found.add(keyword);
      }
    }
    return Array.from(found);
  }

  /**
   * Converts raw DS assistant MCP search results into ExternalKnowledgeEntry[].
   * Content is trimmed to 500 chars to keep prompt budget controlled.
   */
  fromMCPResults(
    results: MCPKnowledgeResult[],
    source: string = 'ds_assistant'
  ): ExternalKnowledgeEntry[] {
    const now = new Date().toISOString();
    return results.map(r => ({
      id: uuidV4(),
      source,
      category: r.category,
      componentType: inferComponentType(r.title, r.tags),
      title: r.title,
      content: r.content.slice(0, 500),
      knownStates: extractKnownStates(r.content),
      tags: r.tags,
      confidence: normalizeConfidence(r.confidence),
      sourceUrl: r.source,
      fetchedAt: now,
    }));
  }

  /**
   * Returns component types from a scan that have NO cached external knowledge yet.
   * Used to determine what still needs to be fetched from the MCP.
   */
  missingTypes(
    inferredTypes: string[],
    cached: ExternalKnowledgeEntry[]
  ): string[] {
    const coveredTypes = new Set(
      cached.map(e => e.componentType).filter(Boolean) as string[]
    );
    return inferredTypes.filter(t => !coveredTypes.has(t));
  }
}
