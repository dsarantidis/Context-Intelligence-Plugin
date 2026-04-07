# DS Context Intelligence + Figma Console MCP Integration
## Enhanced Architecture

## 🎯 Στόχος
Να επεκτείνουμε το DS Context Intelligence plugin για να αξιοποιήσει τα Figma Console MCP tools, δίνοντας:
1. **Βαθύτερη ανάλυση** με enriched data από το MCP
2. **Αυτόματες διορθώσεις** μέσω του `figma_execute`
3. **Export capabilities** με code generation (CSS, Tailwind, TypeScript)
4. **Visual validation** με screenshots
5. **Bidirectional workflow** μεταξύ Claude AI και Figma

---

## 🏗️ Αρχιτεκτονική Επίπεδα

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLAUDE AI (MCP)                           │
│                                                                  │
│  Figma Console MCP Server                                       │
│  ├─ figma_get_variables (enriched token data)                   │
│  ├─ figma_get_styles (enriched style data)                      │
│  ├─ figma_get_component (metadata + token coverage)             │
│  ├─ figma_get_file_data (structure analysis)                    │
│  ├─ figma_execute (auto-fix commands)                           │
│  ├─ figma_capture_screenshot (visual validation)                │
│  └─ figma_set_instance_properties (update components)           │
│                                                                  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ REST API / Chrome DevTools Protocol
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│                    FIGMA DESKTOP                                 │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              DS CONTEXT CHECKER PLUGIN                     │  │
│  │                                                            │  │
│  │  CORE ANALYZERS (Existing)                                │  │
│  │  ├─ ComponentAnalyzer (15+ checks)                        │  │
│  │  ├─ TokenAnalyzer (variable + style analysis)             │  │
│  │  ├─ ScoringCalculator (weighted scoring)                  │  │
│  │  └─ Bridge (UI ↔ Plugin communication)                    │  │
│  │                                                            │  │
│  │  NEW: MCP INTEGRATION LAYER                               │  │
│  │  ├─ MCPBridge (comunicates with MCP server)               │  │
│  │  ├─ EnrichedAnalyzer (uses MCP data)                      │  │
│  │  ├─ AutoFixer (generates fix commands)                    │  │
│  │  ├─ ExportManager (handles exports)                       │  │
│  │  └─ VisualValidator (screenshot analysis)                 │  │
│  │                                                            │  │
│  │  ENHANCED UI                                               │  │
│  │  ├─ Analysis Results (with MCP enrichments)               │  │
│  │  ├─ Auto-Fix Suggestions (clickable)                      │  │
│  │  ├─ Export Options (CSS, Tailwind, TS)                    │  │
│  │  └─ Visual Validation Panel                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Νέα Components

### 1. MCPBridge
**Σκοπός:** Επικοινωνία με το Figma Console MCP server

```typescript
class MCPBridge {
  // Connect to MCP server via REST API or Desktop Bridge
  async connect(): Promise<boolean>
  
  // Get enriched variable data
  async getEnrichedVariables(options: {
    enrich: boolean;
    resolveAliases: boolean;
    export_formats?: string[];
  }): Promise<EnrichedVariableData>
  
  // Get enriched style data
  async getEnrichedStyles(options: {
    enrich: boolean;
    export_formats?: string[];
  }): Promise<EnrichedStyleData>
  
  // Get component metadata with token coverage
  async getComponentMetadata(nodeId: string, options: {
    enrich: boolean;
  }): Promise<ComponentMetadata>
  
  // Execute fix command
  async executeFixCommand(code: string): Promise<ExecutionResult>
  
  // Capture screenshot for validation
  async captureScreenshot(nodeId?: string): Promise<ScreenshotResult>
}
```

### 2. EnrichedAnalyzer
**Σκοπός:** Βαθύτερη ανάλυση με MCP data

```typescript
class EnrichedAnalyzer {
  constructor(
    private mcpBridge: MCPBridge,
    private componentAnalyzer: ComponentAnalyzer,
    private tokenAnalyzer: TokenAnalyzer
  ) {}
  
  // Analyze with token coverage
  async analyzeWithTokenCoverage(
    nodeId: string
  ): Promise<EnrichedComponentAudit> {
    // Get basic analysis
    const basicAudit = await this.componentAnalyzer.analyze(node);
    
    // Get enriched data from MCP
    const mcpData = await this.mcpBridge.getComponentMetadata(nodeId, {
      enrich: true
    });
    
    // Combine and enhance findings
    return this.combineFindings(basicAudit, mcpData);
  }
  
  // Check for hardcoded values
  async checkHardcodedValues(): Promise<Finding[]>
  
  // Check token coverage percentage
  async checkTokenCoverage(): Promise<Finding[]>
  
  // Validate semantic token usage
  async validateSemanticTokens(): Promise<Finding[]>
}
```

### 3. AutoFixer
**Σκοπός:** Γενιά και εκτέλεση auto-fix commands

```typescript
class AutoFixer {
  constructor(private mcpBridge: MCPBridge) {}
  
  // Generate fix for missing description
  generateDescriptionFix(nodeId: string, suggestedDescription: string): FixCommand
  
  // Generate fix for hardcoded value → token
  generateTokenReplacementFix(
    nodeId: string,
    property: string,
    suggestedToken: string
  ): FixCommand
  
  // Generate fix for naming convention
  generateNamingFix(nodeId: string, suggestedName: string): FixCommand
  
  // Execute all fixes
  async executeAllFixes(fixes: FixCommand[]): Promise<FixResult[]>
  
  // Preview fix (dry run)
  async previewFix(fix: FixCommand): Promise<PreviewResult>
}
```

### 4. ExportManager
**Σκοπός:** Export tokens και styles σε διάφορα formats

```typescript
class ExportManager {
  constructor(private mcpBridge: MCPBridge) {}
  
  // Export variables as CSS
  async exportVariablesAsCSS(): Promise<string>
  
  // Export variables as Tailwind config
  async exportVariablesAsTailwind(): Promise<string>
  
  // Export variables as TypeScript
  async exportVariablesAsTypeScript(): Promise<string>
  
  // Export styles as CSS
  async exportStylesAsCSS(): Promise<string>
  
  // Export complete design system
  async exportCompleteDS(format: 'css' | 'tailwind' | 'typescript'): Promise<string>
}
```

### 5. VisualValidator
**Σκοπός:** Visual validation με screenshots

```typescript
class VisualValidator {
  constructor(private mcpBridge: MCPBridge) {}
  
  // Capture component screenshot
  async captureComponent(nodeId: string): Promise<string> // base64 image
  
  // Compare before/after for fixes
  async compareBeforeAfter(
    nodeId: string,
    fix: FixCommand
  ): Promise<ComparisonResult>
  
  // Validate visual consistency
  async validateVisualConsistency(
    components: string[]
  ): Promise<ConsistencyReport>
}
```

---

## 🎨 Enhanced UI Features

### Νέες Καρτέλες στο UI:

1. **Analysis Tab** (existing + enriched)
   - Βασικό scoring (ήδη υπάρχει)
   - **NEW:** Token coverage %
   - **NEW:** Hardcoded values count
   - **NEW:** Semantic token validation

2. **Auto-Fix Tab** (new)
   - Λίστα προτεινόμενων fixes
   - Preview button για κάθε fix
   - "Apply All" / "Apply Selected" buttons
   - Undo capability

3. **Export Tab** (new)
   - Variable export options (CSS/Tailwind/TS)
   - Style export options (CSS/Sass)
   - Complete DS export
   - Download/Copy buttons

4. **Visual Tab** (new)
   - Component screenshots
   - Before/After comparisons για fixes
   - Visual consistency checker

---

## 🔄 Enhanced Workflows

### Workflow 1: Comprehensive Audit
```
1. User clicks "Deep Audit"
2. Plugin runs basic checks (existing)
3. MCPBridge fetches enriched data
4. EnrichedAnalyzer combines findings
5. UI shows enhanced results with:
   - Token coverage %
   - Hardcoded value locations
   - Semantic token violations
   - Export-ready code snippets
```

### Workflow 2: Auto-Fix
```
1. Audit identifies issues
2. AutoFixer generates fix commands
3. User reviews fixes in UI
4. User clicks "Preview Fix"
5. VisualValidator shows before/after
6. User clicks "Apply"
7. MCPBridge executes fix via figma_execute
8. VisualValidator captures after-state
9. UI confirms success
```

### Workflow 3: Export Design System
```
1. User selects export format
2. ExportManager calls MCP tools with export_formats
3. MCP returns enriched data with code examples
4. UI displays formatted code
5. User copies or downloads
6. Optional: Auto-commit to GitHub (future)
```

---

## 📊 Enhanced Data Structures

### EnrichedComponentAudit
```typescript
interface EnrichedComponentAudit extends ComponentAudit {
  // Existing fields...
  
  // New MCP-enriched fields
  tokenCoverage: {
    percentage: number;
    usedTokens: string[];
    hardcodedValues: HardcodedValue[];
    missingTokens: string[]; // properties that should use tokens
  };
  
  semanticTokens: {
    correct: string[];
    incorrect: SemanticViolation[];
    suggestions: TokenSuggestion[];
  };
  
  exports: {
    css?: string;
    tailwind?: string;
    typescript?: string;
  };
  
  visualValidation?: {
    screenshot: string; // base64
    consistency: ConsistencyScore;
  };
}
```

### FixCommand
```typescript
interface FixCommand {
  id: string;
  type: 'description' | 'token-replacement' | 'naming' | 'property';
  nodeId: string;
  severity: 'error' | 'warning' | 'info';
  
  current: {
    value: any;
    property?: string;
  };
  
  proposed: {
    value: any;
    token?: string;
  };
  
  code: string; // figma_execute code
  preview?: {
    before: string; // screenshot
    after: string; // screenshot
  };
  
  autoApplicable: boolean;
  requiresReview: boolean;
}
```

---

## 🚀 Implementation Phases

### Phase 1: MCP Integration Foundation (Week 1)
- [ ] Create MCPBridge class
- [ ] Implement connection to Figma Console MCP
- [ ] Test basic data retrieval (variables, styles)
- [ ] Add error handling and fallbacks

### Phase 2: Enriched Analysis (Week 2)
- [ ] Create EnrichedAnalyzer class
- [ ] Implement token coverage checks
- [ ] Implement hardcoded value detection
- [ ] Add semantic token validation
- [ ] Update types.ts with new interfaces

### Phase 3: Auto-Fix System (Week 3)
- [ ] Create AutoFixer class
- [ ] Implement fix command generation
- [ ] Add preview capability (with VisualValidator)
- [ ] Implement execution via MCPBridge
- [ ] Add undo mechanism

### Phase 4: Export Manager (Week 4)
- [ ] Create ExportManager class
- [ ] Implement CSS export
- [ ] Implement Tailwind export
- [ ] Implement TypeScript export
- [ ] Add UI for exports

### Phase 5: Visual Validation (Week 5)
- [ ] Create VisualValidator class
- [ ] Implement screenshot capture
- [ ] Implement before/after comparison
- [ ] Add consistency checker
- [ ] Update UI with visual tab

### Phase 6: Enhanced UI (Week 6)
- [ ] Redesign UI with tabs
- [ ] Add Auto-Fix tab with fix list
- [ ] Add Export tab with format options
- [ ] Add Visual tab with screenshots
- [ ] Polish and user testing

---

## 🔐 Security Considerations

1. **MCP Connection:**
   - Secure communication with MCP server
   - API key management (if needed)
   - Rate limiting

2. **Auto-Fix Execution:**
   - User confirmation required
   - Preview before apply
   - Undo capability
   - Sandbox testing

3. **Data Export:**
   - Sensitive data filtering
   - License compliance
   - Attribution headers

---

## 📈 Success Metrics

1. **Audit Quality:**
   - 95%+ accuracy in token coverage detection
   - 90%+ accuracy in hardcoded value detection
   - 85%+ accuracy in semantic token validation

2. **Auto-Fix:**
   - 80%+ of fixes auto-applicable
   - <5% fix failures
   - 100% undo capability

3. **Export:**
   - Valid CSS/Tailwind/TS output
   - <1s export time for <1000 tokens
   - Copy/download success rate >99%

4. **User Experience:**
   - <3s audit time for typical component
   - <1s fix preview time
   - Intuitive UI (>8/10 usability score)

---

## 🎓 Benefits

### For Designers:
- **Deeper insights** into design system quality
- **Auto-fix suggestions** για common issues
- **Export-ready code** για developers
- **Visual validation** of changes

### For Developers:
- **Code exports** σε multiple formats
- **Token coverage reports** για implementation
- **Semantic validation** of token usage
- **GitHub integration** (future)

### For Design System Teams:
- **Comprehensive audits** with MCP-enriched data
- **Automated quality checks** at scale
- **Consistent standards** enforcement
- **Workshop-ready reports** με visual comparisons

---

## 🔄 Next Steps

1. **Review this architecture** με την ομάδα
2. **Prioritize features** για MVP
3. **Set up MCP connection** (first implementation)
4. **Create prototype** με Phase 1 features
5. **Iterate based on feedback**

---

**Ready to start building?** Let's begin with Phase 1: MCPBridge implementation! 🚀
