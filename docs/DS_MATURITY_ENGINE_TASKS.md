# Design System Context Maturity Engine — Task Breakdown

Implementation tasks derived from the *Logical Analysis Architecture & Scoring Specification*.

**Implementation status:** Phases 1–6 are implemented in `src/ds-maturity-engine/`. The pipeline is wired from `code.ts` via `RUN_DS_MATURITY_ENGINE` / `DS_MATURITY_REPORT`; the UI has a "Run report" button and displays score, level, dimension scores, and recommendations.

---

## Phase 1: Foundation (types + schema) ✅

| ID | Task | Deliverable |
|----|------|-------------|
| 1.1 | Define canonical data model types | `CanonicalModel`, `Component`, `Token`, `Layer`, `Relationship`, `VariantAxis`, `Property`, `TokenBinding` |
| 1.2 | Define feature vector and dimension types | `FeatureVector`, `DimensionResult`, `Issue` |
| 1.3 | Define output schema | `MaturityReport` (overallScore, level, overallConfidence, dimensionScores, variance, issues, recommendations) |

---

## Phase 2: Normalization ✅

| ID | Task | Deliverable |
|----|------|-------------|
| 2.1 | Implement Figma → canonical mapper | Ingest components, variables, styles from existing plugin scan shapes; output `CanonicalModel` |
| 2.2 | Flatten component sets into instances | Explicit component instances with variant axes and values |
| 2.3 | Extract namespaces, token bindings, adjacency lists | Namespace tokens from names; resolve token bindings; build parent/child and usage graphs |
| 2.4 | Compute derived metadata | Depth, variant count, dependency count, graph degree where applicable |

---

## Phase 3: Feature Extraction ✅

| ID | Task | Deliverable |
|----|------|-------------|
| 3.1 | Structural features | namingDepth, childCount, dependencyCount, graphDegree |
| 3.2 | Semantic features | hasDescription, descriptionLength, guidelinePresence |
| 3.3 | Variant features | variantAxesCount, variantCombinationsCount, redundancyRatio, explosionFactor |
| 3.4 | Token features | tokenBoundProperties, totalStylableProperties, hardcodedPropertyCount, tokenUsageRatio |
| 3.5 | Per-component feature vector | Single function `extractFeatures(component, model): FeatureVector` |

---

## Phase 4: Dimension Modules ✅

| ID | Task | Formula / Contract |
|----|------|--------------------|
| 4.1 | Completeness | S_comp = 100·(0.35·p_d + 0.25·p_v + 0.25·p_t + 0.15·p_g) |
| 4.2 | Naming consistency | S_name = 100·(0.5·r_regex + 0.3·(1−σ_norm) + 0.2·(1−d_dup)) |
| 4.3 | Semantic density | S_semantic = 100·mean(density_i)·coverageRatio; density_i = min(descLen/L_ideal, 1) |
| 4.4 | Variant architecture | S_variant = 100·mean(v_i); v_i = max(0, 1 − penalty_i) |
| 4.5 | Token adoption | S_token = 100·mean(tokenRatio_i)·(1−h) |
| 4.6 | Structural graph | S_struct = 100·(0.5·(1−OR) + 0.3·(1−CR) + 0.2·CI) |
| 4.7 | Standard contract | Each module returns `DimensionResult` (dimension, rawScore, confidence, issues, evidence) |

---

## Phase 5: Scoring Engine ✅

| ID | Task | Deliverable |
|----|------|-------------|
| 5.1 | Configurable dimension weights | Default [0.20, 0.20, 0.15, 0.15, 0.15, 0.15]; weights sum to 1 |
| 5.2 | Weighted global score | S_total = Σ w_j · S_d_j |
| 5.3 | Confidence adjustment | Per-dimension and overall confidence; optional S'_d = S_d · Conf_d |
| 5.4 | Variance stability | Compute Var(S_d); flag if > τ (asymmetric / unstable / governance risk) |
| 5.5 | Maturity level mapping | Level 0–5 from S_total (0: S<20 … 5: S≥90) |

---

## Phase 6: Pipeline & Integration ✅

| ID | Task | Deliverable |
|----|------|-------------|
| 6.1 | Stateless pipeline runner | `runPipeline(rawInput): MaturityReport` — ingestion → normalize → features → dimensions → scoring → output |
| 6.2 | Pluggable dimension modules | Registry or array of dimension analyzers; easy to add/remove |
| 6.3 | Integration point | Call from code.ts when running component/variable scan or from MCP handler; optional UI for report |

---

## Phase 7: Optional Extensions

| ID | Task | Deliverable |
|----|------|-------------|
| 7.1 | Naming entropy | H = −Σ p_i log p_i |
| 7.2 | Token distribution entropy | H_token for systemic cohesion |
| 7.3 | Variant explosion index | VEI = actualVariants / idealVariants; flag if VEI > 1 |

---

## File Layout

```
src/ds-maturity-engine/
  index.ts           # Public API + runPipeline
  types.ts           # CanonicalModel, MaturityReport, DimensionResult, etc.
  normalization.ts   # Raw → CanonicalModel
  features.ts        # Component → FeatureVector
  dimensions/
    index.ts         # Registry + run all
    completeness.ts
    naming.ts
    semantic-density.ts
    variant-architecture.ts
    token-adoption.ts
    structural-graph.ts
  scoring.ts         # Weights, weighted score, confidence, level mapping
  constants.ts       # L_ideal, σ_max, τ, default weights
```

---

## Implementation Order

1. **types.ts** — All interfaces and MaturityReport schema  
2. **constants.ts** — Default weights, L_ideal, τ  
3. **normalization.ts** — Build CanonicalModel from existing scan structures (reuse component/variable data shapes)  
4. **features.ts** — Extract FeatureVector from Component + CanonicalModel  
5. **dimensions/** — One file per dimension, each returning DimensionResult  
6. **scoring.ts** — Combine dimensions, confidence, level, variance  
7. **index.ts** — runPipeline(rawInput) → MaturityReport  

Each layer is independently testable with mocked inputs.
