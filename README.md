# DS Context Intelligence

**Auditing Design System Maturity through Documentation & Context**

Ένα διαγνωστικό εργαλείο για Design Systems στο Figma που αξιολογεί την ωριμότητα και completeness της τεκμηρίωσης.

---

## 🎯 Τι Κάνει

Το DS Context Intelligence αναλύει components, design tokens και styles στο Figma και τα βαθμολογεί βάσει:

- **Identity** (20%): Ονομασία, δομή, conventions
- **Documentation** (35%): Περιγραφές, quality, links
- **Properties** (25%): Property names, descriptions, variants
- **Context** (20%): Usage examples, accessibility, behavior

**Δεν τροποποιεί τίποτα.** Είναι audit-only tool που σέβεται τα όρια του Figma API.

---

## 📦 Setup

### Prerequisites

- Node.js 18+
- Figma Desktop App

### Installation

1. **Clone & Install**
   ```bash
   git clone <repo-url>
   cd ds-context-intelligence
   npm install
   ```

2. **Build**
   ```bash
   npm run build
   ```

3. **Import στο Figma**
   - Figma Desktop → Plugins → Development → Import plugin from manifest
   - Select `manifest.json`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│            Figma Plugin (Sandbox)            │
│                                              │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │  code.ts     │  │  Analyzers         │  │
│  │  (Main)      │─→│  - Component       │  │
│  │              │  │  - Token           │  │
│  └──────┬───────┘  │  - Scoring Calc    │  │
│         │          └────────────────────┘  │
│         │                                   │
│    ┌────▼─────┐                            │
│    │  Bridge  │ (postMessage)              │
│    └────┬─────┘                            │
└─────────┼──────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│              UI (iframe/React)               │
│                                              │
│  ┌──────────────┐  ┌────────────────────┐  │
│  │ BridgeClient │  │  React Components  │  │
│  │              │─→│  - Scan Controls   │  │
│  │              │  │  - Results Display │  │
│  └──────────────┘  │  - Export          │  │
│                     └────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Key Files

- **types.ts**: Shared types για plugin & UI
- **bridge.ts**: Plugin-side message handling
- **scoring-calculator.ts**: Weighted scoring logic
- **component-analyzer.ts**: Component quality checks
- **token-analyzer.ts**: Token/style quality checks
- **code.ts**: Main plugin entry point
- **ui.html**: React-based UI

---

## 🔍 How It Works

### Scoring System

Κάθε component/token/style παίρνει **findings** που επηρεάζουν το score:

```typescript
interface Finding {
  severity: 'error' | 'warning' | 'success' | 'info';
  category: 'identity' | 'documentation' | 'properties' | 'context';
  message: string;
  impact: number; // 0-1, how much it affects score
  suggestion?: string;
}
```

**Τελικό Score:**
```
totalScore = (
  identityScore × 0.20 +
  documentationScore × 0.35 +
  propertiesScore × 0.25 +
  contextScore × 0.20
)
```

**Grades:**
- A: 90-100
- B: 80-89
- C: 70-79
- D: 60-69
- F: <60

### Quality Checks

#### Components
- ✅ Name quality & conventions
- ✅ Description existence & quality
- ✅ Documentation links
- ✅ Property naming & descriptions
- ✅ Variant structure
- ✅ Usage examples
- ✅ Accessibility notes
- ✅ Behavior documentation

#### Tokens
- ✅ Hierarchical naming
- ✅ Type-specific conventions
- ✅ Description quality
- ✅ Multi-mode support
- ✅ Value consistency

#### Styles
- ✅ Naming conventions
- ✅ Description existence
- ✅ Purpose clarity

---

## 🚀 Usage

### In Figma

1. **Launch Plugin**
   - Plugins → Development → DS Context Intelligence

2. **Select Scope**
   - **Scan Selection**: Audit selected components
   - **Scan Current Page**: Audit all components on page
   - **Scan Entire File**: Full file audit

3. **Review Results**
   - Overall DS Context Score
   - Category breakdowns
   - Individual findings
   - Export report

### Scan Modes

| Mode | Use Case | Performance |
|------|----------|-------------|
| **Selection** | Quick check on specific components | Fast |
| **Page** | Audit a single page | Medium |
| **File** | Complete design system audit | Slower |

---

## 📊 Results

### Summary Card
```
DS Context Score: 75
Grade: C

Identity:        85
Documentation:   60
Properties:      80
Context:         65

Components: 24
Issues:     5 errors, 12 warnings
```

### Individual Findings
Each finding includes:
- Severity indicator
- Category
- Clear message
- Actionable suggestion

---

## 🔧 Development

### Build Commands

```bash
# Build once
npm run build

# Watch mode
npm run watch

# Development
npm run dev
```

### Project Structure

```
ds-context-intelligence/
├── types.ts                    # Shared types
├── bridge.ts                   # Bridge implementation
├── scoring-calculator.ts       # Scoring logic
├── component-analyzer.ts       # Component checks
├── token-analyzer.ts          # Token/style checks
├── code.ts                    # Main plugin code
├── ui.html                    # React UI
├── manifest.json              # Plugin config
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎓 Workshop Usage

Ideal για full-day Design System workshops:

### Workshop Flow

1. **Intro** (30min): DS maturity & documentation importance
2. **Demo** (30min): Live audit of sample file
3. **Hands-on** (2h): Participants audit their own files
4. **Analysis** (1h): Review findings, discuss patterns
5. **Action Planning** (1h): Create improvement roadmap

### Learning Outcomes

- Objective DS maturity assessment
- Documentation best practices
- Quality metrics understanding
- Governance strategies

---

## 📝 Export Format

Το plugin εξάγει reports σε **Markdown**:

```markdown
# DS Context Intelligence Report

**File:** Design System v2.0
**Date:** 2025-02-02
**Score:** 75/100 (Grade C)

## Summary
- Components: 24
- Tokens: 45
- Styles: 12
- Issues: 5 errors, 12 warnings

## Findings

### Button Component (Score: 68)
❌ **Documentation**: No description provided
⚠️ **Properties**: Property "prop1" has generic name
...
```

---

## 🔒 Privacy & Safety

- ✅ **No external network calls**
- ✅ **No data collection**
- ✅ **Read-only operations**
- ✅ **No file modifications**
- ✅ **Local processing only**

---

## 🤝 Contributing

Contributions welcome! Focus areas:

- Additional quality checks
- Better heuristics
- Performance optimizations
- UI improvements
- Export formats (JSON, CSV)

---

## 📄 License

MIT

---

## 🎯 Philosophy

> "Το DS Context Intelligence δεν αντικαθιστά την κρίση των designers — τη φωτίζει."

Το plugin είναι εργαλείο **συζήτησης και βελτίωσης**, όχι μαύρο κουτί. Παρέχει δεδομένα και insights, αλλά η τελική απόφαση ανήκει πάντα στην ομάδα.

---

**Built with ❤️ for the Design Systems community**
