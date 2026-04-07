# 🔧 Troubleshooting Guide - Common Errors

## ✅ Good News First!

**The manifest is working!** 🎉

The errors you're seeing are **different issues**, not manifest problems.

---

## 🚨 Current Errors Explained

### 1. Permission Violations (WARNINGS - Not Errors)

```
[Violation] Potential permissions policy violation: camera is not allowed
[Violation] Potential permissions policy violation: microphone is not allowed
[Violation] Potential permissions policy violation: clipboard-write is not allowed
[Violation] Potential permissions policy violation: display-capture is not allowed
```

**What this means:**
- These are **warnings**, not errors
- They appear because the UI iframe has restricted permissions (Figma security)
- Your plugin **can still work** despite these warnings

**Why they appear:**
- Figma restricts certain Web APIs in plugin iframes
- These are logged automatically by the browser
- They don't affect basic plugin functionality

**What to do:**
- ✅ Ignore them for now - they're normal
- ✅ Your plugin should still run
- ⚠️ Don't use camera/microphone/clipboard/screen capture APIs in your plugin

---

### 2. File Not Found Error (REAL ERROR)

```
Error: ENOENT: no such file or directory, lstat 'C:\Users\d...'
at async Promise.all (figma_app_36134a1ab7_min.js.br:230:11187)
```

**What this means:**
- Your plugin code is trying to read a file from disk
- That file doesn't exist
- This is **blocking your plugin from running**

**Possible causes:**

#### Cause A: Missing Build Files
```
Plugin is looking for:
- code.js
- ui.html
- Other built files

But they're not in dist/ folder
```

**Fix:**
```bash
npm run rebuild  # Clean build
```

**Verify:**
```bash
ls dist/
# Should show:
# code.js
# ui.html
# manifest.json
# (other .js files)
```

#### Cause B: Wrong Path in manifest.json
```json
{
  "main": "code.js",      // Looking in dist/ folder
  "ui": "ui.html"         // Looking in dist/ folder
}
```

**If files are in subfolder:**
```json
{
  "main": "src/code.js",  // ❌ Wrong if files in root
  "ui": "src/ui.html"     // ❌ Wrong if files in root
}
```

**Fix:** Make sure paths match your build output

#### Cause C: Code Trying to Access Local Files
```typescript
// ❌ BAD - Plugin code trying to read local files
import fs from 'fs';
const data = fs.readFileSync('C:/Users/...');
```

**Why it fails:**
- Figma plugins **cannot access local filesystem**
- They run in a sandbox
- No fs, no path, no local files

**Fix:** Remove any file system access from code

---

## 🔍 Debug Steps

### Step 1: Verify Build Output

```bash
cd /path/to/plugin
npm run build

# Check dist/ contents:
ls -la dist/

# Should see:
# manifest.json
# code.js
# ui.html
# bridge.js
# types.js
# component-analyzer.js
# token-analyzer.js
# scoring-calculator.js
# mcp-bridge.js
# enriched-analyzer.js
```

### Step 2: Check manifest.json Paths

```bash
cat dist/manifest.json
```

Verify:
```json
{
  "main": "code.js",     // ✅ Relative to dist/
  "ui": "ui.html"        // ✅ Relative to dist/
}
```

### Step 3: Check for Filesystem Access in Code

Search your code files for:
```bash
grep -r "fs\." src/
grep -r "readFile" src/
grep -r "writeFile" src/
grep -r "path\." src/
grep -r "require('fs')" src/
grep -r "import.*fs" src/
```

If you find any → **Remove them** (Figma plugins can't use these)

### Step 4: Test with Minimal Code

Create a test version:

**test-code.ts:**
```typescript
figma.showUI(__html__);

figma.ui.onmessage = (msg) => {
  if (msg.type === 'test') {
    figma.ui.postMessage({ type: 'result', text: 'Plugin works!' });
  }
};
```

**test-ui.html:**
```html
<!DOCTYPE html>
<html>
<body>
  <button onclick="parent.postMessage({pluginMessage: {type: 'test'}}, '*')">Test</button>
  <div id="result"></div>
  <script>
    window.onmessage = (event) => {
      if (event.data.pluginMessage.type === 'result') {
        document.getElementById('result').textContent = event.data.pluginMessage.text;
      }
    };
  </script>
</body>
</html>
```

If this works → Problem is in your main code
If this fails → Problem is with setup/build

---

## 🎯 Most Likely Causes

### 1. Build Not Completed ⭐⭐⭐⭐⭐
**Probability: Very High**

```bash
# Fix:
cd /path/to/ds-context-intelligence-mcp
npm install
npm run rebuild
```

Then re-import to Figma.

### 2. Wrong Import Path ⭐⭐⭐⭐
**Probability: High**

Check if you're importing the manifest from the right place:
- ❌ `src/manifest.json` (source folder)
- ✅ `dist/manifest.json` (build folder)

### 3. Filesystem Access in Code ⭐⭐⭐
**Probability: Medium**

If your code has:
```typescript
import fs from 'fs';  // ❌ Not allowed in Figma plugins
```

Remove it and use Figma API instead.

### 4. Missing Dependencies ⭐⭐
**Probability: Low**

```bash
npm install
```

### 5. TypeScript Not Compiled ⭐
**Probability: Low**

```bash
npx tsc --version  # Check TypeScript is installed
npm run build      # Compile
```

---

## ✅ Quick Fix Checklist

Do these in order:

- [ ] `cd` to plugin directory
- [ ] `npm install` (install dependencies)
- [ ] `npm run rebuild` (clean build)
- [ ] Check `dist/` folder exists and has files
- [ ] Check `dist/manifest.json` has correct paths
- [ ] Close Figma Desktop completely
- [ ] Reopen Figma Desktop
- [ ] Import plugin from `dist/manifest.json`
- [ ] Run plugin and check console

---

## 🔬 Advanced Debugging

### Check Plugin Console

1. Run plugin in Figma
2. Open DevTools: **Plugins → Development → Open Console**
3. Look for errors

**Common errors:**

```javascript
// Error: Cannot find module
→ Build didn't complete
→ Fix: npm run rebuild

// Error: Unexpected token
→ Loading .ts instead of .js
→ Fix: Check manifest "main": "code.js" not "code.ts"

// Error: fetch is not defined
→ Trying to use Web APIs in plugin context
→ Fix: Use figma.ui.postMessage instead

// Error: fs is not defined  
→ Trying to access filesystem
→ Fix: Remove filesystem access
```

### Check UI Console

1. Run plugin
2. Right-click on plugin UI
3. Select "Inspect"
4. Check Console tab

**Common errors:**

```javascript
// Violation warnings
→ Normal, ignore them

// Error: postMessage failed
→ Communication issue between UI and plugin
→ Fix: Check message handlers

// Error: Cannot read property X
→ UI JavaScript error
→ Fix: Check ui.html script
```

---

## 📋 Working Configuration

This is what should work:

**Directory structure:**
```
ds-context-intelligence-mcp/
├── src/
│   ├── code.ts           # Plugin code (TypeScript)
│   ├── ui.html           # UI file
│   ├── mcp-bridge.ts
│   ├── enriched-analyzer.ts
│   └── ...
├── dist/                 # ← Import from here!
│   ├── manifest.json     # ← Point Figma here!
│   ├── code.js           # Compiled
│   ├── ui.html           # Copied
│   ├── mcp-bridge.js     # Compiled
│   └── ...
├── package.json
├── tsconfig.json
└── node_modules/
```

**manifest.json:**
```json
{
  "name": "DS Context Intelligence",
  "id": "ds-context-intelligence-mcp",
  "api": "1.0.0",
  "main": "code.js",           // ← Relative to dist/
  "ui": "ui.html",             // ← Relative to dist/
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": [
      "http://localhost:3000"
    ],
    "reasoning": "Required for connecting to Figma Console MCP server"
  },
  "capabilities": [],
  "permissions": []
}
```

**Build command:**
```bash
npm run build
# Should output:
# > tsc && cp manifest.json dist/ && cp src/ui.html dist/
```

**Import to Figma:**
1. Figma → Plugins → Development → Import plugin from manifest
2. Select: `dist/manifest.json` (NOT `src/manifest.json`)
3. Click Import

---

## 🆘 Still Not Working?

### Collect Debug Info

```bash
# 1. Check build output
ls -la dist/

# 2. Check manifest
cat dist/manifest.json

# 3. Check for filesystem access
grep -r "require('fs')" src/
grep -r "import.*fs" src/

# 4. Check TypeScript compilation
npm run build 2>&1 | tee build.log

# 5. Test minimal plugin
# (use test-code.ts + test-ui.html from above)
```

### Share This Info

- Build output (`ls -la dist/`)
- Build log (any errors?)
- Console errors (from Figma DevTools)
- manifest.json content
- First 50 lines of code.ts

---

## 💡 Prevention Tips

### 1. Always Build Before Import
```bash
npm run build  # Before every import!
```

### 2. Import from dist/, Never from src/
```
✅ Import: dist/manifest.json
❌ Import: src/manifest.json
❌ Import: manifest.json (root)
```

### 3. Watch Mode for Development
```bash
npm run watch  # Auto-compiles on changes
```

Then just reload plugin in Figma (no re-import needed)

### 4. Clean Rebuild When Confused
```bash
npm run rebuild  # Cleans + rebuilds everything
```

---

## 🎓 Understanding the Errors

### Why "ENOENT" happens:

1. **Plugin expects compiled .js files**
2. **Build process creates them in dist/**
3. **If build fails/incomplete → files missing**
4. **Figma tries to load missing files → ENOENT error**

### Why permission violations are OK:

1. **Figma restricts iframe capabilities (security)**
2. **Browser logs these as warnings**
3. **Doesn't stop plugin from working**
4. **Only matters if you actually try to use those APIs**

---

**Next step: Run `npm run rebuild` and check dist/ folder! 🚀**
