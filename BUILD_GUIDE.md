# 🔨 Build & Setup Guide

## Prerequisites

### Required
- **Node.js** v16+ ([download](https://nodejs.org/))
- **npm** v7+ (comes with Node.js)
- **Figma Desktop** ([download](https://www.figma.com/downloads/))

### Optional (for MCP features)
- **Figma Console MCP** server
- **Chrome DevTools Protocol** support (for Desktop Bridge)

---

## 📦 Installation

### Step 1: Install Dependencies
```bash
cd ds-context-intelligence-mcp
npm install
```

**This installs:**
- `@figma/plugin-typings` - Figma API types
- `typescript` - TypeScript compiler

### Step 2: Verify Installation
```bash
# Check Node version
node --version  # Should be v16+

# Check npm version
npm --version   # Should be v7+

# Check TypeScript
npx tsc --version  # Should be v5.3+
```

---

## 🏗️ Building the Plugin

### Quick Build
```bash
npm run build
```

**This will:**
1. Compile TypeScript files (*.ts → *.js)
2. Copy manifest.json to dist/
3. Copy ui.html to dist/

**Output:**
```
dist/
├── manifest.json
├── ui.html
├── code.js
├── bridge.js
├── types.js
├── component-analyzer.js
├── token-analyzer.js
├── scoring-calculator.js
├── mcp-bridge.js           ← NEW
└── enriched-analyzer.js    ← NEW
```

### Development Mode (Watch)
```bash
npm run watch
```

**Benefits:**
- Auto-recompiles on file changes
- Faster iteration
- No need to manually rebuild

**Usage:**
1. Open terminal, run `npm run watch`
2. Edit TypeScript files
3. Files auto-compile on save
4. Reload plugin in Figma to see changes

### Clean Build
```bash
npm run rebuild
```

**What it does:**
1. Removes dist/ folder
2. Runs fresh build
3. Useful for troubleshooting

---

## 🔧 Build Scripts Explained

### `npm run build`
Main build command. Compiles everything.

### `npm run build:manifest`
Copies manifest.json to dist/. Runs as part of build.

### `npm run build:ui`
Copies ui.html to dist/. Runs as part of build.

### `npm run watch`
Watch mode for development. Auto-compiles on changes.

### `npm run dev`
Alias for watch mode.

### `npm run clean`
Removes dist/ folder.

### `npm run rebuild`
Clean + build. Fresh compilation.

---

## 📥 Importing to Figma

### Method 1: Figma Desktop (Recommended)

1. **Build the plugin**
   ```bash
   npm run build
   ```

2. **Open Figma Desktop**

3. **Go to Plugins menu**
   - Click: Plugins → Development → Import plugin from manifest...

4. **Select manifest.json**
   - Navigate to: `dist/manifest.json`
   - Click: Open

5. **Plugin installed!**
   - Appears in: Plugins → Development → DS Context Intelligence

### Method 2: Drag & Drop

1. **Build the plugin**
   ```bash
   npm run build
   ```

2. **In Figma Desktop**
   - Plugins → Development → Import plugin from manifest...
   - Drag `dist/manifest.json` to Figma window

---

## 🚀 Running the Plugin

### First Run

1. **Open a Figma file**
   - Any file with components, tokens, or styles

2. **Run plugin**
   - Plugins → Development → DS Context Intelligence

3. **Plugin opens**
   - Shows scan buttons
   - Shows MCP status

4. **Try a scan**
   - Select some components
   - Click "Scan Selection"
   - See results!

### With MCP (Enhanced Mode)

1. **Start MCP server** (in separate terminal)
   ```bash
   figma-console-mcp --port 3000
   ```

2. **Run plugin**
   - Should show: "✓ Enhanced mode (desktop_bridge)"

3. **Scan components**
   - See token coverage analysis
   - See hardcoded value detection
   - See semantic validation

### Without MCP (Basic Mode)

1. **Don't start MCP server**

2. **Run plugin**
   - Should show: "○ Basic mode"

3. **Scan components**
   - Basic analysis works
   - No token coverage (expected)
   - No enhanced features (expected)

---

## 🐛 Troubleshooting

### Build Errors

**Error: `Cannot find module 'typescript'`**
```bash
# Solution: Install dependencies
npm install
```

**Error: `tsc: command not found`**
```bash
# Solution: Use npx or install TypeScript globally
npx tsc

# OR
npm install -g typescript
```

**Error: TypeScript compilation errors**
```bash
# Solution: Check types.ts imports
# Make sure all files are present
# Run clean build
npm run rebuild
```

### Import Errors

**Error: "Could not load plugin"**
- ✅ Check: `dist/manifest.json` exists
- ✅ Check: `dist/code.js` exists
- ✅ Check: `dist/ui.html` exists
- ✅ Try: `npm run rebuild`

**Error: "Plugin is not compatible"**
- ✅ Check: Figma Desktop is up to date
- ✅ Check: `manifest.json` has correct `api` version

### Runtime Errors

**Error: Console shows TypeScript errors**
- Plugin is loading .ts files instead of .js
- Solution: Make sure `main: "code.js"` in manifest.json
- Solution: Ensure `outDir: "dist"` in tsconfig.json

**Error: "Cannot read property X of undefined"**
- Check console for full error
- Check that all files compiled correctly
- Try `npm run rebuild`

### MCP Connection Issues

**"MCP not available, using basic mode"**
- ✅ Expected if MCP server not running
- ✅ Plugin works in basic mode
- To enable enhanced mode: Start MCP server

**"Connection refused"**
- Check MCP server is running: `ps aux | grep figma-console`
- Check port 3000 is available: `lsof -i :3000`
- Check manifest.json has localhost in allowedDomains

**"NetworkAccess not allowed"**
- Check manifest.json has networkAccess configured
- Make sure you're using the enhanced manifest
- Rebuild: `npm run build`

---

## 🔄 Development Workflow

### Recommended Workflow

1. **Terminal 1: Watch mode**
   ```bash
   npm run watch
   ```

2. **Terminal 2: MCP server** (optional)
   ```bash
   figma-console-mcp --port 3000
   ```

3. **Edit TypeScript files**
   - Changes auto-compile

4. **Test in Figma**
   - Plugins → Development → DS Context Intelligence
   - Run plugin
   - Check results

5. **Reload plugin** (after changes)
   - Right-click plugin window → Reload
   - OR: Close and reopen plugin

### Hot Reload Tips

**Changes that require reload:**
- TypeScript code changes (code.ts, etc.)
- Type definitions (types.ts)
- Build configuration

**Changes that DON'T require full reload:**
- UI styling (in ui.html <style>)
- Sometimes: UI logic (refresh may work)

**Fast reload trick:**
```bash
# In Figma Desktop
# Right-click plugin window → Reload Plugin
# OR use keyboard shortcut (if available)
```

---

## 📊 Build Output Analysis

### Successful Build
```
$ npm run build

> ds-context-intelligence-mcp@2.0.0 build
> tsc && npm run build:manifest && npm run build:ui

✓ TypeScript compilation successful
✓ Manifest copied
✓ UI copied

Build complete! 
Files ready in dist/
```

### Build with Warnings
```
$ npm run build

warning TS6133: 'x' is declared but never used

✓ Compilation succeeded (with warnings)
```
- Warnings are OK for development
- Should fix before production

### Build with Errors
```
$ npm run build

error TS2304: Cannot find name 'Figma'
error TS2322: Type 'string' is not assignable to type 'number'

✗ Compilation failed
```
- Must fix errors before plugin works
- Check the TypeScript files
- Run `npm run rebuild` after fixes

---

## 📋 Pre-release Checklist

Before sharing the plugin:

### Code Quality
- [ ] All TypeScript errors fixed
- [ ] No console errors in Figma
- [ ] All features working
- [ ] Graceful fallback (MCP on/off)

### Build
- [ ] `npm run rebuild` succeeds
- [ ] All files in dist/
- [ ] manifest.json valid
- [ ] ui.html present

### Testing
- [ ] Works without MCP (basic mode)
- [ ] Works with MCP (enhanced mode)
- [ ] No crashes or errors
- [ ] Results display correctly

### Documentation
- [ ] README.md updated
- [ ] Build guide clear
- [ ] Usage examples provided

---

## 🎯 Next Steps

1. ✅ **Build plugin**
   ```bash
   npm run build
   ```

2. ✅ **Import to Figma**
   - Plugins → Development → Import plugin from manifest
   - Select `dist/manifest.json`

3. ✅ **Test basic mode**
   - Run without MCP server
   - Should work normally

4. ✅ **Test enhanced mode**
   - Start MCP server
   - Run plugin
   - See enhanced features

5. ✅ **Iterate**
   - Use watch mode
   - Make changes
   - Test continuously

---

## 💡 Tips

**Faster builds:**
```bash
# Use watch mode during development
npm run watch
```

**Clean slate:**
```bash
# If something feels wrong
npm run rebuild
```

**Verify output:**
```bash
# Check what was built
ls -la dist/
```

**Check TypeScript:**
```bash
# Compile without running full build
npx tsc --noEmit
```

---

## ✅ Success Indicators

**Build successful when:**
- ✅ No errors in terminal
- ✅ `dist/` folder created
- ✅ All .js files present
- ✅ manifest.json in dist/
- ✅ ui.html in dist/

**Plugin working when:**
- ✅ Imports to Figma successfully
- ✅ Opens without errors
- ✅ Shows scan buttons
- ✅ Can run scan
- ✅ Shows results

**MCP working when:**
- ✅ Status shows "Enhanced mode"
- ✅ Token coverage appears
- ✅ Hardcoded values detected
- ✅ No connection errors

---

**Ready to build! 🚀**

Run `npm run build` and import to Figma!
