# DS Context Intelligence — Maturity Scoring Guide

This guide describes how the **Maturity Scoring System** works and how to add or extend it, whether you use the **current TypeScript codebase** or a **legacy ES5 `code.js`** (e.g. with Claude Code).

---

## 1. Overview

### What maturity scoring does

- **Token maturity** (variables): Scores each variable for AI readiness, description/usage alignment, scope accuracy, mode coverage, and collection tier. Produces a **score (0–100)**, **tier** (good / fair / needs-work), and **gaps** (orphan, missing description, scope mismatch, etc.).
- **Context maturity** (variables, styles, components): Evaluates “enough context to suggest?” via **data density**, **semantic alignment**, and **ambiguity**. Used for auto-suggestions and the **radar chart** in results.

### Two codebases

| Aspect | Current (this repo) | Legacy (Claude Code guide) |
|--------|---------------------|----------------------------|
| Language | TypeScript | ES5 only (`var`, no `const`/`let`, no arrow functions) |
| Entry | `code.ts` → webpack → `dist/code.js` | Single `code.js` |
| Token scoring | `src/token-scorer.ts` | Inline in `code.js` |
| Context maturity | `src/context-evaluator.ts` + `src/maturity-engine.ts` | N/A in original guide |
| Rubric | `currentRubric` from cache/remote, `sample-rules.json` | `rubrics/token-rubric.json`, fetch from GitHub |
| UI | `src/ui.html`, radar + scan combined | Separate “Run Maturity Analysis” button |

Use this guide for **concepts and task ordering**; adapt implementation to the codebase you have.

---

## 2. Prerequisites

- **Node.js** ≥ 18  
- **Figma Desktop** for testing  
- For legacy flow: `npm install -g @anthropic-ai/claude-code` and `claude --version`  
- Optional: Component Libraries JSON output (for reverse index / usage-based scoring)

---

## 3. Folder structure (reference)

```
ds-context-intelligence/
├── manifest.json
├── package.json
├── src/
│   ├── code.ts              # Plugin worker
│   ├── ui.html
│   ├── token-scorer.ts      # extractTokenSignals, buildReverseIndex, scoreToken, etc.
│   ├── context-evaluator.ts # Context maturity (data density, semantic, ambiguity)
│   ├── maturity-engine.ts  # MaturityResult, Notion compliance
│   └── ...
├── dist/                    # Built plugin (code.js, ui.html)
├── rubrics/
│   └── token-rubric.json    # Weights for token scoring (optional remote)
├── reference/
│   └── icon-mapping.json    # Optional: token → component → slot rules
└── docs/
    └── MATURITY_SCORING_GUIDE.md  # This file
```

---

## 4. Logic flow (improved)

### 4.1 Token maturity (variables only)

1. **Signals** — `extractTokenSignals(variable, collectionName)`  
   Naming depth, has description, description length, scope count, mode count, all modes populated, collection tier, is alias.

2. **Reverse index** — `buildReverseIndex(componentLibraryJSON)`  
   From Component Libraries JSON: for each token, list usages (component, variant, slot, property), inferred states/slot types, and hardcoded alternatives.

3. **Alignment** — `computeAlignmentSignals(variable, signals, reverseIndexEntry)`  
   descriptionUsageAlignment, scopeUsageAlignment, aiParseability (from name clarity, description quality, scope specificity).

4. **Gaps** — `detectGaps(variable, signals, alignmentSignals, reverseIndexEntry)`  
   Orphan, missing description, scope mismatch, hardcoded competitor, description mismatch, weak scope.

5. **Score** — `scoreToken(variable, collectionName, reverseIndexEntry, rubric)`  
   Dimension scores × rubric weights → total 0–100, tier good/fair/needs-work.

### 4.2 Context maturity (variables, styles, components)

1. **Signals** — Built per entity (e.g. `signalsFromVariable`, `signalsFromStyle`, `signalsFromComponent` in maturity-engine).
2. **Context evaluation** — `ContextEvaluator.evaluate(ctx)` → score, level (high/medium/low), action (PROCEED/AUGMENT/CLARIFY), **dimensions**: dataDensity, semanticAlignment, ambiguity.
3. **Maturity engine** — `MaturityEngine.run(signals, mcpEnrichInput, notionInput)` → MaturityResult (score, level, description, Notion penalty, etc.).
4. **UI** — Radar chart uses **average** of dimensions (dataDensity, semanticAlignment, ambiguity) across issues that have maturity data; overall maturity % and bar from average context score.

### 4.3 When each runs

- **Scan Selection** (Components / Variables & Tokens / Styles):  
  - Context maturity is computed per issue and attached to each result.  
  - Radar and overall maturity in the results view use this data.  
- **Token maturity** (scoreToken, tiers, rubric):  
  - In the **current** app: used when running variable scans (and optionally by a dedicated path; backend still has `RUN_MATURITY_ANALYSIS`).  
  - In the **legacy** guide: triggered by “Run Maturity Analysis” with last component scan JSON.

---

## 5. Task order (for adding token maturity to legacy ES5 `code.js`)

| # | Function / step | Insert after | Notes |
|---|------------------|--------------|--------|
| 1 | `extractTokenSignals(variable, collectionName)` | `resolveVariableById` | Pure signals from variable + collection name. |
| 2 | `buildReverseIndex(componentLibraryJSON)` | `extractTokenSignals` | Walk component sets/variants/layers; fill usages, inferredStates, inferredSlotTypes. |
| 3 | `computeAlignmentSignals(variable, signals, reverseIndexEntry)` | `buildReverseIndex` | descriptionUsageAlignment, scopeUsageAlignment, aiParseability. |
| 4 | `detectGaps(variable, signals, alignmentSignals, reverseIndexEntry)` | `computeAlignmentSignals` | Orphan, missingDescription, scopeMismatch, hardcodedCompetitor, etc. |
| 5 | `scoreToken(variable, collectionName, reverseIndexEntry, rubric)` | `detectGaps` | Weights × dimensions → score, tier, gaps. |
| 6 | Rubric file + loader | Init IIFE | `rubrics/token-rubric.json`; cache in `clientStorage` (e.g. 24h TTL). |
| 7 | `RUN_MATURITY_ANALYSIS` handler | Message switch | Get variables + collections, build reverse index, score each token, post `MATURITY_ANALYSIS_RESULT`. |
| 8 | UI trigger + result handlers | `ui.html` | Button (or integrate into scan); capture last scan; show summary (avg score, byTier). |

---

## 6. Critical constraints (legacy ES5)

- **ES5 only**: `var` (no `const`/`let`), function declarations (no `=>`), no template literals, no destructuring in the added code.
- **Figma plugin**: No DOM in worker, no `localStorage`; use `figma.clientStorage` for rubric cache.
- **No new npm dependencies** in the legacy flow.

---

## 7. Reference files

- **rubrics/token-rubric.json** — Weights: namingDepth, descriptionQuality, descriptionUsageAlignment, scopeUsageAlignment, aiParseability, modeCoverage, collectionTier.
- **reference/icon-mapping.json** — Optional: token → component → slot → state rules (e.g. from `radd-mobile-icon-mapping-rules.json`).

---

## 8. Tasks for next

Use this list to prioritise follow-up work (product or tech).

### 8.1 Unify token maturity with scan (current codebase)

- [x] **T1** Run token scoring (scoreToken + rubric) automatically when the user runs a **Variables & Tokens** scan, and attach tier + dimensions to each variable issue (or to a dedicated “Token maturity” section).
- [x] **T2** Expose token maturity in the results UI: e.g. show tier (good/fair/needs-work) and optionally a small breakdown (dimensions or gap count) per variable, without a separate “Run Maturity Analysis” step.

### 8.2 Radar and context maturity

- [ ] **T3** Add more factors to the radar (e.g. “Functional integrity”, “Usage density”, “Description quality” from maturity-engine) as optional axes or a second chart, with a toggle or tab.
- [x] **T4** Allow drilling down: clicking a segment of the radar or a dimension label filters the issue list to items with low scores on that dimension.

### 8.3 Rubric and configuration

- [ ] **T5** Host `token-rubric.json` (or equivalent) on a real URL; replace `PLACEHOLDER` in rubric fetch with repo path; add versioning and changelog in `_meta`.
- [ ] **T6** Add a simple UI to view/override rubric weights (e.g. in settings) and persist in `figma.clientStorage`, with “Reset to default” and optional “Load from URL”.

### 8.4 Reverse index and component library

- [x] **T7** When no Component Libraries JSON is provided, still run token scoring with an empty reverse index (all tokens “orphan” or no usage data); show a hint in UI: “Provide a component library scan for usage-based maturity.”
- [ ] **T8** Support loading Component Libraries JSON from a file or URL (or from a previous scan) so token maturity can run without re-scanning components every time.

### 8.5 Gaps and suggestions

- [x] **T9** In the UI, list **gaps** per variable (orphan, missing description, scope mismatch, etc.) with severity and suggestion; optional “Copy suggestion” or “Apply” for description.
- [x] **T10** Add export: CSV/JSON of token scores + tiers + gaps for reporting or CI.

### 8.6 Testing and robustness

- [ ] **T11** Add unit tests for `scoreToken` (and, if needed, `extractTokenSignals`, `computeAlignmentSignals`, `detectGaps`) with mocked variable + reverse index; include cases: no description, orphan, scope mismatch.
- [ ] **T12** Add a Node script (e.g. `test-scorer.js`) that mocks the Figma API and runs token scoring so maturity logic can be tested without opening Figma.

### 8.7 Documentation and onboarding

- [x] **T13** Add a short “How to read the radar” section in the in-app UI or in docs (what data density, semantic, ambiguity mean and how they affect suggestions).
- [ ] **T14** Document the difference between “context maturity” (radar, PROCEED/AUGMENT/CLARIFY) and “token maturity” (score, tier, gaps) in README or CLAUDE.md.

---

## 9. Quick reference — where things live (current repo)

| Concept | File(s) |
|--------|---------|
| Token signals, reverse index, scoreToken | `src/token-scorer.ts` |
| Context dimensions (data density, semantic, ambiguity) | `src/context-evaluator.ts` |
| Maturity result, Notion compliance, re-evaluation | `src/maturity-engine.ts` |
| Scan flow, RUN_SCAN, maturity on issues | `src/code.ts` |
| RUN_MATURITY_ANALYSIS (token-only) | `src/code.ts` |
| Radar chart, overall maturity bar | `src/ui.html` |
| Rubric loading (cache + remote) | `src/code.ts` (init / rubric fetch) |
| Default rules / sample config | `src/sample-rules.json` |

---

## 10. Debugging (legacy ES5)

- **Re-orient**: “Re-read CLAUDE.md and list which of the 8 tasks are done based on function names in code.js.”
- **ES6 fix**: “Search code.js for const/let, =>, template literals, destructuring and convert to ES5.”
- **Check presence**: “Search code.js for: extractTokenSignals, buildReverseIndex, computeAlignmentSignals, detectGaps, scoreToken — report line numbers.”
- **Node test**: “Write test-scorer.js that mocks Figma and tests scoreToken() for a token with no description; expect score < 60 and gaps including missingDescription.”

You can extend this guide with concrete prompts per task (e.g. paste the exact function bodies for Tasks 1–5 and 7–8) and keep the **Tasks for next** section updated as items are done or new ones are added.
