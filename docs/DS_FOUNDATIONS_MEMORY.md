# DS Foundations — Plugin Memory

> This document is loaded as structural context for the DS Context Intelligence plugin.
> It serves three roles simultaneously: AI system context, rule engine reference, and
> developer documentation. All three are encoded in the same source.

---

## What This System Is

The RADD Design System is a **token architecture framework** built in Figma variables.
It exists as a **master template** that products duplicate and customize. Two versions
coexist:

- **RADD 2.0** — current production architecture (DIANA 2.0, EUROCRUITMENT, and other products)
- **RADD 3.0** — next-generation architecture (Context Experimentation / GFM DS)

**Universal invariants — true in both systems:**
- `foundation` is always and only the consumption layer. Components reference nothing else.
- `.core` is always the raw value store. It is never referenced by components directly.
- The system is a template. Products customize only at designated edit points.
- Structural layers are never edited manually — only edit points are touched.

---

## System Detection

### RADD 2.0 — Detection Signature
Contains ALL: `.core`, `.brand`, `.secondary`, `.white`, `.black`, `_restricted`, `.mode`, `.scheme`, `.breakpoint`, `foundation`, `layout`
No `Core Brand Scheme`. No `Brand Segment` collections.

### RADD 3.0 — Detection Signature
Contains ALL: `.core`, `Core Brand Scheme`, `.mode`, `.breakpoint`, `foundation`, `layout`
Optionally: `Brand Segment 1` through `Brand Segment 6`
No `_restricted`.

### Unknown / Hybrid
If neither signature matches fully, flag as unrecognized.

---

## RADD 2.0 — Alias Chain

### Color + Elevation
`.core → base collections (.brand/.secondary/.white/.black) → _restricted → .mode → .scheme → foundation → components`

### Dimensions + Typography
`.core → .breakpoint → foundation → components`

---

## RADD 3.0 — Alias Chain

### Color
`.core → Core Brand Scheme → .mode → foundation → components`

### Dimensions + Typography
`.core → .breakpoint → foundation → components`

---

## Validation Rules

### RADD 2.0
- RULE-20-01: foundation variables must only alias .mode or .breakpoint
- RULE-20-02: .scheme variables must only alias _restricted
- RULE-20-03: _restricted variables must only alias .mode or base collections
- RULE-20-04: .mode variables must only alias .scheme
- RULE-20-05: base collection variables must only alias .core
- RULE-20-06: neutral/inverted mirror — neutral.light = white, neutral.dark = black, inverted = exact mirror
- RULE-20-07: white scheme values must be identical in light and dark contexts
- RULE-20-08: black scheme values must be identical in light and dark contexts
- RULE-20-09: dimension tokens in .breakpoint must point to same .core token across all 5 modes
- RULE-20-10: secondary scheme must reference a valid mode in .secondary

### RADD 3.0
- RULE-30-01: foundation variables must only alias .mode or .breakpoint
- RULE-30-02: .mode variables must only alias Core Brand Scheme
- RULE-30-03: Core Brand Scheme variables must only alias .core or .breakpoint
- RULE-30-04: typography vars in Core Brand Scheme must have identical alias targets across all 9 scheme modes
- RULE-30-05: White scheme Light Tokens must alias same .core values as Neutral Light Tokens
- RULE-30-06: Black scheme Dark Tokens must alias same .core values as Neutral Dark Tokens
- RULE-30-07: Inverted Light Tokens must alias same .core values as Neutral Dark Tokens (mirror)
- RULE-30-08: Inverted Dark Tokens must alias same .core values as Neutral Light Tokens (mirror)
- RULE-30-09: Brand Segment variables with local overrides must be flagged before parent edits
- RULE-30-10: Locked schemes must not be deleted (Neutral, Inverted, White, Black, Destructive)

### Shared
- RULE-SH-01: foundation must never be edited directly
- RULE-SH-02: .core edits require a snapshot before proceeding
- RULE-SH-03: components must only bind to foundation variables
- RULE-SH-04: typography edits must propagate to all breakpoints / all schemes at the same level

---

## Silent Failure Patterns

| ID | Name | Symptom | Detection |
|---|---|---|---|
| SF-01 | Typography scheme drift | Wrong type scale in non-neutral schemes | RADD 3.0: changed_count mod 9 !== 0 |
| SF-02 | Neutral/Inverted mirror broken | Inverted scheme has wrong colors | Compare neutral.light ↔ inverted.dark |
| SF-03 | White/Black static drift | White or Black looks different light vs dark | White/Black base values must be identical across modes |
| SF-04 | Brand Segment override blindspot | Parent edit didn't propagate | Scan Brand Segments for local valuesByMode entries |
| SF-05 | Secondary mode mismatch | Secondary scheme shows wrong variation | Verify .scheme secondary → .secondary mode target |
| SF-06 | .mode wrong direction | Light mode shows dark colors | .mode light → Light Tokens, dark → Dark Tokens |
| SF-07 | Dimension breakpoint drift | Spacing/sizing differs across breakpoints | All 5 .breakpoint modes for a dimension token must alias same .core |
| SF-08 | Component binding bypass | Component doesn't respond to scheme/mode | Component boundVariables must resolve to foundation variables |
