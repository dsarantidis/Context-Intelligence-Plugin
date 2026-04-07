import type {
  KnowledgeBase as KBSchema,
  PatternEntry,
  DerivedRule,
  ScoreHistoryEntry,
  ScoreCategory,
  DescriptionFeedbackEntry,
  AIInsightEntry,
  ExternalKnowledgeEntry,
  ExternalKnowledgeSource,
} from './types';
import { CURRENT_KB_VERSION } from './types';
import { StorageAdapter } from './StorageAdapter';

const STORAGE_KEY = 'dsci_kb_v1';

// ─── Migrations ──────────────────────────────────────────────────────────────

function migrateV1ToV2(kb: KBSchema): KBSchema {
  return {
    ...kb,
    version: 2,
    scoreHistory: kb.scoreHistory.map(entry => ({
      ...entry,
      category: (entry.entityType === 'collection'
        ? 'foundation'
        : entry.entityType === 'component'
          ? 'component'
          : 'file') as ScoreCategory,
    })),
  };
}

function migrateV2ToV3(kb: KBSchema): KBSchema {
  return {
    ...kb,
    version: 3,
    externalKnowledge: [],
    rules: kb.rules.map(r => ({
      ...r,
      externallyValidated: false,
    })),
  };
}

function applyMigrations(kb: KBSchema): KBSchema {
  let current = kb;
  if (current.version < 2) current = migrateV1ToV2(current);
  if (current.version < 3) current = migrateV2ToV3(current);
  return current;
}

// ─── KnowledgeBase ───────────────────────────────────────────────────────────

export class KnowledgeBase {
  private storage: StorageAdapter;
  private cache: KBSchema | null = null;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async load(): Promise<KBSchema> {
    if (this.cache) return this.cache;
    const raw = await this.storage.get(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as KBSchema;
      this.cache = parsed.version < CURRENT_KB_VERSION
        ? applyMigrations(parsed)
        : parsed;
      if (parsed.version < CURRENT_KB_VERSION) {
        await this.storage.set(STORAGE_KEY, JSON.stringify(this.cache));
      }
    } else {
      this.cache = this.empty();
    }
    return this.cache;
  }

  async save(): Promise<void> {
    if (!this.cache) return;
    await this.storage.set(STORAGE_KEY, JSON.stringify(this.cache));
  }

  async touch(): Promise<void> {
    const kb = await this.load();
    kb.updatedAt = new Date().toISOString();
    await this.save();
  }

  // ─── Patterns ──────────────────────────────────────────────────────────────

  async getPatterns(): Promise<PatternEntry[]> {
    return (await this.load()).patterns;
  }

  async mergePatterns(incoming: PatternEntry[]): Promise<void> {
    const kb = await this.load();
    const map = new Map(kb.patterns.map(p => [`${p.type}:${p.scope}:${p.value}`, p]));
    for (const p of incoming) {
      const key = `${p.type}:${p.scope}:${p.value}`;
      if (map.has(key)) {
        const existing = map.get(key)!;
        existing.occurrences += p.occurrences;
        existing.lastSeenAt = p.lastSeenAt;
        for (const ex of p.exampleNames) {
          if (!existing.exampleNames.includes(ex) && existing.exampleNames.length < 5) {
            existing.exampleNames.push(ex);
          }
        }
      } else {
        map.set(key, p);
      }
    }
    kb.patterns = Array.from(map.values());
    await this.save();
  }

  // ─── Rules ─────────────────────────────────────────────────────────────────

  async getRules(): Promise<DerivedRule[]> {
    return (await this.load()).rules;
  }

  async mergeRules(incoming: DerivedRule[]): Promise<void> {
    const kb = await this.load();
    const map = new Map(kb.rules.map(r => [r.pattern, r]));
    for (const r of incoming) {
      if (map.has(r.pattern)) {
        const existing = map.get(r.pattern)!;
        existing.confidence = r.confidence;
        existing.derivedAt = r.derivedAt;
        // Absorb external validation signal; never downgrade
        if (r.externallyValidated) existing.externallyValidated = true;
        // Preserve user edits
      } else {
        map.set(r.pattern, r);
      }
    }
    kb.rules = Array.from(map.values());
    await this.save();
  }

  // ─── Score History ─────────────────────────────────────────────────────────

  async appendScoreHistory(entries: ScoreHistoryEntry[]): Promise<void> {
    const kb = await this.load();
    kb.scoreHistory.push(...entries);
    if (kb.scoreHistory.length > 500) {
      kb.scoreHistory = kb.scoreHistory.slice(-500);
    }
    await this.save();
  }

  async getScoreHistory(entityId?: string): Promise<ScoreHistoryEntry[]> {
    const kb = await this.load();
    if (entityId) return kb.scoreHistory.filter(e => e.entityId === entityId);
    return kb.scoreHistory;
  }

  async getScoreHistoryByCategory(category: ScoreCategory): Promise<ScoreHistoryEntry[]> {
    const kb = await this.load();
    return kb.scoreHistory.filter(e => e.category === category);
  }

  // ─── Description Feedback ──────────────────────────────────────────────────

  async addDescriptionFeedback(entry: DescriptionFeedbackEntry): Promise<void> {
    const kb = await this.load();
    kb.descriptionFeedback.push(entry);
    await this.save();
  }

  async getPositiveDescriptions(): Promise<DescriptionFeedbackEntry[]> {
    const kb = await this.load();
    return kb.descriptionFeedback.filter(
      e => e.quality === 'excellent' || e.quality === 'good'
    );
  }

  // ─── AI Insights ──────────────────────────────────────────────────────────

  async addInsights(insights: AIInsightEntry[]): Promise<void> {
    const kb = await this.load();
    kb.aiInsights.push(...insights);
    if (kb.aiInsights.length > 200) {
      kb.aiInsights = kb.aiInsights.slice(-200);
    }
    await this.save();
  }

  async getInsights(acknowledged?: boolean): Promise<AIInsightEntry[]> {
    const kb = await this.load();
    if (acknowledged === undefined) return kb.aiInsights;
    return kb.aiInsights.filter(i => i.acknowledged === acknowledged);
  }

  // ─── External Knowledge ────────────────────────────────────────────────────

  async mergeExternalKnowledge(incoming: ExternalKnowledgeEntry[]): Promise<void> {
    const kb = await this.load();
    // Deduplicate by source + title
    const map = new Map(
      kb.externalKnowledge.map(e => [`${e.source}:${e.title}`, e])
    );
    for (const entry of incoming) {
      const key = `${entry.source}:${entry.title}`;
      if (map.has(key)) {
        // Refresh content and fetchedAt; preserve id
        const existing = map.get(key)!;
        existing.content = entry.content;
        existing.knownStates = entry.knownStates;
        existing.tags = entry.tags;
        existing.confidence = entry.confidence;
        existing.fetchedAt = entry.fetchedAt;
      } else {
        map.set(key, entry);
      }
    }
    kb.externalKnowledge = Array.from(map.values());
    await this.save();
  }

  async getExternalKnowledge(
    source?: ExternalKnowledgeSource,
    componentType?: string
  ): Promise<ExternalKnowledgeEntry[]> {
    const kb = await this.load();
    return kb.externalKnowledge.filter(e => {
      if (source && e.source !== source) return false;
      if (componentType && e.componentType !== componentType) return false;
      return true;
    });
  }

  async clearExternalKnowledge(source?: ExternalKnowledgeSource): Promise<void> {
    const kb = await this.load();
    kb.externalKnowledge = source
      ? kb.externalKnowledge.filter(e => e.source !== source)
      : [];
    await this.save();
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  async clear(): Promise<void> {
    this.cache = this.empty();
    await this.save();
  }

  async export(): Promise<string> {
    return JSON.stringify(await this.load(), null, 2);
  }

  /**
   * Exports a category-scoped slice of the KB as JSON.
   * - 'component': component scores, component-scoped patterns and rules.
   * - 'foundation': foundation scores, token/style-scoped patterns and rules.
   * Insights and description feedback are included in full in both slices
   * (they aren't reliably scoped to a single category).
   */
  async exportSlice(category: 'component' | 'foundation'): Promise<string> {
    const kb = await this.load();

    const patternScopes =
      category === 'component'
        ? new Set(['component'])
        : new Set(['token', 'style', 'any']);

    const ruleScopes =
      category === 'component'
        ? new Set(['component'])
        : new Set(['token', 'style', 'any']);

    const slice = {
      ...kb,
      scoreHistory: kb.scoreHistory.filter(e => e.category === category),
      patterns: kb.patterns.filter(p => patternScopes.has(p.scope)),
      rules: kb.rules.filter(r => ruleScopes.has(r.scope)),
      // Insights + feedback kept whole — they cross both categories
    };
    return JSON.stringify(slice, null, 2);
  }

  private empty(): KBSchema {
    const now = new Date().toISOString();
    return {
      version: CURRENT_KB_VERSION,
      fileId: '',
      fileName: '',
      createdAt: now,
      updatedAt: now,
      patterns: [],
      rules: [],
      scoreHistory: [],
      descriptionFeedback: [],
      aiInsights: [],
      externalKnowledge: [],
    };
  }
}
