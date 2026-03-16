

# Fix: Always Show Scope Panel Before Mode Picker

## Problem
When auto-detection has high confidence (>=70%), the scope panel is skipped entirely — `setScopeData(autoScope)` on line 1403 causes the condition `!scopeData` on line 1985 to be false, hiding the scope panel. The user goes directly to the mode picker without ever seeing or confirming the scope.

Per system requirements, the pipeline must **always pause at the Scope Definition Panel** for user review, even at 100% confidence.

## Solution
Change the high-confidence flow to **pre-fill** the scope panel with auto-detected values but still show it for user confirmation, instead of auto-setting `scopeData` and skipping it.

### Changes

**`src/components/chat/ChatArea.tsx`** (2 edits):

1. **Lines 1400-1403**: Instead of calling `setScopeData(autoScope)` (which hides the panel), pass the auto-scope as an `initialScope` prop to `ScopeDefinitionPanel`. Remove the `setScopeData(autoScope)` call and the project update (that will happen when the user clicks Proceed).

2. **Lines 1985-2005**: Pass `initialScope` to `ScopeDefinitionPanel` so it pre-fills the form with auto-detected values. The user can review, edit, and confirm.

Specifically:
- Add state: `const [pendingAutoScope, setPendingAutoScope] = useState<ScopeData | null>(null);`
- In high-confidence block (line 1403): replace `setScopeData(autoScope)` with `setPendingAutoScope(autoScope)` — keep `showScopePanel(true)` active, don't set scopeData yet
- Remove the project update from auto-detection block (lines 1406-1412) since it will happen on Proceed
- Pass `initialScope={pendingAutoScope}` to `ScopeDefinitionPanel`
- In `ScopeDefinitionPanel`, accept and use `initialScope` prop to pre-populate fields

**`src/components/chat/ScopeDefinitionPanel.tsx`**:
- Add `initialScope?: ScopeData` prop
- Use it to initialize internal form state (selected items, project type, client name, deviations)

