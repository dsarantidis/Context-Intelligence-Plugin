# 🏗️ DS Context Intelligence + MCP - Visual Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLAUDE AI (MCP)                             │
│                                                                      │
│  ╔══════════════════════════════════════════════════════════════╗  │
│  ║           Figma Console MCP Server                           ║  │
│  ║                                                              ║  │
│  ║  Tools Available:                                            ║  │
│  ║  • figma_get_variables (enriched token data)                 ║  │
│  ║  • figma_get_styles (enriched style data)                    ║  │
│  ║  • figma_get_component (metadata + token coverage)           ║  │
│  ║  • figma_execute (auto-fix commands)                         ║  │
│  ║  • figma_capture_screenshot (visual validation)              ║  │
│  ╚══════════════════════════════════════════════════════════════╝  │
│                              ▲                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                     REST API / CDP (Chrome DevTools Protocol)
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                       FIGMA DESKTOP APP                              │
│                                                                      │
│  ╔══════════════════════════════════════════════════════════════╗  │
│  ║              DS CONTEXT CHECKER PLUGIN                       ║  │
│  ║                                                              ║  │
│  ║  ┌─────────────────────────────────────────────────────┐    ║  │
│  ║  │            MAIN ENTRY (code.ts)                     │    ║  │
│  ║  │                                                     │    ║  │
│  ║  │  • Initialize components                           │    ║  │
│  ║  │  • Connect to MCP (async)                          │    ║  │
│  ║  │  • Handle scan commands                            │    ║  │
│  ║  └───────────────────┬─────────────────────────────────┘    ║  │
│  ║                      │                                       ║  │
│  ║         ┌────────────┼────────────┐                          ║  │
│  ║         │            │            │                          ║  │
│  ║    ┌────▼───┐   ┌───▼────┐  ┌───▼────┐                      ║  │
│  ║    │ Basic  │   │Enhanced│  │  MCP   │                      ║  │
│  ║    │Analyzer│   │Analyzer│  │ Bridge │                      ║  │
│  ║    └────┬───┘   └───┬────┘  └───┬────┘                      ║  │
│  ║         │           │           │                            ║  │
│  ║         │      ┌────▼───────────▼─────┐                      ║  │
│  ║         │      │                      │                      ║  │
│  ║         │      │  Token Coverage      │                      ║  │
│  ║         │      │  • % calculation     │                      ║  │
│  ║         │      │  • Hardcoded detect  │                      ║  │
│  ║         │      │  • Semantic validate │                      ║  │
│  ║         │      │                      │                      ║  │
│  ║         │      └──────────────────────┘                      ║  │
│  ║         │                                                    ║  │
│  ║         └──────────────┬─────────────────────────────────────║  │
│  ║                        │                                     ║  │
│  ║                 ┌──────▼──────┐                              ║  │
│  ║                 │   Results   │                              ║  │
│  ║                 │             │                              ║  │
│  ║                 │ • Score     │                              ║  │
│  ║                 │ • Findings  │                              ║  │
│  ║                 │ • Coverage  │                              ║  │
│  ║                 │ • Semantic  │                              ║  │
│  ║                 └──────┬──────┘                              ║  │
│  ╚════════════════════════┼════════════════════════════════════╝  │
│                            │                                       │
│                     ┌──────▼──────┐                                │
│                     │             │                                │
│  ╔══════════════════▼═══════════════════════════════════════╗     │
│  ║                  PLUGIN UI (ui.html)                     ║     │
│  ║                                                          ║     │
│  ║  ┌────────────────────────────────────────────────┐     ║     │
│  ║  │  MCP Status                                    │     ║     │
│  ║  │  ✓ Enhanced mode (desktop_bridge)             │     ║     │
│  ║  └────────────────────────────────────────────────┘     ║     │
│  ║                                                          ║     │
│  ║  ┌────────────────────────────────────────────────┐     ║     │
│  ║  │  Scan Buttons                                  │     ║     │
│  ║  │  [Scan Selection] [Scan Page] [Scan File]     │     ║     │
│  ║  └────────────────────────────────────────────────┘     ║     │
│  ║                                                          ║     │
│  ║  ┌────────────────────────────────────────────────┐     ║     │
│  ║  │  Results                                       │     ║     │
│  ║  │                                                │     ║     │
│  ║  │  Score: 78/100 (C+)                           │     ║     │
│  ║  │  ├─ Identity: 80                              │     ║     │
│  ║  │  ├─ Documentation: 70                         │     ║     │
│  ║  │  ├─ Properties: 75                            │     ║     │
│  ║  │  └─ Context: 75                               │     ║     │
│  ║  │                                                │     ║     │
│  ║  │  ✨ Token Analysis:                            │     ║     │
│  ║  │  ┌──────────────────────────────────────┐     │     ║     │
│  ║  │  │ ████████████████░░░░░░░░ 65%        │     │     ║     │
│  ║  │  └──────────────────────────────────────┘     │     ║     │
│  ║  │  • Tokenized: 13                              │     ║     │
│  ║  │  • Hardcoded: 7 ⚠️                             │     ║     │
│  ║  │                                                │     ║     │
│  ║  │  📋 Findings:                                  │     ║     │
│  ║  │  ⚠️  Description too short                     │     ║     │
│  ║  │  🔴 Missing property descriptions              │     ║     │
│  ║  │  ⚠️  Token coverage below target               │     ║     │
│  ║  │  🔴 Found 3 hardcoded values                   │     ║     │
│  ║  └────────────────────────────────────────────────┘     ║     │
│  ╚══════════════════════════════════════════════════════════╝     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## 📊 Data Flow

### Flow 1: Basic Scan (Without MCP)
```
User Click
    ↓
[Scan Button]
    ↓
code.ts → ComponentAnalyzer
    ↓
Basic Checks:
├─ Identity
├─ Documentation
├─ Properties
└─ Context
    ↓
Results → UI
    ↓
Display Score + Findings
```

### Flow 2: Enhanced Scan (With MCP)
```
User Click
    ↓
[Scan Button]
    ↓
code.ts → EnrichedAnalyzer
    ↓
Basic Checks (ComponentAnalyzer)
    ↓
MCP Enrichment:
├─ MCPBridge.connect()
├─ getComponentMetadata(nodeId)
│   └─ Token coverage data
│   └─ Hardcoded values
│   └─ Semantic analysis
├─ validateSemanticTokens()
└─ checkHardcodedValues()
    ↓
Combined Results:
├─ Basic score
├─ Enhanced score (adjusted)
├─ Basic findings
├─ Token coverage findings
├─ Semantic findings
└─ Hardcoded value findings
    ↓
Results → UI
    ↓
Display:
├─ Enhanced score
├─ Token coverage meter
├─ All findings
└─ MCP status
```

### Flow 3: MCP Connection
```
Plugin Initialization
    ↓
code.ts startup
    ↓
Create MCPBridge({
  mode: 'auto'
})
    ↓
Try Desktop Bridge
    ├─ Success? ✅
    │   └─ Use Desktop Bridge
    │       └─ Real-time updates
    │
    └─ Failed? ❌
        └─ Try REST API
            ├─ Success? ✅
            │   └─ Use REST API
            │       └─ File URL based
            │
            └─ Failed? ❌
                └─ Offline Mode
                    └─ Basic analysis only
    ↓
Notify UI:
├─ MCP_STATUS message
├─ Show badge
└─ Enable/disable features
```

## 🔄 Component Interactions

### MCPBridge ↔ MCP Server
```
MCPBridge
    ↓
POST /variables
    {
      tool: 'figma_get_variables',
      params: {
        enrich: true,
        resolveAliases: true
      }
    }
    ↓
MCP Server
    ↓
Figma REST API / Desktop Bridge
    ↓
Response:
    {
      variables: [...],
      collections: [...],
      exports: {
        css: "...",
        tailwind: "..."
      }
    }
    ↓
MCPBridge.parseVariableResponse()
    ↓
EnrichedVariableData
```

### EnrichedAnalyzer ↔ MCPBridge
```
EnrichedAnalyzer.analyzeComponentWithEnrichment(node)
    ↓
1. Basic audit
   ComponentAnalyzer.analyzeComponent(node)
    ↓
2. Get MCP metadata
   MCPBridge.getComponentMetadata(node.id, { enrich: true })
    ↓
3. Extract coverage
   metadata.tokenCoverage → TokenCoverage
    ↓
4. Validate semantics
   validateSemanticTokens(node, coverage)
    ↓
5. Generate findings
   generateEnrichedFindings(basicAudit, tokenCoverage, semanticTokens)
    ↓
6. Calculate score
   calculateEnrichedScore(basicScore, tokenCoverage)
    ↓
EnrichedComponentAudit
```

## 🎯 Key Points

### Graceful Degradation
- ✅ Works WITHOUT MCP
- ✅ Auto-detects MCP availability
- ✅ No errors if MCP unavailable
- ✅ Seamless fallback

### Type Safety
- ✅ Comprehensive TypeScript types
- ✅ All MCP responses typed
- ✅ Compile-time safety
- ✅ IDE autocomplete

### Performance
- ✅ Async connection (non-blocking)
- ✅ Batch processing
- ✅ Progress tracking
- ✅ <3s analysis time

### Extensibility
- ✅ Easy to add new checks
- ✅ Pluggable analyzers
- ✅ Modular architecture
- ✅ Clear interfaces
