import type { AIInsightEntry } from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GitHubPaths {
  /** KB slice: component maturity data, rules, score history.
   *  Repo folder: /components
   *  e.g. "components/maturity.json" */
  components: string;
  /** KB slice: foundation/token maturity data, rules, score history.
   *  Repo folder: /foundations
   *  e.g. "foundations/maturity.json" */
  foundations: string;
  /** Raw Figma token/variable export (values, not KB metadata).
   *  Repo folder: /outputs/artifacts
   *  e.g. "outputs/artifacts/foundations.json" */
  foundationsJson: string;
}

/** Default paths aligned to the DS repo folder structure. */
export const DEFAULT_GITHUB_PATHS: GitHubPaths = {
  components:      'components/maturity.json',
  foundations:     'foundations/maturity.json',
  foundationsJson: 'tokens/design-tokens.json',
};

export interface SyncConfig {
  notion?: {
    apiKey: string;
    parentPageId: string;       // Notion page under which the DB lives
    databaseId?: string;        // populated after first ensureNotionDatabase() call
  };
  github?: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
    paths: GitHubPaths;
  };
}

export interface GitHubPushResult {
  components: { success: boolean; sha?: string };
  foundations: { success: boolean; sha?: string };
  foundationsJson: { success: boolean; sha?: string };
}

// ─── Notion helpers ───────────────────────────────────────────────────────────

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// ─── SyncAdapter ─────────────────────────────────────────────────────────────

export class SyncAdapter {
  constructor(private config: SyncConfig) {}

  // ── Notion ────────────────────────────────────────────────────────────────

  async ensureNotionDatabase(): Promise<{ databaseId: string; created: boolean }> {
    if (!this.config.notion) throw new Error('Notion config is missing');
    const { apiKey, parentPageId, databaseId } = this.config.notion;

    if (databaseId) {
      const check = await fetch(`${NOTION_API}/databases/${databaseId}`, {
        headers: notionHeaders(apiKey),
      });
      if (check.ok) return { databaseId, created: false };
    }

    const res = await fetch(`${NOTION_API}/databases`, {
      method: 'POST',
      headers: notionHeaders(apiKey),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: parentPageId },
        title: [
          { type: 'text', text: { content: 'DS Context Intelligence — AI Insights' } },
        ],
        properties: {
          Name: { title: {} },
          Type: {
            select: {
              options: [
                { name: 'pattern_anomaly', color: 'blue' },
                { name: 'naming_inconsistency', color: 'orange' },
                { name: 'coverage_gap', color: 'yellow' },
                { name: 'recommendation', color: 'green' },
                { name: 'trend', color: 'purple' },
              ],
            },
          },
          Severity: {
            select: {
              options: [
                { name: 'info', color: 'blue' },
                { name: 'warning', color: 'yellow' },
                { name: 'critical', color: 'red' },
              ],
            },
          },
          Acknowledged: { checkbox: {} },
          Summary: { rich_text: {} },
          'Affected Entities': { rich_text: {} },
          'Generated At': { date: {} },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion createDatabase failed: ${res.status} — ${err}`);
    }

    const data = (await res.json()) as { id: string };
    this.config.notion.databaseId = data.id;
    return { databaseId: data.id, created: true };
  }

  async pushInsightsToNotion(
    insights: AIInsightEntry[]
  ): Promise<{ success: boolean; databaseId: string; created: number; errors: number }> {
    if (!this.config.notion) return { success: false, databaseId: '', created: 0, errors: 0 };
    const { apiKey } = this.config.notion;

    const { databaseId } = await this.ensureNotionDatabase();
    const existingTitles = await this.fetchExistingInsightTitles(apiKey, databaseId);

    let created = 0;
    let errors = 0;

    for (const insight of insights) {
      if (existingTitles.has(insight.title)) continue;

      const res = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: notionHeaders(apiKey),
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties: {
            Name: { title: [{ text: { content: insight.title } }] },
            Type: { select: { name: insight.type } },
            Severity: { select: { name: insight.severity } },
            Acknowledged: { checkbox: insight.acknowledged },
            Summary: {
              rich_text: [{ text: { content: insight.summary.slice(0, 2000) } }],
            },
            'Affected Entities': {
              rich_text: [
                { text: { content: insight.affectedEntities.join(', ').slice(0, 2000) } },
              ],
            },
            'Generated At': { date: { start: insight.generatedAt } },
          },
        }),
      });

      if (res.ok) {
        created++;
        existingTitles.add(insight.title);
      } else {
        errors++;
      }
    }

    return { success: errors === 0, databaseId, created, errors };
  }

  private async fetchExistingInsightTitles(
    apiKey: string,
    databaseId: string
  ): Promise<Set<string>> {
    const titles = new Set<string>();
    let cursor: string | undefined;

    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const res = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
        method: 'POST',
        headers: notionHeaders(apiKey),
        body: JSON.stringify(body),
      });
      if (!res.ok) break;

      const data = (await res.json()) as {
        results: Array<{ properties: { Name?: { title?: Array<{ plain_text?: string }> } } }>;
        has_more: boolean;
        next_cursor?: string;
      };

      for (const page of data.results) {
        const title = page.properties?.Name?.title?.[0]?.plain_text;
        if (title) titles.add(title);
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return titles;
  }

  // ── GitHub ────────────────────────────────────────────────────────────────

  /**
   * Pushes to all three separate paths in parallel.
   * Pass `null` for foundationsRawJson to skip that path (e.g. if no token export is available).
   */
  async pushSplitToGitHub(
    componentsJson: string,
    foundationsJson: string,
    foundationsRawJson: string | null
  ): Promise<GitHubPushResult> {
    if (!this.config.github) {
      const empty = { success: false };
      return { components: empty, foundations: empty, foundationsJson: empty };
    }
    const { paths } = this.config.github;

    const [components, foundations, foundationsJsonResult] = await Promise.all([
      this.pushFileToGitHub(
        paths.components,
        componentsJson,
        'chore(components): update component maturity data'
      ),
      this.pushFileToGitHub(
        paths.foundations,
        foundationsJson,
        'chore(foundations): update foundation maturity data'
      ),
      foundationsRawJson !== null
        ? this.pushFileToGitHub(
            paths.foundationsJson,
            foundationsRawJson,
            'chore(outputs): update foundations token export'
          )
        : Promise.resolve({ success: true }),
    ]);

    return { components, foundations, foundationsJson: foundationsJsonResult };
  }

  /**
   * Pulls from one of the three named paths.
   */
  async pullFromGitHub(
    target: keyof GitHubPaths
  ): Promise<string | null> {
    if (!this.config.github) return null;
    const { token, owner, repo, branch, paths } = this.config.github;
    const path = paths[target];
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    if (!data.content) return null;
    return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async pushFileToGitHub(
    path: string,
    content: string,
    message: string
  ): Promise<{ success: boolean; sha?: string }> {
    if (!this.config.github) return { success: false };
    const { token, owner, repo, branch } = this.config.github;

    // Fetch current SHA so GitHub accepts the update
    let sha: string | undefined;
    try {
      const existing = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (existing.ok) {
        sha = ((await existing.json()) as { sha?: string }).sha;
      }
    } catch {
      // File doesn't exist yet — will be created
    }

    const body: Record<string, unknown> = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    return { success: res.ok, sha };
  }
}
