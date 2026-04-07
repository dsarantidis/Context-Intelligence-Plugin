# 📋 Manifest Variations

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
      "http://localhost:3000"
    ],
    "reasoning": "Required for connecting to Figma Console MCP server for enhanced token analysis"
  },
  "capabilities": [],
  "permissions": []
}
```

✅ This works for: MCP server on `http://localhost:3000`

---

## Alternative Configurations

### Option 1: Multiple Ports (Development)
```json
{
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:8080"
    ],
    "reasoning": "Required for connecting to Figma Console MCP server (multiple port support for development)"
  }
}
```

Use when: Testing με different MCP server ports

---

### Option 2: No Network Access (Basic Mode Only)
```json
{
  "networkAccess": {
    "allowedDomains": ["none"]
  }
}
```

Use when: 
- Public release without MCP
- Testing basic mode only
- No network features needed

---

### Option 3: HTTPS Support (Production)
```json
{
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:3000",
      "https://localhost:3000"
    ],
    "reasoning": "Required for connecting to Figma Console MCP server (HTTP and HTTPS support)"
  }
}
```

Use when: MCP server has SSL certificate

---

## ⚠️ Important Rules

### ✅ Valid Formats
```json
"http://localhost:3000"     // ✅ Full URL with scheme
"https://api.example.com"   // ✅ Full URL with scheme
"http://127.0.0.1:3000"     // ✅ IP with scheme (but not recommended)
```

### ❌ Invalid Formats
```json
"localhost"                 // ❌ No scheme
"localhost:3000"            // ❌ No scheme
"127.0.0.1"                 // ❌ No scheme
"http://localhost"          // ⚠️  Works but missing port
```

---

## 🔄 How to Change

1. **Stop Figma Desktop** (important!)
2. Edit `manifest.json`
3. Save changes
4. **Rebuild plugin:** `npm run build`
5. **Re-import** to Figma
6. Test new configuration

---

## 🧪 Testing Matrix

| Configuration | MCP Port | Expected Result |
|--------------|----------|-----------------|
| `http://localhost:3000` | 3000 | ✅ Enhanced mode |
| `http://localhost:3000` | 3001 | ⚠️ Connection failed → Basic mode |
| `["none"]` | Any | ✅ Basic mode (no network) |
| Multiple ports | Any match | ✅ Enhanced mode |

---

## 📝 Current Setup

**File:** `manifest.json`
**Domain:** `http://localhost:3000`
**Port:** 3000 (default MCP server port)

**To start MCP server:**
```bash
figma-console-mcp --port 3000
```

**To use different port:**
1. Start server: `figma-console-mcp --port 8080`
2. Update manifest: `"http://localhost:8080"`
3. Rebuild & re-import

---

## 🚀 Quick Fix Guide

### Error: "Invalid value for allowedDomains"
**Cause:** Missing `http://` or `https://` scheme
**Fix:** Add `http://` before the domain

**Before:**
```json
"allowedDomains": ["localhost:3000"]  // ❌
```

**After:**
```json
"allowedDomains": ["http://localhost:3000"]  // ✅
```

### Error: "Failed to load resource: 400"
**Cause:** Wrong port or MCP server not running
**Fix:**
1. Check MCP server is running: `ps aux | grep figma-console`
2. Check port matches manifest
3. Try: `lsof -i :3000` to see what's on port 3000

### Error: Network request blocked
**Cause:** Domain not in allowedDomains
**Fix:** Add the domain to manifest, rebuild, re-import

---

## 💡 Pro Tips

### Development Setup
```json
// Use multiple ports for flexibility
"allowedDomains": [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8080"
]
```

### Production Setup
```json
// Use single, specific port
"allowedDomains": [
  "http://localhost:3000"
]
```

### Testing Both Modes
```json
// For testing: Use "none" to force basic mode
"allowedDomains": ["none"]

// For testing: Use real URL to enable enhanced mode
"allowedDomains": ["http://localhost:3000"]
```

---

## ✅ Verification Checklist

After changing manifest:

- [ ] Added `http://` or `https://` scheme
- [ ] Port number matches MCP server
- [ ] Saved manifest.json
- [ ] Ran `npm run build`
- [ ] Closed Figma Desktop completely
- [ ] Re-imported plugin
- [ ] Tested connection

---

**Current manifest should work! ✅**

Next: Import to Figma and test.
