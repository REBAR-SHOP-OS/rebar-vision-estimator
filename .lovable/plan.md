

# Fix: Scope Detection and Estimation Gate

## Root Cause

The detection pipeline works correctly (edge function logs confirm "residential" classification with high confidence). However, estimation is blocked by two compounding issues:

### Problem 1: `resolve-scope` gate is too strict
In `handleModeSelect` (ChatArea.tsx line 1033-1041), `resolve-scope` is called to verify scope exists in the database. This function requires BOTH:
- `projects.scope_items` to be populated
- `drawing_search_index` to have entries

But `scope_items` is saved via a **non-awaited** fire-and-forget call when the user clicks "Proceed" on the scope panel (line 2006). And `drawing_search_index` is populated asynchronously in the background. So `resolve-scope` often returns `source_type: "none"` even when scope was just defined.

### Problem 2: The scope panel save is fire-and-forget
```typescript
// Line 2006 — NOT awaited
supabase.from("projects").update({
  scope_items: scope.scopeItems,
  ...
}).eq("id", projectId);
```
The user clicks "Proceed", then immediately sees the mode picker and clicks "Smart Calculation". By then, the DB write may not have completed.

## Solution

### 1. Remove the `resolve-scope` gate from `handleModeSelect` (ChatArea.tsx)
The client already has `scopeData` in state (set by the scope panel's onProceed). The line 1027-1031 check (`scopeData.scopeItems.length === 0`) is sufficient. The redundant `resolve-scope` call (lines 1033-1044) should be removed — it adds latency and creates a race condition.

### 2. Await the scope save before showing mode picker (ChatArea.tsx)
Change the `onProceed` handler to await the database update before calling `setShowModePicker(true)`, so scope_items are persisted before any downstream check.

### 3. Pass `scopeSourceType` to ScopeDefinitionPanel
Currently the prop is accepted but never provided. Pass it based on detection result to suppress the false "No scope" warning. When detection succeeds, `scopeSourceType` should be `"detected"` not `"none"`.

### Files Changed
- `src/components/chat/ChatArea.tsx` — 3 targeted edits (remove resolve-scope gate, await scope save, pass scopeSourceType prop)

