/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MCP Maturity Service
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bridge between the Context Maturity Engine and a local MCP server.
 *
 * Architecture:
 *
 *  ┌──────────────┐  JSON-RPC 2.0   ┌──────────────────┐
 *  │  Figma UI    │ ◄──────────────► │  Local MCP Host  │
 *  │  (this file) │                  │  (localhost:3001) │
 *  └──────┬───────┘                  └──────────────────┘
 *         │ postMessage                  │  read_resource
 *  ┌──────▼───────┐                      │  call_tool
 *  │  Plugin      │                      ▼
 *  │  (code.ts)   │              ┌──────────────────┐
 *  │  Maturity    │              │  git log, deps,  │
 *  │  Engine      │              │  file metadata   │
 *  └──────────────┘              └──────────────────┘
 *
 * This module runs in the **UI iframe** where `fetch` is available.
 * It communicates with the plugin sandbox via `parent.postMessage`.
 *
 * JSON-RPC 2.0 is the wire protocol for MCP.
 * The service exposes:
 *   - read_resource("git://log")       → git commit history
 *   - read_resource("git://blame")     → per-line authorship
 *   - call_tool("get_dependencies")    → file dependency graph
 *   - call_tool("get_file_metadata")   → file stats (age, frequency)
 *
 * All public types are self-contained — no Figma globals, no Node.js APIs.
 */

// ════════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 Types
// ════════════════════════════════════════════════════════════════════════════

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ════════════════════════════════════════════════════════════════════════════
// MCP Domain Types
// ════════════════════════════════════════════════════════════════════════════

/** A single git commit extracted from `git log` */
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;            // ISO-8601
  subject: string;         // First line of the commit message
  body: string;            // Full body after the first line
  filesChanged: string[];  // Paths touched by this commit
}

/** Dependency edge in the project graph */
export interface FileDependency {
  source: string;          // The file that imports
  target: string;          // The file being imported
  importType: 'static' | 'dynamic' | 'type-only';
}

/** Aggregate file-level metadata */
export interface FileMetadata {
  path: string;
  commitCount: number;        // How many commits touched this file
  lastModified: string;       // ISO-8601
  firstSeen: string;          // ISO-8601
  uniqueAuthors: number;
  churnScore: number;         // Higher = more frequently changed (0–1)
}

/** The enrichment payload that flows from UI → plugin → maturity engine */
export interface MCPEnrichment {
  /** Raw git history for the file / token being evaluated */
  commits: GitCommit[];
  /** Dependency edges relevant to this entity */
  dependencies: FileDependency[];
  /** File-level metadata */
  fileMetadata: FileMetadata | null;
  /** Reliability score calculated from git + dependency data */
  reliabilityScore: number;
  /** Purpose statement extracted from commit messages (if any) */
  extractedPurpose: string | null;
  /** Whether the purpose was extracted from a commit (vs. synthesized) */
  purposeFromGit: boolean;
  /** Confidence in the extracted purpose (0–1) */
  purposeConfidence: number;
  /** Timestamp of the enrichment fetch */
  fetchedAt: string;
}

/** Connection state exposed to the UI */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MCPStatus {
  state: MCPConnectionState;
  endpoint: string;
  serverName?: string;
  serverVersion?: string;
  capabilities?: string[];
  error?: string;
  lastPing?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. JSON-RPC Client
// ════════════════════════════════════════════════════════════════════════════

/**
 * Minimal JSON-RPC 2.0 client that speaks MCP over HTTP.
 *
 * Usage (from the UI iframe):
 * ```ts
 * const rpc = new JsonRpcClient('http://localhost:3001');
 * await rpc.initialize();
 * const result = await rpc.readResource('git://log?file=src/code.ts&limit=50');
 * ```
 */
export class JsonRpcClient {
  private endpoint: string;
  private requestId = 0;
  private _connected = false;
  private _serverInfo: { name?: string; version?: string } = {};
  private _capabilities: string[] = [];

  constructor(endpoint: string = 'http://localhost:3001') {
    this.endpoint = endpoint;
  }

  // ── Connection lifecycle ─────────────────────────────────────────────

  get connected(): boolean { return this._connected; }
  get serverInfo() { return this._serverInfo; }
  get capabilities() { return this._capabilities; }

  /**
   * MCP handshake: send `initialize` → receive server capabilities.
   */
  async initialize(): Promise<MCPStatus> {
    try {
      const result = await this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'ds-context-intelligence',
          version: '1.0.0',
        },
      }) as any;

      this._connected = true;
      this._serverInfo = result?.serverInfo || {};
      this._capabilities = result?.capabilities
        ? Object.keys(result.capabilities)
        : [];

      // Complete handshake with `initialized` notification
      await this.notify('initialized', {});

      return this.getStatus();

    } catch (err) {
      this._connected = false;
      return {
        state: 'error',
        endpoint: this.endpoint,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Graceful disconnect.
   */
  disconnect(): void {
    this._connected = false;
    this._serverInfo = {};
    this._capabilities = [];
  }

  getStatus(): MCPStatus {
    return {
      state: this._connected ? 'connected' : 'disconnected',
      endpoint: this.endpoint,
      serverName: this._serverInfo.name,
      serverVersion: this._serverInfo.version,
      capabilities: this._capabilities,
      lastPing: new Date().toISOString(),
    };
  }

  // ── MCP Primitives ───────────────────────────────────────────────────

  /**
   * MCP `resources/read` — read a resource by URI.
   *
   * @param uri  e.g. "git://log?file=src/code.ts&limit=50"
   */
  async readResource(uri: string): Promise<unknown> {
    const result = await this.send('resources/read', { uri }) as any;
    // MCP returns { contents: [{ uri, mimeType, text }] }
    const contents = result?.contents;
    if (Array.isArray(contents) && contents.length > 0) {
      const text = contents[0].text;
      // Try to parse as JSON; fall back to raw text
      try { return JSON.parse(text); } catch { return text; }
    }
    return result;
  }

  /**
   * MCP `tools/call` — invoke a server-side tool.
   *
   * @param toolName   e.g. "get_dependencies"
   * @param args       tool-specific arguments
   */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = await this.send('tools/call', { name: toolName, arguments: args }) as any;
    // MCP returns { content: [{ type, text }] }
    const content = result?.content;
    if (Array.isArray(content) && content.length > 0) {
      const text = content[0].text;
      try { return JSON.parse(text); } catch { return text; }
    }
    return result;
  }

  // ── Transport ────────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC request and return the result.
   */
  private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${response.statusText}`);
    }

    const body: JsonRpcResponse = await response.json();

    if (body.error) {
      const e = body.error;
      throw new Error(`MCP RPC error ${e.code}: ${e.message}${e.data ? ' — ' + JSON.stringify(e.data) : ''}`);
    }

    return body.result;
  }

  /**
   * Send a JSON-RPC notification (no `id`, no response expected).
   */
  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const body = { jsonrpc: '2.0', method, params };
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Notifications are fire-and-forget per spec
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Git History Parser
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parses raw git log data (JSON array of commits) returned by the MCP
 * server's `git://log` resource into typed `GitCommit[]`.
 */
export function parseGitLog(raw: unknown): GitCommit[] {
  if (!raw || !Array.isArray(raw)) return [];

  return raw.map((entry: any) => ({
    hash:         entry.hash        || entry.sha      || '',
    shortHash:    entry.shortHash   || entry.short_hash || (entry.hash || '').slice(0, 7),
    author:       entry.author      || entry.author_name || '',
    date:         entry.date        || entry.authored_date || '',
    subject:      entry.subject     || entry.message?.split('\n')[0] || '',
    body:         entry.body        || entry.message   || '',
    filesChanged: entry.filesChanged || entry.files_changed || entry.files || [],
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Reliability Scorer
// ════════════════════════════════════════════════════════════════════════════

/**
 * Calculate a Reliability Score (0.0 – 1.0) from external data.
 *
 * Dimensions:
 *   Commit Consistency  (30%) — Are changes small and frequent?
 *   Author Coverage     (20%) — Was this file reviewed by multiple people?
 *   Dependency Stability(25%) — Few dependents = safer to change, many = riskier
 *   Description Presence(25%) — Do commits explain *why*?
 *
 * This score is combined with the Maturity Engine's internal score to
 * produce a composite confidence number.
 */
export function calculateReliabilityScore(
  commits: GitCommit[],
  dependencies: FileDependency[],
  fileMetadata: FileMetadata | null,
): number {
  if (commits.length === 0 && !fileMetadata) return 0;

  // ── 3a. Commit Consistency (0–1) ────────────────────────────────────
  let commitConsistency = 0;
  if (commits.length > 0) {
    // More commits = more mature, but with diminishing returns
    const countScore = Math.min(1, commits.length / 20);

    // Regularity: std-dev of commit intervals (lower = more consistent)
    const dates = commits
      .map(c => new Date(c.date).getTime())
      .filter(d => !isNaN(d))
      .sort((a, b) => a - b);

    let regularityScore = 0.5; // default if not enough data
    if (dates.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push(dates[i] - dates[i - 1]);
      }
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation
      // CV < 0.5 = very regular, CV > 2 = erratic
      regularityScore = Math.max(0, Math.min(1, 1 - (cv / 3)));
    }

    commitConsistency = countScore * 0.6 + regularityScore * 0.4;
  }

  // ── 3b. Author Coverage (0–1) ──────────────────────────────────────
  let authorCoverage = 0;
  if (fileMetadata) {
    // Multiple authors = peer-reviewed, more reliable
    authorCoverage = Math.min(1, (fileMetadata.uniqueAuthors - 1) / 3);
  } else {
    const uniqueAuthors = new Set(commits.map(c => c.author)).size;
    authorCoverage = Math.min(1, (uniqueAuthors - 1) / 3);
  }

  // ── 3c. Dependency Stability (0–1) ─────────────────────────────────
  let depStability = 0.5; // neutral default
  if (dependencies.length > 0) {
    // Count how many things depend on this file (inbound edges)
    // More dependents = higher risk if broken, but also signals importance
    const inbound = dependencies.length;
    // Sweet spot: 2–8 dependents; very low or very high is less stable
    if (inbound >= 2 && inbound <= 8) {
      depStability = 0.8;
    } else if (inbound >= 1 && inbound <= 15) {
      depStability = 0.6;
    } else if (inbound > 15) {
      depStability = 0.3; // too many dependents = fragile
    } else {
      depStability = 0.4; // zero dependents = possibly dead code
    }
  }

  // ── 3d. Description Presence in commits (0–1) ──────────────────────
  let descriptionPresence = 0;
  if (commits.length > 0) {
    // Count commits whose body (not just subject) contains explanatory text
    const withBody = commits.filter(
      c => c.body.length > c.subject.length + 10 // body has more than just the subject line
    ).length;
    const withWhyKeywords = commits.filter(c => hasWhyKeywords(c.subject + ' ' + c.body)).length;
    const bodyRatio = withBody / commits.length;
    const whyRatio = withWhyKeywords / commits.length;
    descriptionPresence = bodyRatio * 0.5 + whyRatio * 0.5;
  }

  // ── Weighted aggregate ─────────────────────────────────────────────
  const score =
    commitConsistency   * 0.30 +
    authorCoverage      * 0.20 +
    depStability        * 0.25 +
    descriptionPresence * 0.25;

  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Purpose Extractor (git-backed)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Scan git commit messages for "Why" language and extract a purpose
 * statement that can be fed into the Auto-Description model.
 *
 * Heuristic: a commit message contains purpose if it has any of:
 *   "because", "so that", "in order to", "to prevent", "to ensure",
 *   "to avoid", "to support", "to enable", "reason:", "rationale:"
 *
 * Returns the best-matching commit's purpose text, or null.
 */
export function extractPurposeFromCommits(
  commits: GitCommit[],
  entityName: string,
): { purpose: string; confidence: number; sourceCommit: string } | null {
  if (commits.length === 0) return null;

  // Normalize entity name for matching (e.g. "colors/brand/primary" → "primary")
  const leafName = entityName.split('/').pop()?.toLowerCase() || entityName.toLowerCase();
  const segments = entityName.toLowerCase().split('/');

  // Score each commit for relevance and purpose-quality
  type Candidate = { commit: GitCommit; score: number; purposeText: string };
  const candidates: Candidate[] = [];

  for (const commit of commits) {
    const text = commit.subject + ' ' + commit.body;
    const lower = text.toLowerCase();

    // Relevance: does the commit mention the entity?
    let relevance = 0;
    if (lower.includes(leafName)) relevance += 0.5;
    for (const seg of segments) {
      if (seg.length > 2 && lower.includes(seg)) relevance += 0.1;
    }
    // Also check changed files
    for (const f of commit.filesChanged) {
      if (f.toLowerCase().includes(leafName)) relevance += 0.3;
    }
    relevance = Math.min(1, relevance);

    // Purpose quality: does the commit explain *why*?
    let purposeQuality = 0;
    if (hasWhyKeywords(text)) purposeQuality += 0.6;
    if (commit.body.length > 20) purposeQuality += 0.2;
    if (/\b(add|create|introduce|implement)\b/i.test(commit.subject)) purposeQuality += 0.1;
    if (/\b(fix|resolve|correct)\b/i.test(commit.subject)) purposeQuality += 0.1;
    purposeQuality = Math.min(1, purposeQuality);

    const combinedScore = relevance * 0.6 + purposeQuality * 0.4;

    if (combinedScore >= 0.3) {
      // Extract the purpose-bearing sentence
      const purposeText = extractPurposeSentence(text);
      if (purposeText) {
        candidates.push({ commit, score: combinedScore, purposeText });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, take the best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  return {
    purpose: best.purposeText,
    confidence: best.score,
    sourceCommit: best.commit.shortHash,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

const WHY_PATTERNS = [
  /\bbecause\b/i,
  /\bso that\b/i,
  /\bin order to\b/i,
  /\bto prevent\b/i,
  /\bto ensure\b/i,
  /\bto avoid\b/i,
  /\bto support\b/i,
  /\bto enable\b/i,
  /\bto allow\b/i,
  /\bto reduce\b/i,
  /\bto improve\b/i,
  /\bto maintain\b/i,
  /\breason:/i,
  /\brationale:/i,
  /\bwhy:/i,
  /\bpurpose:/i,
  /\bthis (?:ensures?|prevents?|enables?|allows?|supports?|improves?)\b/i,
];

function hasWhyKeywords(text: string): boolean {
  return WHY_PATTERNS.some(rx => rx.test(text));
}

/**
 * Extract the sentence (or clause) that contains purpose language.
 */
function extractPurposeSentence(text: string): string | null {
  // Split into sentences
  const sentences = text
    .replace(/\n/g, '. ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  for (const sentence of sentences) {
    if (hasWhyKeywords(sentence)) {
      // Clean up and cap length
      const cleaned = sentence.replace(/^[-*•]\s*/, '').trim();
      return cleaned.length > 200 ? cleaned.slice(0, 200) + '…' : cleaned;
    }
  }

  // Fallback: if the subject line is descriptive enough
  const subject = sentences[0];
  if (subject && subject.length > 15) {
    return subject.length > 200 ? subject.slice(0, 200) + '…' : subject;
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. MCP Maturity Service (Orchestrator)
// ════════════════════════════════════════════════════════════════════════════

/**
 * High-level service that combines the JSON-RPC client, git parser,
 * reliability scorer, and purpose extractor into a single API.
 *
 * Designed to run in the **Figma UI iframe**. Results are posted back
 * to the plugin sandbox via `parent.postMessage`.
 *
 * ```ts
 * const service = new MCPMaturityService('http://localhost:3001');
 * await service.connect();
 * const enrichment = await service.enrichEntity('colors/brand/primary', 'src/tokens.ts');
 * parent.postMessage({ pluginMessage: { type: 'MCP_ENRICHMENT', data: enrichment } }, '*');
 * ```
 */
export class MCPMaturityService {
  private client: JsonRpcClient;
  private _status: MCPStatus;

  constructor(endpoint: string = 'http://localhost:3001') {
    this.client = new JsonRpcClient(endpoint);
    this._status = {
      state: 'disconnected',
      endpoint,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  get status(): MCPStatus { return this._status; }

  async connect(): Promise<MCPStatus> {
    this._status = { ...this._status, state: 'connecting' };
    const result = await this.client.initialize();
    this._status = result;
    return result;
  }

  disconnect(): void {
    this.client.disconnect();
    this._status = { ...this._status, state: 'disconnected' };
  }

  // ── Core Enrichment ──────────────────────────────────────────────────

  /**
   * Fetch all external data for a single entity and return an
   * `MCPEnrichment` payload ready for the maturity engine.
   *
   * @param entityName  Slash-separated entity name (e.g. "colors/brand/primary")
   * @param filePath    Optional source file path for dependency lookup
   */
  async enrichEntity(entityName: string, filePath?: string): Promise<MCPEnrichment> {
    const empty: MCPEnrichment = {
      commits: [],
      dependencies: [],
      fileMetadata: null,
      reliabilityScore: 0,
      extractedPurpose: null,
      purposeFromGit: false,
      purposeConfidence: 0,
      fetchedAt: new Date().toISOString(),
    };

    if (!this.client.connected) return empty;

    try {
      // ── Parallel fetches ──────────────────────────────────────────
      const [rawLog, rawDeps, rawMeta] = await Promise.allSettled([
        this.client.readResource(
          `git://log?file=${encodeURIComponent(filePath || entityName)}&limit=30`
        ),
        this.client.callTool('get_dependencies', {
          file: filePath || entityName,
        }),
        this.client.callTool('get_file_metadata', {
          file: filePath || entityName,
        }),
      ]);

      // ── Parse results ─────────────────────────────────────────────
      const commits = rawLog.status === 'fulfilled'
        ? parseGitLog(rawLog.value)
        : [];

      const dependencies: FileDependency[] =
        rawDeps.status === 'fulfilled' && Array.isArray(rawDeps.value)
          ? (rawDeps.value as FileDependency[])
          : [];

      const fileMetadata: FileMetadata | null =
        rawMeta.status === 'fulfilled' && rawMeta.value
          ? rawMeta.value as FileMetadata
          : null;

      // ── Score ─────────────────────────────────────────────────────
      const reliabilityScore = calculateReliabilityScore(
        commits, dependencies, fileMetadata,
      );

      // ── Purpose extraction ────────────────────────────────────────
      const purposeResult = extractPurposeFromCommits(commits, entityName);

      return {
        commits,
        dependencies,
        fileMetadata,
        reliabilityScore,
        extractedPurpose: purposeResult?.purpose ?? null,
        purposeFromGit: purposeResult !== null,
        purposeConfidence: purposeResult?.confidence ?? 0,
        fetchedAt: new Date().toISOString(),
      };

    } catch (err) {
      console.warn('[MCPMaturityService] enrichEntity failed:', err);
      return empty;
    }
  }

  /**
   * Batch-enrich multiple entities in parallel (capped concurrency).
   */
  async enrichBatch(
    entities: Array<{ name: string; filePath?: string }>,
    concurrency: number = 5,
  ): Promise<Map<string, MCPEnrichment>> {
    const results = new Map<string, MCPEnrichment>();

    // Process in chunks
    for (let i = 0; i < entities.length; i += concurrency) {
      const chunk = entities.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map(e => this.enrichEntity(e.name, e.filePath)),
      );

      for (let j = 0; j < chunk.length; j++) {
        const r = settled[j];
        results.set(
          chunk[j].name,
          r.status === 'fulfilled'
            ? r.value
            : {
                commits: [], dependencies: [], fileMetadata: null,
                reliabilityScore: 0, extractedPurpose: null,
                purposeFromGit: false, purposeConfidence: 0,
                fetchedAt: new Date().toISOString(),
              },
        );
      }
    }

    return results;
  }

  // ── Direct resource/tool access ──────────────────────────────────────

  /**
   * Raw `read_resource` pass-through for advanced use.
   */
  async readResource(uri: string): Promise<unknown> {
    return this.client.readResource(uri);
  }

  /**
   * Raw `call_tool` pass-through for advanced use.
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool(name, args);
  }
}
