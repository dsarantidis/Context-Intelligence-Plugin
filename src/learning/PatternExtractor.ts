import type { PatternEntry } from './types';
import type { ScanResult } from './LearningEngine';
import { uuidV4 } from './utils';

export class PatternExtractor {
  extract(scan: ScanResult): PatternEntry[] {
    const patterns: Map<string, PatternEntry> = new Map();
    const allNames: Array<{ name: string; scope: 'component' | 'token' }> = [
      ...scan.components.map(c => ({ name: c.name, scope: 'component' as const })),
      ...scan.tokens.map(t => ({ name: t.name, scope: 'token' as const })),
    ];

    for (const { name, scope } of allNames) {
      const segments = name.split(/[\/\.\-_]/);

      if (segments[0]) {
        this.addPattern(patterns, 'prefix', scope, segments[0], name);
      }

      const last = segments[segments.length - 1];
      if (last && last !== segments[0]) {
        this.addPattern(patterns, 'suffix', scope, last, name);
      }

      for (let i = 1; i < segments.length - 1; i++) {
        if (segments[i]) {
          this.addPattern(patterns, 'segment', scope, segments[i], name);
        }
      }

      if (segments.length >= 2) {
        const structKey = `${segments.length}-segment`;
        this.addPattern(patterns, 'structure', scope, structKey, name);
      }
    }

    return Array.from(patterns.values());
  }

  private addPattern(
    map: Map<string, PatternEntry>,
    type: PatternEntry['type'],
    scope: PatternEntry['scope'],
    value: string,
    exampleName: string
  ): void {
    const key = `${type}:${scope}:${value}`;
    const now = new Date().toISOString();

    if (map.has(key)) {
      const existing = map.get(key)!;
      existing.occurrences += 1;
      if (existing.exampleNames.length < 5 && !existing.exampleNames.includes(exampleName)) {
        existing.exampleNames.push(exampleName);
      }
      existing.lastSeenAt = now;
    } else {
      map.set(key, {
        id: uuidV4(),
        type,
        scope,
        value,
        occurrences: 1,
        exampleNames: [exampleName],
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }
}
