

## Plan: Fix Scope Restriction in Analysis Prompt

### Problem
Even though the UI now selects all element types by default, the edge function prompt at line 1163 says **"Only analyze these element types: ... Ignore any elements NOT in this list."** — this hard restriction in the AI prompt is what causes the output to say "strictly limited to CAGE, RETAINING_WALL, and FOOTING." The prompt language forces the AI to ignore everything else.

When all 14 scope items are selected, the instruction should guide the AI to look for everything, not restrict it.

### Fix (single file: `supabase/functions/analyze-blueprint/index.ts`)

**Change the scope injection logic (lines 1161-1165):**

- If ALL scope items are selected (or the list is large, e.g. >= 10), change the wording to: "Analyze all structural element types found in the drawings, including but not limited to: ..."
- Only use restrictive "Only analyze these" / "Ignore any elements NOT in this list" language when the user has explicitly narrowed the scope (small subset selected)
- Always add: "Treat Cage Assemblies and Loose Rebar as separate estimation groups with independent outputs."

```typescript
if (scope.scopeItems && scope.scopeItems.length > 0) {
  const allSelected = scope.scopeItems.length >= TOTAL_SCOPE_COUNT; // 14
  if (allSelected) {
    scopeBlock += `Analyze ALL structural element types found in the drawings.\n`;
    scopeBlock += `This includes (but is not limited to): ${scope.scopeItems.join(", ")}\n`;
  } else {
    scopeBlock += `Focus on these element types: ${scope.scopeItems.join(", ")}\n`;
    scopeBlock += `Prioritize these elements but also flag any other significant elements discovered.\n`;
  }
}
```

This removes the artificial "Ignore any elements NOT in this list" restriction and lets the AI find everything in the blueprints. The separate cage vs loose rebar grouping is already handled by the category-specific rules injected via `getCategorySpecificRules`.

