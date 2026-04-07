# DS Context Intelligence - Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Prerequisites
```bash
# Verify Node.js is installed (18+)
node --version

# Verify npm
npm --version
```

### 2. Install & Build
```bash
# Navigate to project
cd ds-context-intelligence

# Install dependencies
npm install

# Build the plugin
npm run build
```

**Expected output:**
```
dist/
├── bridge.js
├── code.js
├── component-analyzer.js
├── scoring-calculator.js
├── token-analyzer.js
├── types.js
├── ui.html
└── [.d.ts and .map files]
```

### 3. Import to Figma

1. **Open Figma Desktop**
2. Go to **Plugins → Development → Import plugin from manifest**
3. Select `manifest.json` from the project root
4. Plugin appears in **Plugins → Development → DS Context Intelligence**

### 4. First Run

1. **Open any Figma file** (or use the test file below)
2. **Select some components** (optional)
3. **Run plugin:** Plugins → Development → DS Context Intelligence
4. **Click "Scan Selection"** (or Scan Page/File)
5. **View results!**

---

## 🧪 Testing

### Option A: Use Existing File
- Open any Figma file with components
- Select 2-3 components
- Run scan

### Option B: Create Test Components

Create these in Figma to test all checks:

**Good Component ✅**
```
Name: Button/Primary
Description: Primary action button. Use for main CTAs.

Usage: 
- Hero sections
- Form submissions
- Primary actions

Accessibility:
- role="button"
- Keyboard: Enter/Space

Properties:
- Size: Small | Medium | Large
- State: Default | Hover | Disabled

Documentation: https://storybook.example.com/button
```

**Bad Component ❌**
```
Name: Component 123
Description: [empty]
Properties: prop1, prop2
```

**Run scan on both** → See the difference in scores!

---

## 🎯 What to Expect

### Good Component Score
```
Score: 85-95 (Grade A/B)

Identity:        90
Documentation:   95
Properties:      85
Context:         80

✅ Clear naming
✅ Detailed description
✅ Usage examples
✅ A11y notes
✅ Doc link
```

### Bad Component Score
```
Score: 40-60 (Grade D/F)

Identity:        50
Documentation:   30
Properties:      60
Context:         45

❌ Generic name
❌ No description
⚠️ Generic property names
⚠️ No usage examples
⚠️ No doc link
```

---

## 🐛 Troubleshooting

### Build fails
```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Plugin doesn't appear
- Make sure you selected **manifest.json** (not package.json)
- Check Figma Desktop is the **Desktop App**, not browser
- Restart Figma Desktop

### "No handler for message type"
- This means UI/Plugin are out of sync
- Rebuild: `npm run build`
- Reload plugin in Figma

### Scan shows 0 results
- Make sure you have **Components** (not just Frames)
- Convert Frame to Component: Right-click → Create Component
- Or use "Scan Entire File" to include all pages

---

## 📊 Sample Results

### What You'll See

**After first scan:**
```
DS Context Score: 72
Grade: C

Category Scores:
- Identity:        80
- Documentation:   55
- Properties:      75
- Context:         60

Metadata:
- File: Design System v2.0
- Components: 12
- Issues: 3 errors, 8 warnings
- Duration: 1.2s
```

---

## 🔄 Development Workflow

### Making Changes

1. **Edit TypeScript files**
2. **Build:** `npm run build`
3. **In Figma:** Plugins → Development → Reload Plugin
4. **Test changes**

### Watch Mode
```bash
# Auto-rebuild on changes
npm run watch

# In another terminal
# Just reload plugin in Figma after changes
```

---

## 📝 Next Steps

Once you have it running:

1. **Test with real files** - See actual scores
2. **Review findings** - Understand what affects scores
3. **Compare components** - Good vs bad examples
4. **Share with team** - Get feedback

---

## 🎓 Workshop Prep

To use in workshops:

1. **Prepare sample files:**
   - One "good" file (high scores)
   - One "needs work" file (low scores)

2. **Create handout:**
   - Scoring explanation
   - Quality checklist
   - Best practices

3. **Plan timeline:**
   - 30min demo
   - 2h hands-on
   - 1h review

---

## 💬 Common Questions

**Q: Does it modify my file?**
A: No! 100% read-only. It only analyzes.

**Q: Does it need internet?**
A: No! Works completely offline.

**Q: Can I customize the scoring?**
A: Not yet, but it's planned! Check SCORING_WEIGHTS in types.ts.

**Q: What about private data?**
A: Nothing leaves your machine. No analytics, no tracking.

**Q: Does it work with Figma web?**
A: No, Desktop App only (plugin API requirement).

---

## ✅ Success Checklist

Before first use:
- [ ] Node.js installed
- [ ] npm install completed
- [ ] npm run build succeeded
- [ ] Plugin imported to Figma Desktop
- [ ] Test file ready (or components created)

Ready to scan:
- [ ] Figma file open
- [ ] Components exist
- [ ] Plugin launched
- [ ] Scan mode selected

---

**You're all set! 🚀**

Run your first scan and see your DS Context Score!
