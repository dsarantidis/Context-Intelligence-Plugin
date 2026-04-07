# 🔧 Async API Migration Guide

## 🎯 Problem Identified!

From console logs, your plugin has this error:

```
Error: in get_mainComponent: Cannot call with documentAccess: dynamic-page. 
Use node.getMainComponentAsync instead.
```

**What this means:**
- Your plugin is using **synchronous API** (`node.mainComponent`)
- Figma now requires **async API** (`node.getMainComponentAsync()`)
- This is breaking your plugin execution

---

## 📋 Quick Diagnosis via MCP

I can see your plugin's console logs in real-time! The Figma Console MCP is connected and working. Here's what I found:

### Console Summary (Last 100 logs):
- ✅ Desktop Bridge is running
- ✅ Code execution works
- ⚠️ Permission violations (normal, ignore)
- ❌ **Sync API error**: `mainComponent` needs to be `getMainComponentAsync()`

---

## 🔍 Where This Error Comes From

### Typical Code Pattern (BROKEN):
```typescript
// ❌ OLD WAY - Synchronous (doesn't work anymore)
const instance = node as InstanceNode;
const mainComponent = instance.mainComponent;  // ← THIS FAILS
const componentName = mainComponent.name;
```

### Fixed Code Pattern:
```typescript
// ✅ NEW WAY - Asynchronous (works)
const instance = node as InstanceNode;
const mainComponent = await instance.getMainComponentAsync();  // ← THIS WORKS
const componentName = mainComponent?.name;
```

---

## 🛠️ How to Fix

### Step 1: Find All Sync API Calls

Search your code for these patterns:

```bash
# Search for sync mainComponent access
grep -r "\.mainComponent" src/

# Search for other sync APIs that might fail
grep -r "\.variantProperties" src/
grep -r "\.componentProperties" src/
```

### Step 2: Replace with Async Versions

| Sync API (❌ OLD) | Async API (✅ NEW) |
|-------------------|-------------------|
| `node.mainComponent` | `await node.getMainComponentAsync()` |
| `node.variantProperties` | `await node.getVariantPropertiesAsync()` |
| `node.componentProperties` | `await node.getComponentPropertiesAsync()` |
| `node.children` (in some contexts) | `await node.loadAsync()` then `node.children` |

### Step 3: Make Functions Async

If you're accessing these properties, the containing function must be `async`:

**Before:**
```typescript
function analyzeComponent(node: SceneNode) {
  if (node.type === 'INSTANCE') {
    const mainComp = node.mainComponent;  // ❌ Sync call
    // ...
  }
}
```

**After:**
```typescript
async function analyzeComponent(node: SceneNode) {  // ← Added async
  if (node.type === 'INSTANCE') {
    const mainComp = await node.getMainComponentAsync();  // ✅ Async call
    // ...
  }
}
```

---

## 📝 Common Patterns to Fix

### Pattern 1: Component Analysis

**Before (Broken):**
```typescript
function getComponentInfo(instance: InstanceNode) {
  const comp = instance.mainComponent;
  return {
    name: comp.name,
    key: comp.key
  };
}
```

**After (Fixed):**
```typescript
async function getComponentInfo(instance: InstanceNode) {
  const comp = await instance.getMainComponentAsync();
  if (!comp) return null;
  
  return {
    name: comp.name,
    key: comp.key
  };
}
```

### Pattern 2: Recursive Tree Traversal

**Before (Broken):**
```typescript
function traverseNode(node: SceneNode) {
  if (node.type === 'INSTANCE') {
    const comp = node.mainComponent;  // ❌
    console.log(comp.name);
  }
  
  if ('children' in node) {
    node.children.forEach(child => traverseNode(child));
  }
}
```

**After (Fixed):**
```typescript
async function traverseNode(node: SceneNode) {
  if (node.type === 'INSTANCE') {
    const comp = await node.getMainComponentAsync();  // ✅
    if (comp) {
      console.log(comp.name);
    }
  }
  
  if ('children' in node) {
    // Need to handle async properly
    for (const child of node.children) {
      await traverseNode(child);  // ✅ Await each child
    }
  }
}
```

### Pattern 3: Variant Property Access

**Before (Broken):**
```typescript
function getVariantState(instance: InstanceNode) {
  const variants = instance.variantProperties;  // ❌
  return variants?.State || 'Default';
}
```

**After (Fixed):**
```typescript
async function getVariantState(instance: InstanceNode) {
  const variants = await instance.getVariantPropertiesAsync();  // ✅
  return variants?.State || 'Default';
}
```

---

## 🎯 Specific Fix for Your Plugin

Based on the error message, you likely have code like this in `component-analyzer.ts` or similar:

### File: `component-analyzer.ts` (or wherever you analyze components)

**Find this pattern:**
```typescript
if (node.type === 'INSTANCE') {
  const mainComponent = (node as InstanceNode).mainComponent;
  // ... rest of analysis
}
```

**Replace with:**
```typescript
if (node.type === 'INSTANCE') {
  const mainComponent = await (node as InstanceNode).getMainComponentAsync();
  if (!mainComponent) {
    // Handle case where component is missing
    return null;
  }
  // ... rest of analysis
}
```

**And make sure the function is async:**
```typescript
// Change function signature
async function analyzeComponent(node: SceneNode): Promise<ComponentAudit> {
  // ... your code with await
}
```

---

## ⚡ Quick Fix Checklist

- [ ] Search for `.mainComponent` in your code
- [ ] Replace with `await .getMainComponentAsync()`
- [ ] Add `async` to containing functions
- [ ] Add `await` when calling these functions
- [ ] Handle `null` results (component might be missing)
- [ ] Change function return types to `Promise<T>`
- [ ] Update all callers to use `await`

---

## 🧪 Test After Fix

1. **Rebuild:**
```bash
npm run rebuild
```

2. **Re-import to Figma**

3. **Watch console via MCP:**
```typescript
// I can monitor your console in real-time!
// Just tell me to check logs after you rebuild
```

4. **Verify no more errors:**
```
✅ Should see: Plugin runs without errors
❌ Should NOT see: "Cannot call with documentAccess: dynamic-page"
```

---

## 📚 Complete Example

Here's a complete before/after for a typical component analyzer:

### Before (Broken):
```typescript
export class ComponentAnalyzer {
  analyzeComponent(node: SceneNode): ComponentAudit {
    if (node.type === 'INSTANCE') {
      const instance = node as InstanceNode;
      const mainComp = instance.mainComponent;  // ❌ SYNC
      const variants = instance.variantProperties;  // ❌ SYNC
      
      return {
        name: mainComp.name,
        variants: variants,
        score: 100
      };
    }
    
    return { name: node.name, score: 0 };
  }
}
```

### After (Fixed):
```typescript
export class ComponentAnalyzer {
  async analyzeComponent(node: SceneNode): Promise<ComponentAudit> {  // ← async + Promise
    if (node.type === 'INSTANCE') {
      const instance = node as InstanceNode;
      const mainComp = await instance.getMainComponentAsync();  // ✅ ASYNC
      const variants = await instance.getVariantPropertiesAsync();  // ✅ ASYNC
      
      if (!mainComp) {
        return { name: node.name, score: 0, error: 'Component missing' };
      }
      
      return {
        name: mainComp.name,
        variants: variants || {},
        score: 100
      };
    }
    
    return { name: node.name, score: 0 };
  }
}

// Usage also changes:
// Before: const audit = analyzer.analyzeComponent(node);
// After:  const audit = await analyzer.analyzeComponent(node);
```

---

## 🔄 Cascade Effect

When you make a function async, **all its callers must also handle async**:

```typescript
// Level 1: Make this async
async function analyzeComponent(node: SceneNode): Promise<ComponentAudit> {
  const comp = await node.getMainComponentAsync();  // ✅
  return { name: comp?.name || 'Unknown' };
}

// Level 2: This must await Level 1
async function analyzeSelection(): Promise<ComponentAudit[]> {
  const audits: ComponentAudit[] = [];
  
  for (const node of figma.currentPage.selection) {
    const audit = await analyzeComponent(node);  // ✅ Must await
    audits.push(audit);
  }
  
  return audits;
}

// Level 3: Top-level must await Level 2
figma.ui.onmessage = async (msg) => {  // ✅ Make handler async
  if (msg.type === 'analyze') {
    const results = await analyzeSelection();  // ✅ Must await
    figma.ui.postMessage({ type: 'results', data: results });
  }
};
```

---

## 🎓 Understanding Document Access

The error mentions `documentAccess: dynamic-page`. This is Figma's security model:

**Why this error happens:**
- Figma restricts synchronous access to cross-page data (performance)
- Components can be in different pages
- Accessing them synchronously would block the UI
- Async API allows Figma to load data without blocking

**When you need async:**
- Accessing main component of an instance
- Getting component properties
- Getting variant properties
- Any cross-page reference

**When sync is OK:**
- Accessing properties of current node
- Reading node type, name, id
- Accessing children in same page

---

## 💡 Pro Tips

### Tip 1: Use Optional Chaining
```typescript
const comp = await instance.getMainComponentAsync();
const name = comp?.name ?? 'Unknown';  // ← Safe
```

### Tip 2: Batch Async Calls
```typescript
// ❌ Slow - Sequential
for (const node of nodes) {
  const comp = await node.getMainComponentAsync();
}

// ✅ Fast - Parallel
const comps = await Promise.all(
  nodes.map(node => node.getMainComponentAsync())
);
```

### Tip 3: Handle Null Gracefully
```typescript
const comp = await instance.getMainComponentAsync();
if (!comp) {
  console.warn('Component detached or deleted');
  return null;
}
// Safe to use comp here
```

---

## 🚨 Emergency Quick Fix

If you need the plugin working ASAP, you can temporarily skip instances:

```typescript
async function analyzeNode(node: SceneNode) {
  // Skip instances until we fix async
  if (node.type === 'INSTANCE') {
    console.log('Skipping instance (async fix needed)');
    return null;
  }
  
  // Analyze other node types
  return analyzeRegularNode(node);
}
```

But this is a **temporary workaround** - you should fix the async properly.

---

## ✅ Verification

After fixing, your console should show:
```
✅ Plugin started
✅ Analysis complete
✅ No errors
```

Instead of:
```
❌ Error: Cannot call with documentAccess: dynamic-page
```

---

**Next Steps:**
1. Find all `.mainComponent` usages
2. Replace with `await .getMainComponentAsync()`
3. Make containing functions `async`
4. Rebuild: `npm run rebuild`
5. Re-import plugin
6. I can check console logs via MCP to verify fix!

Want me to check specific files for async issues? I can use the MCP to help debug! 🚀
