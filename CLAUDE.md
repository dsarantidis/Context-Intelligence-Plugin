# DS Context Intelligence — AI / Claude Code orientation

## Project

Figma plugin that evaluates **Design System maturity**: tokens (AI readiness, description/usage alignment), styles, and components. Provides context maturity (data density, semantic alignment, ambiguity) and a **radar chart** in results. Maturity is computed with every **Scan Selection**; no separate “Run Maturity Analysis” step.

## Stack

- **TypeScript** + webpack → `dist/code.js`, `dist/ui.html`
- **Figma Plugin API** only in worker; no DOM in `code.ts`. Storage: `figma.clientStorage`
- **UI**: single `src/ui.html` (vanilla JS + Preact for some views)

## Critical constraints

- Plugin runs in Figma’s sandbox: no Node APIs, no arbitrary `fetch` to non-whitelisted URLs in worker (rubric fetch is allowed).
- If you are working on a **legacy ES5** single-file `code.js` (e.g. from another repo), use **ES5 only**: `var`, function declarations, no arrow functions, no template literals.

## Key files

| Purpose | File(s) |
|--------|---------|
| Plugin entry, scan flow, message handler | `src/code.ts` |
| Token scoring (signals, reverse index, scoreToken) | `src/token-scorer.ts` |
| Context maturity (dimensions for radar) | `src/context-evaluator.ts`, `src/maturity-engine.ts` |
| UI, radar chart, results view | `src/ui.html` |
| Bridge for MCP (execute, screenshot) | `src/bridge.ts` |
| Maturity scoring guide + task list | `docs/MATURITY_SCORING_GUIDE.md` |

## Maturity scoring

- **Token maturity**: `extractTokenSignals` → `buildReverseIndex` → `computeAlignmentSignals` → `detectGaps` → `scoreToken`. Weights from rubric (cached or remote).
- **Context maturity**: per-issue dimensions (dataDensity, semanticAlignment, ambiguity) → radar chart and overall % in results.
- Full logic and **tasks for next**: see **`docs/MATURITY_SCORING_GUIDE.md`**.

## Tasks for next (summary)

- Unify token maturity with Variables scan and show tier/gaps in results (T1–T2).
- Extend radar (more factors, drill-down) (T3–T4).
- Rubric hosting and UI for weights (T5–T6).
- Reverse index without component library + load from file/URL (T7–T8).
- Gaps in UI and export (T9–T10).
- Unit tests and Node test script for scorer (T11–T12).
- Docs: “How to read the radar” and context vs token maturity (T13–T14).

Details and checkboxes: **`docs/MATURITY_SCORING_GUIDE.md`** § 8.

## Build

```bash
npm install
npm run build
```

Load `dist/manifest.json` in Figma Desktop (Plugins → Development → Import plugin from manifest).
