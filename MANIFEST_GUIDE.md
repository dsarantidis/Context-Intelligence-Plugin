# 📋 Manifest Configuration Guide

## Current Manifest (manifest.json)

```json
{
  "name": "DS Context Intelligence",
  "id": "ds-context-intelligence-mcp",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": [
      "localhost",
      "127.0.0.1"
    ],
    "reasoning": "Required for connecting to Figma Console MCP server for enhanced token analysis"
  },
  "capabilities": [],
  "permissions": [],
  "menu": [
    {
      "name": "Audit Design System",
      "command": "audit"
    },
    {
      "name": "Settings",
      "command": "settings"
    }
  ]
}
```

---

## 🔧 Key Configuration Points

### 1. Network Access
```json
"networkAccess": {
  "allowedDomains": [
    "localhost",
    "127.0.0.1"
  ],
  "reasoning": "Required for connecting to Figma Console MCP server for enhanced token analysis"
}
```

**Why needed:**
- Plugin connects to local MCP server (default: `http://localhost:3000`)
- Required for enhanced token analysis features
- Desktop Bridge communication
- REST API fallback

**Security:**
- Only allows localhost (127.0.0.1)
- No external domains
- No user data sent outside Figma
- MCP server runs locally on user's machine

### 2. Menu Commands
```json
"menu": [
  {
    "name": "Audit Design System",
    "command": "audit"
  },
  {
    "name": "Settings",
    "command": "settings"
  }
]
```

**Commands:**
- `audit` - Opens the main audit interface
- `settings` - Opens settings panel (μελλοντικά)

---

## 🚨 Important Notes

### Network Access Considerations

**❗ Figma Review Process:**
Plugins με `networkAccess` χρειάζονται review από το Figma team πριν γίνουν public.

**For Development (Private Use):**
- ✅ Current manifest works perfectly
- ✅ No review needed
- ✅ Can be used in your organization

**For Public Release:**
You'll need to:
1. Submit for Figma review
2. Provide detailed explanation of network usage
3. Demonstrate security measures
4. Pass security audit

### Alternative: No Network Access

Αν θέλεις plugin **χωρίς** network access (basic mode only):

```json
{
  "name": "DS Context Intelligence",
  "id": "ds-context-intelligence-basic",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["none"]
  },
  "capabilities": [],
  "permissions": []
}
```

**Trade-offs:**
- ❌ No MCP integration
- ❌ No token coverage analysis
- ❌ No enhanced features
- ✅ Works in basic mode
- ✅ No review needed for public release

---

## 🎯 Recommended Approach

### Option 1: Development Version (Current)
**For:** Testing, internal use, development
**Manifest:** Current (with localhost network access)
**Benefits:**
- Full MCP features
- Enhanced analysis
- Token coverage
- Semantic validation

### Option 2: Public Version (Future)
**For:** Figma Community release
**Manifest:** Submit for review OR remove network access
**Process:**
1. Complete development with MCP
2. Test thoroughly
3. Decide: Keep MCP (submit for review) or Remove MCP (instant publish)
4. Update manifest accordingly

---

## 📝 Manifest Fields Explained

### Required Fields

```json
{
  "name": "DS Context Intelligence",           // Plugin name (shown in Figma)
  "id": "ds-context-intelligence-mcp",         // Unique identifier
  "api": "1.0.0",                         // Figma Plugin API version
  "main": "code.js",                      // Entry point (compiled from code.ts)
  "ui": "ui.html"                         // UI file
}
```

### Editor Type
```json
"editorType": ["figma"]
```
- Specifies this plugin works in Figma (not FigJam)
- Can also include `["figma", "figjam"]` for both

### Network Access
```json
"networkAccess": {
  "allowedDomains": ["localhost"],
  "reasoning": "Explanation..."
}
```
- Required for any HTTP/fetch requests
- Must list all domains
- Must provide reasoning
- Triggers Figma review process

### Capabilities & Permissions
```json
"capabilities": [],
"permissions": []
```
- Currently empty (read-only plugin)
- Could add in future:
  - `"fileRead"` - Already implicit
  - `"currentUser"` - For user-specific settings

### Menu Commands
```json
"menu": [
  {
    "name": "Display Name",
    "command": "command-id"
  }
]
```
- Optional: Creates submenu
- Without menu: Single command on click

---

## 🔄 Migration Paths

### From Basic to Enhanced

**Step 1:** Use basic manifest (no network)
```json
"networkAccess": {
  "allowedDomains": ["none"]
}
```

**Step 2:** Add network access for MCP
```json
"networkAccess": {
  "allowedDomains": ["localhost"],
  "reasoning": "..."
}
```

**Step 3:** Update code.ts to handle both modes
- Already implemented! ✅
- Graceful fallback built-in

### From Enhanced to Public

**Option A:** Keep MCP, submit for review
```json
// Keep current manifest
// Submit to Figma with explanation
```

**Option B:** Remove MCP for instant publish
```json
"networkAccess": {
  "allowedDomains": ["none"]
}
// Plugin works in basic mode
```

---

## 🧪 Testing Different Configurations

### Test 1: With Network Access
1. Use current manifest
2. Start MCP server
3. Run plugin
4. ✅ Should show "Enhanced mode"

### Test 2: Without Network Access
1. Change manifest to `"allowedDomains": ["none"]`
2. Rebuild plugin
3. Run plugin
4. ✅ Should show "Basic mode"
5. ✅ Should work without errors

### Test 3: MCP Server Offline
1. Use current manifest (with network access)
2. Don't start MCP server
3. Run plugin
4. ✅ Should gracefully fallback to basic mode
5. ✅ Should show "○ Basic mode"

---

## 📊 Manifest Versions Comparison

| Feature | Basic Manifest | Enhanced Manifest |
|---------|---------------|-------------------|
| Network Access | ❌ None | ✅ Localhost |
| Token Coverage | ❌ | ✅ |
| Hardcoded Detection | ❌ | ✅ |
| Semantic Validation | ❌ | ✅ |
| MCP Integration | ❌ | ✅ |
| Figma Review | ❌ Not needed | ⚠️ Required for public |
| Development | ✅ Works | ✅ Works |
| Public Release | ✅ Instant | ⏳ Needs review |

---

## 🎯 Recommendations

### For Development (Now)
✅ **Use Enhanced Manifest (current)**
- Full features
- Easy testing
- No restrictions

### For Internal Use (Team/Organization)
✅ **Use Enhanced Manifest**
- No review needed for private plugins
- Full MCP features
- Best experience

### For Public Release (Future)
🤔 **Decision needed:**

**Path A: With MCP** (Recommended)
- Keep enhanced manifest
- Submit for Figma review
- Provide security documentation
- Best user experience

**Path B: Without MCP** (Faster)
- Remove network access
- Basic mode only
- Instant publish
- Lower value proposition

---

## 📚 Additional Resources

**Figma Plugin API:**
- https://www.figma.com/plugin-docs/

**Network Access:**
- https://www.figma.com/plugin-docs/manifest/#networkaccess

**Plugin Review:**
- https://www.figma.com/plugin-docs/publishing-plugins/

---

## ✅ Current Status

**Manifest:** ✅ Ready for development & testing
**Network Access:** ✅ Configured for localhost
**MCP Support:** ✅ Enabled
**Fallback:** ✅ Graceful degradation implemented

**Next Steps:**
1. Build plugin: `npm run build`
2. Import manifest to Figma
3. Test with MCP server
4. Test without MCP server
5. Validate both modes work

---

**Ready to test! 🚀**
