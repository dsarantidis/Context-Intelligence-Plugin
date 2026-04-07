import { KnowledgeBase } from './KnowledgeBase';
import type { ScoreHistoryEntry } from './types';

function latestPerEntity(entries: ScoreHistoryEntry[]): ScoreHistoryEntry[] {
  const map = new Map<string, ScoreHistoryEntry>();
  for (const e of entries) {
    const existing = map.get(e.entityId);
    if (!existing || e.scannedAt > existing.scannedAt) map.set(e.entityId, e);
  }
  return Array.from(map.values());
}

export class ContextBuilder {
  constructor(private kb: KnowledgeBase) {}

  /**
   * Assembles a rich context string to inject into the Anthropic API system prompt.
   * Keeps it under ~3000 tokens by limiting entry counts.
   */
  async buildSystemContext(): Promise<string> {
    const data = await this.kb.load();

    const topPatterns = [...data.patterns]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 20);

    const confirmedRules = data.rules.filter(r => r.confirmedByUser);
    const highConfidenceRules = data.rules
      .filter(r => !r.confirmedByUser && r.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);

    const foundationScores = latestPerEntity(
      data.scoreHistory.filter(e => e.category === 'foundation')
    )
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, 8);

    const componentScores = latestPerEntity(
      data.scoreHistory.filter(e => e.category === 'component')
    )
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, 8);

    const positiveDescriptions = await this.kb.getPositiveDescriptions();

    // External knowledge: high-confidence entries, grouped by component type
    const externalKnowledge = data.externalKnowledge
      .filter(e => e.confidence === 'high' || e.confidence === 'medium')
      .slice(0, 10);

    const parts: string[] = [
      `## Design System Knowledge Base`,
      `File: ${data.fileName} | Last updated: ${data.updatedAt}`,
      ``,
    ];

    if (topPatterns.length > 0) {
      parts.push(`### Recurring naming patterns`);
      parts.push(
        topPatterns
          .map(
            p =>
              `- [${p.type}/${p.scope}] "${p.value}" — seen ${p.occurrences}x (e.g. ${p.exampleNames.slice(0, 2).join(', ')})`
          )
          .join('\n')
      );
      parts.push(``);
    }

    if (confirmedRules.length > 0) {
      parts.push(`### Confirmed naming rules (user-approved)`);
      parts.push(confirmedRules.map(r => `- "${r.pattern}" means: ${r.meaning}`).join('\n'));
      parts.push(``);
    }

    if (highConfidenceRules.length > 0) {
      parts.push(`### Auto-derived naming rules (high confidence)`);
      parts.push(
        highConfidenceRules
          .map(r => {
            const validated = r.externallyValidated ? ' ✓ industry-validated' : '';
            return `- "${r.pattern}" → ${r.meaning} (confidence: ${(r.confidence * 100).toFixed(0)}%${validated})`;
          })
          .join('\n')
      );
      parts.push(``);
    }

    if (foundationScores.length > 0) {
      parts.push(`### Foundation maturity scores (tokens/variables)`);
      parts.push(
        foundationScores
          .map(s => `- ${s.entityName}: ${s.score}/100 (${s.scannedAt.slice(0, 10)})`)
          .join('\n')
      );
      parts.push(``);
    }

    if (componentScores.length > 0) {
      parts.push(`### Component maturity scores`);
      parts.push(
        componentScores
          .map(s => `- ${s.entityName}: ${s.score}/100 (${s.scannedAt.slice(0, 10)})`)
          .join('\n')
      );
      parts.push(``);
    }

    if (positiveDescriptions.length > 0) {
      parts.push(`### Effective description examples`);
      parts.push(
        positiveDescriptions
          .slice(0, 5)
          .map(d => `- [${d.componentName}]: "${d.description}"`)
          .join('\n')
      );
      parts.push(``);
    }

    if (externalKnowledge.length > 0) {
      parts.push(`### Industry reference (DS assistant)`);
      for (const entry of externalKnowledge) {
        const typeLabel = entry.componentType ? ` [${entry.componentType}]` : '';
        const states = entry.knownStates.length > 0
          ? ` | expected states: ${entry.knownStates.slice(0, 8).join(', ')}`
          : '';
        parts.push(`- **${entry.title}**${typeLabel}: ${entry.content.slice(0, 200)}...${states}`);
      }
      parts.push(``);
    }

    return parts.join('\n');
  }
}
