

## Plan: Make Scope Include All Elements by Default

### Problem
When "Smart Calculation" auto-proceeds (high confidence), `buildScopeFromDetection()` uses the AI's `recommendedScope` array, which only contains the few elements the AI detected (e.g., CAGE, RETAINING_WALL, FOOTING). This causes the analysis to ignore other element types that may exist in the blueprints.

The same issue exists in the interactive `ScopeDefinitionPanel` — when `recommendedScope` arrives, it replaces the default "all selected" state with only the detected subset.

### Root Cause
- `buildScopeFromDetection()` (line 116-117): For non-cage, non-residential projects, it uses `recommendedScope` instead of all items.
- `ScopeDefinitionPanel` useEffect (line 170-172): Same logic — sets selected items to only `recommendedScope`.

### Fix (single file: `src/components/chat/ScopeDefinitionPanel.tsx`)

**1. `buildScopeFromDetection()`** — For general building categories (commercial, industrial, infrastructure), always return ALL scope items. Only restrict for `cage_only` and `bar_list_only`.

```typescript
// Change lines 114-119 from:
} else if (n.primaryCategory === "residential") {
  scopeItems = [...RESIDENTIAL_SCOPE];
} else if (n.recommendedScope?.length) {
  scopeItems = [...n.recommendedScope];
} else {
  scopeItems = SCOPE_ITEMS.map((s) => s.id);
}

// To:
} else {
  // Always include all elements — the AI will extract what it finds
  scopeItems = SCOPE_ITEMS.map((s) => s.id);
}
```

**2. `useEffect` in ScopeDefinitionPanel** — Remove the `recommendedScope` branch so the panel keeps all items selected by default for non-special categories.

```typescript
// Change lines 167-173: remove the recommendedScope branch
} else if (normalized.primaryCategory === "residential") {
  setSelectedItems(RESIDENTIAL_SCOPE);
  setScopeLocked(false);
}
// Remove the else-if for recommendedScope
```

This ensures the AI always receives the full scope and can find all element types present in the blueprints, rather than being artificially limited to only the ones detected during the quick classification pass.

