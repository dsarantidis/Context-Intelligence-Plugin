# 🔍 Internal Code Review Guide

## Manifest Error Fixed! ✅

**Issue:** Figma δεν δέχεται IP addresses στο `allowedDomains`
**Fix:** Removed `"127.0.0.1"`, kept only `"localhost"`

---

## 📋 Files You Need to Review Internally

### 🚨 Priority 1: Critical Files (Review First)

#### 1. **manifest.json** ✅ FIXED
**What changed:**
```json
// BEFORE (ERROR):
"allowedDomains": ["localhost", "127.0.0.1"]

// AFTER (WORKS):
"allowedDomains": ["localhost"]
```

**Why:** Figma validation requires valid URLs/domains only, not IPs.

**Action:** Import this fixed manifest.json to Figma Desktop

---

#### 2. **types.ts** (Extended +300 lines)
**What to review:**
- Line 1-150: Existing types (unchanged)
- Line 151-450: NEW MCP types

**Key new types to understand:**
```typescript
// Connection
MCPConnectionStatus - Connection state & mode
MCPVariableOptions - Request options
MCPStyleOptions - Style request options

// Data structures  
EnrichedVariableData - Variables με exports
EnrichedComponentAudit - Components με token coverage
TokenCoverage - Coverage analysis
HardcodedValue - Detected hardcoded values
SemanticViolation - Semantic issues

// Auto-fix (future)
FixCommand - Fix specifications
ExecutionResult - Execution results
```

**Action:** Skim through, understand the main interfaces

---

#### 3. **mcp-bridge.ts** (NEW, 330 lines)
**What it does:**
- Connects to Figma Console MCP server
- Handles Desktop Bridge + REST API fallback
- Methods for getting enriched data

**Key methods to understand:**
```typescript
connect() - Auto-detects connection mode
getEnrichedVariables() - Gets tokens με coverage
getEnrichedStyles() - Gets styles με exports  
getComponentMetadata() - Gets component με analysis
executeCode() - Executes fixes (future)
captureScreenshot() - Visual validation (future)
```

**Implementation notes:**
- Line 1-100: Connection management
- Line 101-200: Variable/style operations
- Line 201-280: Component operations
- Line 281-330: Helper methods

**Action:** Understand the connection flow, skim methods

---

#### 4. **enriched-analyzer.ts** (NEW, 430 lines)
**What it does:**
- Enhanced analysis με MCP data
- Token coverage calculation
- Hardcoded value detection
- Semantic validation

**Key methods to understand:**
```typescript
analyzeComponentWithEnrichment() - Main analysis
checkHardcodedValues() - Detects hardcoded values
checkTokenCoverage() - Calculates coverage %
validateSemanticTokens() - Checks naming conventions
```

**Implementation notes:**
- Line 1-80: Class setup & main method
- Line 81-180: Token coverage analysis
- Line 181-280: Semantic validation
- Line 281-430: Helper methods & scoring

**Action:** Understand the analysis flow

---

### ⚙️ Priority 2: Integration Points (Review for Understanding)

#### 5. **code.ts** (Needs update)
**Current state:** Original version (no MCP integration yet)

**What needs to change:**
```typescript
// Add at top:
import { MCPBridge } from './mcp-bridge';
import { EnrichedAnalyzer } from './enriched-analyzer';

// Initialize MCP:
let mcpBridge: MCPBridge | null = null;
let enrichedAnalyzer: EnrichedAnalyzer | null = null;

// Try to connect (async):
(async () => {
  mcpBridge = new MCPBridge({ mode: 'auto' });
  const status = await mcpBridge.connect();
  if (status.connected) {
    enrichedAnalyzer = new EnrichedAnalyzer(mcpBridge, ...);
  }
})();

// In performScan():
if (enrichedAnalyzer) {
  // Use enhanced analysis
  const audit = await enrichedAnalyzer.analyzeComponentWithEnrichment(node);
} else {
  // Use basic analysis (fallback)
  const audit = await componentAnalyzer.analyzeComponent(node);
}
```

**Action:** See IMPLEMENTATION_ROADMAP.md Phase 2 for full code

---

#### 6. **ui.html** (Needs update)
**Current state:** Original version (no MCP status indicator)

**What needs to change:**
```html
<!-- Add MCP status indicator -->
<div id="mcp-status" style="display: none;">
  <span id="mcp-indicator" class="status-badge"></span>
</div>
```

```javascript
// Handle MCP_STATUS message
case 'MCP_STATUS': {
  const statusDiv = document.getElementById('mcp-status');
  const indicator = document.getElementById('mcp-indicator');
  
  if (message.connected) {
    indicator.textContent = `✓ Enhanced mode (${message.mode})`;
    indicator.style.background = '#0fa';
  } else {
    indicator.textContent = '○ Basic mode';
    indicator.style.background = '#999';
  }
  statusDiv.style.display = 'block';
  break;
}
```

**Action:** See IMPLEMENTATION_ROADMAP.md Phase 3 for full code

---

### 📚 Priority 3: Implementation Guides (Read for Integration)

#### 7. **IMPLEMENTATION_ROADMAP.md**
**Critical sections:**
- Phase 2 (pages 8-12): Update code.ts step-by-step
- Phase 3 (pages 13-17): Update ui.html step-by-step
- Phase 4 (page 18): Build & test

**Action:** Follow this step-by-step για integration

---

#### 8. **MCP_INTEGRATION_GUIDE.md**
**Critical sections:**
- "Πώς να Ενεργοποιήσεις το MCP" (page 4)
- "Enhanced Results" comparison (page 6)
- "Workflow" explanation (page 3)

**Action:** Understand how it works end-to-end

---

## 🎯 Review Checklist

### Phase 1: Understand Architecture (30 min)
- [ ] Read VISUAL_ARCHITECTURE.md (visual diagrams)
- [ ] Skim types.ts (new interfaces)
- [ ] Skim mcp-bridge.ts (connection logic)
- [ ] Skim enriched-analyzer.ts (analysis logic)

### Phase 2: Understand Integration (30 min)
- [ ] Read IMPLEMENTATION_ROADMAP.md Phase 2 (code.ts changes)
- [ ] Read IMPLEMENTATION_ROADMAP.md Phase 3 (ui.html changes)
- [ ] Understand the workflow

### Phase 3: Review Configuration (10 min)
- [ ] Check manifest.json (fixed version)
- [ ] Check package.json (build scripts)
- [ ] Check tsconfig.json (compiler settings)

**Total: ~70 minutes για complete understanding**

---

## 🔑 Key Concepts to Understand

### 1. Graceful Degradation
```typescript
// Plugin works with OR without MCP
if (mcpEnabled && enrichedAnalyzer) {
  // Enhanced mode - uses MCP
  const audit = await enrichedAnalyzer.analyzeComponentWithEnrichment(node);
} else {
  // Basic mode - no MCP needed
  const audit = await componentAnalyzer.analyzeComponent(node);
}
```

### 2. Connection Modes
```typescript
// Auto-detection hierarchy:
1. Try Desktop Bridge (preferred) ← real-time
2. Fallback to REST API           ← file URL based
3. Fallback to offline mode       ← basic analysis only
```

### 3. Type Safety
```typescript
// Everything is typed
const audit: EnrichedComponentAudit = await analyzer.analyze(node);

// Token coverage is optional (only με MCP)
if (audit.tokenCoverage) {
  console.log(`Coverage: ${audit.tokenCoverage.percentage}%`);
}
```

---

## 🛠️ Implementation Strategy

### Option A: Internal Testing First (Recommended)
```
1. Review code files (1 hour)
2. Test manifest.json import (5 min)
3. Build plugin: npm run build (5 min)
4. Test basic mode (no MCP) (15 min)
5. Decide on full integration
```

### Option B: Full Integration Now
```
1. Review IMPLEMENTATION_ROADMAP.md (30 min)
2. Follow Phase 2: Update code.ts (1 hour)
3. Follow Phase 3: Update ui.html (1 hour)
4. Follow Phase 4: Build & test (30 min)
5. Follow Phase 5: Validate (30 min)
```

---

## 📊 Code Complexity Analysis

### Simple (Easy to understand)
- ✅ manifest.json - Just configuration
- ✅ package.json - Build scripts
- ✅ tsconfig.json - Compiler settings

### Medium (Need some time)
- 🟡 types.ts - Many interfaces but self-explanatory
- 🟡 mcp-bridge.ts - Clear structure, well-commented
- 🟡 code.ts updates - Step-by-step guide available

### Complex (Need careful review)
- 🔴 enriched-analyzer.ts - Complex analysis logic
- 🔴 ui.html updates - React state management

**Strategy:** Start with Simple → Medium → Complex

---

## 🎓 Learning Path

### Day 1: Understanding (2 hours)
```
Morning:
- Read VISUAL_ARCHITECTURE.md
- Skim types.ts
- Skim mcp-bridge.ts

Afternoon:
- Read IMPLEMENTATION_ROADMAP.md
- Skim enriched-analyzer.ts
- Understand the workflow
```

### Day 2: Implementation (4 hours)
```
Morning:
- Update code.ts (Phase 2)
- Update ui.html (Phase 3)

Afternoon:  
- Build & test (Phase 4)
- Validate both modes (Phase 5)
```

**Total: 6 hours για complete implementation**

---

## 🚨 Common Pitfalls to Avoid

### 1. Manifest Error (ALREADY FIXED ✅)
**Don't:** Use IP addresses in allowedDomains
**Do:** Use domain names only ("localhost")

### 2. Type Errors
**Don't:** Ignore TypeScript errors
**Do:** Run `npm run build` regularly, fix errors immediately

### 3. MCP Connection Assumptions
**Don't:** Assume MCP is always available
**Do:** Always check `mcpBridge.getConnectionStatus()`

### 4. UI Updates
**Don't:** Forget to handle MCP_STATUS message
**Do:** Add MCP status indicator in UI

---

## ✅ Quick Validation

After reviewing, you should be able to answer:

1. **What does MCPBridge do?**
   → Connects to MCP server, gets enriched data

2. **What does EnrichedAnalyzer do?**
   → Enhances basic analysis με token coverage & semantic validation

3. **How does graceful degradation work?**
   → Plugin checks if MCP available, uses it if yes, works without if no

4. **What needs to change in code.ts?**
   → Add MCP initialization, use EnrichedAnalyzer when available

5. **What needs to change in ui.html?**
   → Add MCP status indicator, handle MCP_STATUS message

**If you can answer these, you're ready to implement! 🚀**

---

## 📞 Need Help?

### Quick Reference Files
- **VISUAL_ARCHITECTURE.md** - Diagrams
- **IMPLEMENTATION_ROADMAP.md** - Step-by-step
- **MCP_INTEGRATION_GUIDE.md** - Usage examples

### For Specific Questions
- Connection issues → Check MCPBridge.connect() method
- Type errors → Check types.ts interfaces
- Analysis logic → Check EnrichedAnalyzer methods
- Integration → Check IMPLEMENTATION_ROADMAP.md Phase 2-3

---

**Start here:** Review types.ts → mcp-bridge.ts → enriched-analyzer.ts (in that order)
**Then:** Follow IMPLEMENTATION_ROADMAP.md για integration

**Total review time: ~2 hours before implementation**
