# 🗺️ DS Context Intelligence + MCP - Implementation Roadmap

## Overview

Αυτό το document περιγράφει **step-by-step** πώς να ενσωματώσουμε τα MCP features στο existing DS Context Intelligence plugin.

---

## 📋 Prerequisites

**Έχουμε ήδη:**
- ✅ Functional DS Context Intelligence plugin (basic)
- ✅ MCPBridge class (new)
- ✅ EnrichedAnalyzer class (new)
- ✅ Extended types (new)
- ✅ Architecture documentation

**Χρειαζόμαστε:**
- [ ] Figma Console MCP server running
- [ ] Updated code.ts που χρησιμοποιεί EnrichedAnalyzer
- [ ] Updated UI που δείχνει token coverage
- [ ] Testing & validation

---

## 🎯 Implementation Phases

### Phase 1: Setup & Dependencies ⏱️ 30 minutes

#### Step 1.1: Update package.json
```json
{
  "dependencies": {
    "@figma/plugin-typings": "^1.91.0",
    "typescript": "^5.3.3"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "test": "echo \"No tests yet\" && exit 0"
  }
}
```

**No new dependencies needed!** MCP connection uses fetch() which is available in Figma plugins.

#### Step 1.2: Update tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": [
    "*.ts"
  ]
}
```

**No changes needed** - existing config works!

#### Step 1.3: Verify File Structure
```
ds-context-intelligence/
├── code.ts                    (existing - will update)
├── types.ts                   (updated ✅)
├── bridge.ts                  (existing)
├── scoring-calculator.ts      (existing)
├── component-analyzer.ts      (existing)
├── token-analyzer.ts          (existing)
├── mcp-bridge.ts             (new ✅)
├── enriched-analyzer.ts      (new ✅)
├── ui.html                    (existing - will update)
├── manifest.json              (existing)
├── package.json               (existing)
└── tsconfig.json              (existing)
```

---

### Phase 2: Update code.ts ⏱️ 1 hour

**Goal:** Add MCP integration without breaking existing functionality.

#### Step 2.1: Add Imports
```typescript
// At top of code.ts, add:
import { MCPBridge } from './mcp-bridge';
import { EnrichedAnalyzer } from './enriched-analyzer';
import type { EnrichedComponentAudit } from './types';
```

#### Step 2.2: Initialize MCP (with graceful fallback)
```typescript
// After existing initializations
const bridge = new Bridge();
const selectionManager = new SelectionManager(bridge);
const componentAnalyzer = new ComponentAnalyzer();
const tokenAnalyzer = new TokenAnalyzer();
const scoringCalculator = new ScoringCalculator();

// NEW: Initialize MCP Bridge
let mcpBridge: MCPBridge | null = null;
let enrichedAnalyzer: EnrichedAnalyzer | null = null;
let mcpEnabled = false;

// Try to connect to MCP (async, don't block plugin loading)
(async () => {
  try {
    mcpBridge = new MCPBridge({
      mode: 'auto' // Auto-detect Desktop Bridge vs REST
    });
    
    const status = await mcpBridge.connect();
    
    if (status.connected) {
      mcpEnabled = true;
      enrichedAnalyzer = new EnrichedAnalyzer(
        mcpBridge,
        componentAnalyzer,
        tokenAnalyzer,
        scoringCalculator
      );
      
      console.log(`[DS Context Intelligence] ✓ MCP connected via ${status.mode}`);
      
      // Notify UI
      bridge.send({
        type: 'MCP_STATUS',
        connected: true,
        mode: status.mode
      });
    } else {
      console.log('[DS Context Intelligence] MCP not available, using basic mode');
      
      bridge.send({
        type: 'MCP_STATUS',
        connected: false,
        error: status.error
      });
    }
  } catch (error) {
    console.warn('[DS Context Intelligence] MCP initialization failed:', error);
    mcpEnabled = false;
  }
})();
```

#### Step 2.3: Update performScan() Function
```typescript
async function performScan(
  scope: 'selection' | 'page' | 'file',
  nodes: readonly SceneNode[]
): Promise<void> {
  const startTime = Date.now();
  
  bridge.send({
    type: 'SCAN_STARTED',
    totalItems: nodes.length
  });

  try {
    // NEW: Use EnrichedAnalyzer if MCP is available
    const useEnriched = mcpEnabled && enrichedAnalyzer !== null;
    
    if (useEnriched) {
      console.log('[DS Context Intelligence] Using enriched analysis with MCP');
    } else {
      console.log('[DS Context Intelligence] Using basic analysis (MCP not available)');
    }

    const components: (ComponentAudit | EnrichedComponentAudit)[] = [];
    const tokens: TokenAudit[] = [];
    const styles: StyleAudit[] = [];

    // Process components
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      bridge.sendProgress(i + 1, nodes.length, node.name);

      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        // NEW: Choose analyzer based on MCP availability
        let audit: ComponentAudit | EnrichedComponentAudit;
        
        if (useEnriched) {
          audit = await enrichedAnalyzer!.analyzeComponentWithEnrichment(node);
        } else {
          audit = await componentAnalyzer.analyzeComponent(node);
        }
        
        components.push(audit);
      }

      // Small delay to prevent blocking
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Rest of the function stays the same...
    // (token analysis, style analysis, summary calculation)
    
    // ... existing code ...

  } catch (error) {
    bridge.sendError(error instanceof Error ? error.message : 'Unknown error during scan');
  }
}
```

#### Step 2.4: Add New Message Type to types.ts
```typescript
// In types.ts, update MessageFromPlugin:
export type MessageFromPlugin = 
  | { type: 'SCAN_STARTED', totalItems: number }
  | { type: 'SCAN_PROGRESS', current: number, total: number, currentItem: string }
  | { type: 'SCAN_COMPLETE', results: AuditResults }
  | { type: 'SCAN_ERROR', error: string }
  | { type: 'SELECTION_CHANGED', hasSelection: boolean, count: number }
  | { type: 'EXPORT_READY', content: string, filename: string }
  | { type: 'MCP_STATUS', connected: boolean, mode?: string, error?: string }; // NEW
```

---

### Phase 3: Update UI ⏱️ 1.5 hours

**Goal:** Show MCP status and enhanced results in the UI.

#### Step 3.1: Add MCP Status Indicator
```html
<!-- In ui.html, after the header -->
<div id="header">
  <h2>DS Context Intelligence</h2>
  <p>Audit your Design System for consistency and quality</p>
  
  <!-- NEW: MCP Status -->
  <div id="mcp-status" style="display: none;">
    <span id="mcp-indicator" class="status-badge"></span>
  </div>
</div>
```

```javascript
// In BridgeClient, handle MCP_STATUS
case 'MCP_STATUS': {
  this.handleMCPStatus(message.connected, message.mode, message.error);
  break;
}

// Add handler method
handleMCPStatus(connected, mode, error) {
  const statusDiv = document.getElementById('mcp-status');
  const indicator = document.getElementById('mcp-indicator');
  
  if (connected) {
    statusDiv.style.display = 'block';
    indicator.textContent = `✓ Enhanced mode (${mode})`;
    indicator.style.background = '#0fa';
    indicator.style.color = '#000';
  } else if (error) {
    statusDiv.style.display = 'block';
    indicator.textContent = '○ Basic mode';
    indicator.style.background = '#999';
    indicator.style.color = '#fff';
  }
}
```

#### Step 3.2: Add Token Coverage Display
```javascript
// In the results rendering, add token coverage section
function renderResults(results) {
  // Existing score card...
  
  // NEW: Token coverage section (if available)
  if (results.components.some(c => c.tokenCoverage)) {
    const avgCoverage = calculateAverageCoverage(results.components);
    
    html += `
      <div class="token-coverage-section">
        <h3>Token Analysis</h3>
        <div class="coverage-meter">
          <div class="coverage-bar" style="width: ${avgCoverage}%"></div>
          <span class="coverage-label">${avgCoverage.toFixed(1)}% Token Coverage</span>
        </div>
        
        <div class="coverage-stats">
          <div class="stat">
            <span class="stat-label">Tokenized:</span>
            <span class="stat-value">${countTokenized(results.components)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Hardcoded:</span>
            <span class="stat-value">${countHardcoded(results.components)}</span>
          </div>
        </div>
      </div>
    `;
  }
  
  return html;
}

function calculateAverageCoverage(components) {
  const withCoverage = components.filter(c => c.tokenCoverage);
  if (withCoverage.length === 0) return 0;
  
  const total = withCoverage.reduce((sum, c) => sum + c.tokenCoverage.percentage, 0);
  return total / withCoverage.length;
}

function countTokenized(components) {
  return components.reduce((sum, c) => 
    sum + (c.tokenCoverage?.usingTokens || 0), 0
  );
}

function countHardcoded(components) {
  return components.reduce((sum, c) => 
    sum + (c.tokenCoverage?.hardcoded || 0), 0
  );
}
```

#### Step 3.3: Add CSS Styling
```css
/* Add to ui.html styles */
.status-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-top: 8px;
}

.token-coverage-section {
  margin-top: 24px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.coverage-meter {
  position: relative;
  height: 32px;
  background: #e0e0e0;
  border-radius: 16px;
  overflow: hidden;
  margin: 12px 0;
}

.coverage-bar {
  height: 100%;
  background: linear-gradient(90deg, #4caf50, #8bc34a);
  transition: width 0.3s ease;
}

.coverage-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-weight: 600;
  font-size: 13px;
  color: #000;
  mix-blend-mode: difference;
}

.coverage-stats {
  display: flex;
  gap: 24px;
  margin-top: 12px;
}

.stat {
  flex: 1;
}

.stat-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 600;
  color: #000;
  margin-top: 4px;
}
```

---

### Phase 4: Build & Test ⏱️ 1 hour

#### Step 4.1: Build Plugin
```bash
cd ds-context-intelligence
npm run build
```

**Expected output:**
```
dist/
├── code.js
├── bridge.js
├── types.js
├── component-analyzer.js
├── token-analyzer.js
├── scoring-calculator.js
├── mcp-bridge.js           ← NEW
├── enriched-analyzer.js    ← NEW
└── manifest.json (copied)
```

#### Step 4.2: Import to Figma
1. Open Figma Desktop
2. Plugins → Development → Import plugin from manifest
3. Select `dist/manifest.json`
4. Plugin appears in menu

#### Step 4.3: Test Without MCP (Baseline)
1. Run plugin σε test file
2. Click "Scan Selection"
3. **Expected:** Works normally, shows "○ Basic mode"
4. **Expected:** No token coverage section
5. **Expected:** Basic audit results

#### Step 4.4: Start MCP Server
```bash
# Option 1: If you have Figma Console MCP installed
figma-console-mcp --port 3000

# Option 2: Mock server for testing (create simple Express server)
node mock-mcp-server.js
```

#### Step 4.5: Test With MCP (Enhanced)
1. Restart plugin (or Figma Desktop)
2. **Expected:** Console shows "✓ MCP connected via desktop_bridge"
3. Run plugin σε test file
4. Click "Scan Selection"
5. **Expected:** Shows "✓ Enhanced mode (desktop_bridge)"
6. **Expected:** Token coverage section appears
7. **Expected:** Enhanced findings με token coverage

---

### Phase 5: Validation ⏱️ 30 minutes

#### Test Cases

**Test 1: Plugin works without MCP**
- [ ] Starts successfully
- [ ] Shows "○ Basic mode"
- [ ] Runs scans normally
- [ ] No errors in console

**Test 2: Plugin connects to MCP**
- [ ] MCP server running
- [ ] Plugin shows "✓ Enhanced mode"
- [ ] Connection successful in console

**Test 3: Enhanced analysis works**
- [ ] Token coverage appears
- [ ] Coverage % is calculated
- [ ] Hardcoded values detected
- [ ] Enhanced findings shown

**Test 4: Graceful degradation**
- [ ] Start with MCP, then stop MCP
- [ ] Plugin continues working in basic mode
- [ ] No crashes or errors

**Test 5: UI rendering**
- [ ] Token coverage meter displays correctly
- [ ] Stats show correct counts
- [ ] Styles apply correctly
- [ ] No visual glitches

---

### Phase 6: Documentation ⏱️ 1 hour

#### Update README.md
```markdown
## Features

### Basic Analysis (Always Available)
- Component quality scoring
- Identity checks (naming, conventions)
- Documentation checks (descriptions, links)
- Property checks (naming, descriptions)
- Context checks (usage, accessibility)

### Enhanced Analysis (When MCP is Connected) ✨
- **Token Coverage Analysis** - See how well your components use design tokens
- **Hardcoded Value Detection** - Find values that should be tokens
- **Semantic Token Validation** - Check if tokens follow naming conventions
- **Enhanced Findings** - More detailed insights with MCP data

## Setup

### Basic Mode (No Setup Required)
Just install and run! The plugin works out-of-the-box with basic analysis.

### Enhanced Mode (Optional)
For token coverage analysis and enhanced insights:

1. Install Figma Console MCP:
   ```bash
   npm install -g @southleft/figma-console-mcp
   ```

2. Start MCP server:
   ```bash
   figma-console-mcp --port 3000
   ```

3. Restart plugin - it will auto-connect!
```

#### Create TROUBLESHOOTING.md
```markdown
# Troubleshooting

## MCP Connection Issues

### "MCP not available, using basic mode"
This is normal if MCP server is not running. Plugin works fine in basic mode.

**To enable enhanced mode:**
1. Install MCP: `npm install -g @southleft/figma-console-mcp`
2. Start server: `figma-console-mcp --port 3000`
3. Restart plugin

### "Connection refused" errors
- Check MCP server is running: `ps aux | grep figma-console`
- Check port 3000 is available: `lsof -i :3000`
- Try different port: `figma-console-mcp --port 3001`

### Token coverage not showing
- Ensure MCP status shows "✓ Enhanced mode"
- Check console for connection errors
- Try re-scanning after MCP connects
```

---

## 📊 Success Metrics

### Phase 1-2: Code Integration
- [ ] Builds without errors
- [ ] No TypeScript errors
- [ ] All imports resolve correctly

### Phase 3: UI Integration
- [ ] MCP status indicator works
- [ ] Token coverage displays correctly
- [ ] No visual regressions

### Phase 4-5: Testing
- [ ] Works without MCP (basic mode)
- [ ] Works with MCP (enhanced mode)
- [ ] Graceful degradation
- [ ] No console errors

### Phase 6: Documentation
- [ ] README updated
- [ ] Troubleshooting guide created
- [ ] Examples documented

---

## 🎯 Timeline Estimate

| Phase | Time | Dependencies |
|-------|------|--------------|
| Phase 1: Setup | 30 min | None |
| Phase 2: code.ts | 1 hour | Phase 1 |
| Phase 3: UI | 1.5 hours | Phase 2 |
| Phase 4: Build & Test | 1 hour | Phase 3 |
| Phase 5: Validation | 30 min | Phase 4 |
| Phase 6: Docs | 1 hour | Phase 5 |
| **Total** | **5.5 hours** | - |

---

## 🚀 Next Steps After Integration

### Immediate (Week 1)
- [ ] User testing με 3-5 designers
- [ ] Collect feedback
- [ ] Fix critical bugs

### Short-term (Weeks 2-4)
- [ ] Add more semantic token validation rules
- [ ] Improve hardcoded value detection
- [ ] Add export capabilities (CSS/Tailwind/TS)

### Mid-term (Months 2-3)
- [ ] Auto-fix system
- [ ] Visual validation με screenshots
- [ ] Batch processing improvements

### Long-term (Months 4-6)
- [ ] GitHub integration
- [ ] Team dashboard
- [ ] Custom rules engine

---

## ✅ Ready to Start?

**Checklist:**
- [ ] Backup current plugin code
- [ ] Read all documentation
- [ ] Prepare test files
- [ ] Set up MCP server (optional)
- [ ] Allocate 5-6 hours
- [ ] Have Figma Desktop ready

**Let's go!** Start with Phase 1 → Setup & Dependencies 🚀
