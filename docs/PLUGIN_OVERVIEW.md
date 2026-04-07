# DS Context Intelligence — Πλήρης Περιγραφή Plugin

## Τι είναι

**DS Context Intelligence** είναι ένα Figma plugin που αξιολογεί την **ωριμότητα (maturity) ενός Design System** μέσα από τρεις άξονες: **Variables / Tokens**, **Styles**, και **Components**. Στόχος του είναι να δώσει στις ομάδες design & engineering μια σαφή εικόνα για το πόσο έτοιμο είναι το Design System τους να «διαβαστεί» και να αξιοποιηθεί από AI εργαλεία, αλλά και πόσο συνεκτικό και πλήρες είναι στην πράξη.

Το plugin τρέχει αποκλειστικά μέσα στο Figma Desktop (plugin sandbox) και δεν απαιτεί εξωτερικά services για τη βασική του λειτουργία.

---

## Τι κάνει — Βασικές λειτουργίες

### 1. Scan Selection (Κεντρική λειτουργία)

Ο χρήστης επιλέγει τι θέλει να σκανάρει:

| Τύπος | Τι σκανάρει |
|-------|-------------|
| **Components** | Component Sets, Components, variants, properties, documentation links |
| **Variables & Tokens** | Figma Variables, collections, modes, scopes, aliases |
| **Styles** | Paint Styles, Text Styles, Effect Styles |

Με κάθε scan:
- Εντοπίζονται **issues** (missing description, poor naming, inconsistent structure κλπ.)
- Κάθε issue λαμβάνει **context maturity score** (0–100) με ανάλυση σε 3 διαστάσεις (βλ. παρακάτω)
- Τα αποτελέσματα εμφανίζονται στο Results View με φιλτράρισμα, severity labels και inline fix actions

### 2. Context Maturity (Ανά entity)

Για κάθε entity που σκανάρεται, το plugin τρέχει ένα **Context Maturity Protocol (CMP)** που αξιολογεί σε 3 διαστάσεις:

| Διάσταση | Ερώτηση που απαντά | Βάρος |
|----------|--------------------|-------|
| **Data Density** | Υπάρχουν αρκετά δεδομένα (description, modes, variants, naming depth); | 45% |
| **Semantic Alignment** | Το naming ακολουθεί σύμβαση που μπορεί να αναλυθεί αυτόματα; | 35% |
| **Ambiguity** | Υπάρχει μόνο μία λογική ερμηνεία για αυτό το entity; | 20% |

Το αποτέλεσμα είναι ένα **overall score (0–1)** που οδηγεί σε μία από τρεις ενέργειες:

| Βαθμολογία | Level | Ενέργεια |
|------------|-------|----------|
| ≥ 0.7 | high | **PROCEED** — Αρκετό context για αυτόματη πρόταση |
| 0.4 – 0.7 | medium | **AUGMENT** — Πρόταση δημιουργείται αλλά σημαιώνεται για review |
| < 0.4 | low | **CLARIFY** — Ανεπαρκές context, εμφανίζεται Missing Context Report |

### 3. Token Maturity Scoring (Variables scan)

Για Variables & Tokens, τρέχει ένα βαθύτερο **Token Maturity pipeline** με 5 στάδια:

```
extractTokenSignals
      ↓
buildReverseIndex  (από Component Libraries JSON, αν υπάρχει)
      ↓
computeAlignmentSignals
      ↓
detectGaps
      ↓
scoreToken  →  score 0–100 + tier + gaps
```

**Dimensions που μετριούνται:**

| Dimension | Τι αξιολογεί |
|-----------|-------------|
| Naming Depth | Πόσα επίπεδα έχει το `/`-separated όνομα |
| Description Quality | Υπάρχει description, πόσο πλούσιο είναι |
| Description–Usage Alignment | Το description ταιριάζει με το πού χρησιμοποιείται το token |
| Scope–Usage Alignment | Τα scopes (COLOR, SPACING κλπ.) αντιστοιχούν στη χρήση |
| AI Parseability | Πόσο εύκολα μπορεί ένα AI να ερμηνεύσει το token |
| Mode Coverage | Είναι populated όλα τα modes; |
| Collection Tier | Primitive / Semantic / Other |

**Tiers:**
- `good` (≥ 70) — Token καλά δομημένο
- `fair` (50–69) — Αποδεκτό, χρειάζεται βελτίωση
- `needs-work` (< 50) — Κρίσιμα κενά

**Gaps που εντοπίζονται:** orphan token, missing description, scope mismatch, hardcoded competitor, description mismatch, weak scope.

### 4. DS-Level Context Maturity (File-level scoring)

Ξεχωριστό module (`ds-context-scorer`) που βαθμολογεί το **σύνολο** του Design System σε κλίμακα 0–100 μέσα από **10 context points**:

- **Variables layer (60 pts):** Description coverage, scope specificity, mode coverage, collection naming, code syntax, alias depth, type diversity
- **Styles layer (40 pts):** Description coverage, naming depth, style type coverage

### 5. DS Maturity Engine (Multi-dimensional, component-level)

Πλήρες engine (`ds-maturity-engine`) που αναλύει components σε **6 διαστάσεις**:

| Dimension | Τι μετράει |
|-----------|-----------|
| **Completeness** | Descriptions, docs, property coverage |
| **Naming** | Naming depth, convention adherence |
| **Semantic** | Alignment με naming patterns, design rules |
| **Variant** | Variant axes, combinations, redundancy ratio |
| **Token** | Token binding ratio vs hardcoded properties |
| **Structural** | Hierarchy depth, dependency graph degree |

Παράγει `MaturityReport` με overall score, dimension breakdown, variance flag, και recommendations.

### 6. Radar Chart

Στο Results View εμφανίζεται **radar chart** που οπτικοποιεί τις διαστάσεις context maturity (Data Density, Semantic Alignment, Ambiguity) ως μέση τιμή από όλα τα scanned issues. Κλικ σε segment/label του radar φιλτράρει τη λίστα issues για τα items με χαμηλό score σε εκείνη τη διάσταση.

### 7. Suggestion & Fix System

- Για κάθε issue, το plugin παράγει αυτόματα **πρόταση description** βάσει structural signals
- Ο χρήστης μπορεί να κάνει **Preview → Apply** ή να επεξεργαστεί χειροκίνητα
- Υποστηρίζει fix states: `pending → previewing → applied / rejected`
- **Export** αποτελεσμάτων σε CSV/JSON (token scores, tiers, gaps)

### 8. Context Rules (Bake Rules)

Ο χρήστης μπορεί να ορίσει **Context Rules** — ζεύγη `pattern → meaning` — που «ψήνονται» στο clientStorage. Όταν ένα entity name ταιριάζει με κάποιο pattern, λαμβάνει bonus maturity σε Data Density και Semantic Alignment, γιατί υπάρχει πλέον design-derived context για το τι σημαίνει αυτό το token/style.

### 9. Naming Validation

Module `ds-naming-validator` που επαληθεύει αν tokens και styles ακολουθούν τα naming conventions του DS (tier labels, scoping κλπ.) και επιστρέφει `NamingViolation[]`.

### 10. MCP Integration (Desktop Bridge)

Το plugin ενσωματώνει έναν **Desktop Bridge** (`bridge.ts`) που επιτρέπει σύνδεση με MCP servers. Αυτό ξεκλειδώνει:
- **MCP Enrichment**: Εμπλουτισμός issues με πληροφορίες από εξωτερικά εργαλεία (π.χ. git history, dependency data)
- **Notion Rule Compliance**: Επαλήθευση entities ενάντια σε κανόνες που έρχονται από Notion μέσω MCP

### 11. Usage Description Generator

Pipeline για αυτόματη παραγωγή descriptions βάσει document-level usage:

```
buildVariableRegistry
      ↓
walkDocument  (σκανάρει όλο το Figma document)
      ↓
buildUsageProfiles  (πού χρησιμοποιείται κάθε variable)
      ↓
generateRuleBasedDescription  (rule-based)
      ↓ αν δεν αρκεί
shouldUseAI  →  AI candidate
      ↓
writeDescriptions  (γράφει πίσω στο Figma)
```

---

## Αρχιτεκτονική

```
Figma Plugin Sandbox
┌─────────────────────────────────────────────────────┐
│  code.ts  (Plugin Worker)                           │
│  ├── ComponentAnalyzer                              │
│  ├── ContextEvaluator  (CMP per entity)             │
│  ├── MaturityEngine  (functional integrity)         │
│  ├── TokenScorer  (5-step token pipeline)           │
│  ├── DSContextScorer  (file-level 0–100)            │
│  ├── DSMaturityEngine  (6-dimension components)     │
│  ├── SuggestionGenerator                           │
│  ├── FixApplier                                    │
│  ├── UsageDescriptionPipeline                      │
│  └── DesktopBridge  (MCP)                          │
├─────────────────────────────────────────────────────┤
│  figma.clientStorage                                │
│  ├── rulesConfig  (scan rules)                      │
│  ├── cachedRubric  (token scoring weights, 24h TTL) │
│  ├── dsccBakedRules  (Context Rules)                │
│  └── usageScanCache                                 │
└───────────────┬─────────────────────────────────────┘
                │ postMessage
┌───────────────▼─────────────────────────────────────┐
│  ui.html  (Plugin UI — Vanilla JS + Preact)         │
│  ├── Scan controls (Components / Variables / Styles) │
│  ├── Results View  (issues list + inline fixes)     │
│  ├── Radar Chart  (context maturity dimensions)     │
│  ├── Maturity Panel  (overall %, bar)               │
│  ├── Context Rules editor  (Bake Rules)             │
│  └── Settings / Export                             │
└─────────────────────────────────────────────────────┘
```

**Stack:** TypeScript → webpack → `dist/code.js` + `dist/ui.html`

---

## Ροή εκτέλεσης (Scan Selection)

```
Χρήστης πατάει "Scan Selection"
        ↓
RUN_SCAN message → code.ts
        ↓
Figma API: getLocalVariables / getLocalStyles / findAll(nodes)
        ↓
Για κάθε entity:
  ├── ContextEvaluator.evaluate()  →  context maturity + dimensions
  ├── MaturityEngine.run()  →  maturity result
  ├── [Variables] scoreToken()  →  token score, tier, gaps
  └── NamingValidator  →  naming violations
        ↓
SCAN_RESULT → ui.html
        ↓
Render: issues list, radar chart, maturity bar
```

---

## Τεχνικοί περιορισμοί

- Τρέχει αποκλειστικά στο **Figma Plugin Sandbox** — δεν έχει πρόσβαση σε Node APIs
- Δεν υπάρχει DOM στον worker (`code.ts`) — μόνο Figma API
- Storage: `figma.clientStorage` (key-value, async)
- Δεν χρησιμοποιείται `fetch` στον worker εκτός από το rubric endpoint (whitelisted)
- Build: `npm run build` (webpack + copy)

---

## Τρέχουσα κατάσταση (Tasks)

| Κατηγορία | Ολοκληρωμένα | Pending |
|-----------|-------------|---------|
| Token maturity unified με Variables scan | ✅ T1, T2 | — |
| Radar drill-down | ✅ T4 | T3 (extra axes) |
| Rubric hosting & UI | — | T5, T6 |
| Reverse index από αρχείο/URL | ✅ T7 | T8 |
| Gaps UI + Export | ✅ T9, T10 | — |
| Unit tests | — | T11, T12 |
| Docs "How to read the radar" | ✅ T13 | T14 |
