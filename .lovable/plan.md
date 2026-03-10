

## Plan: Scope-by-Scope Iterative Processing for Both Modes

### Problem
Both Smart and Step-by-Step modes send all scope items in a single AI call, producing massive responses that timeout or miss elements.

### Approach
For both modes, loop through scope categories sequentially — one AI call per category. Each call focuses on a small set of element types. After all categories complete, merge results via `handlePostStream`. Special project types (cage_only, bar_list_only) keep single-call behavior since they're already focused.

### Changes

#### 1. `src/components/chat/ScopeDefinitionPanel.tsx`
- Export `SCOPE_ITEMS` (change `const` → `export const`, line 11)

#### 2. `src/components/chat/ChatArea.tsx` — Restructure `handleModeSelect`
Import `SCOPE_ITEMS` from `ScopeDefinitionPanel`. Replace the single `streamAIResponse` call (lines 922-939) with:

- **Special categories** (cage_only, bar_list_only): Keep single-call behavior as-is
- **General categories** (residential, commercial, industrial, infrastructure, etc.):
  - Group `scopeData.scopeItems` by category using `SCOPE_ITEMS` → produces groups like `{Foundation: ["FOOTING","GRADE_BEAM",...], Structural: ["BEAM","COLUMN",...], ...}`
  - Filter to only non-empty groups that have items the user selected
  - Loop sequentially through each group:
    1. Add system message: `"📋 Analyzing: {Category} ({n}/{total})"`
    2. Build focused instruction: `"Analyze ONLY these element types: {list}. Ignore all other elements for this pass."`
    3. Clone `scopeDataRef.current` with only this category's items in `scopeItems` + add `focusCategory: categoryName`
    4. Call `streamAIResponse` with this focused scope
    5. Accumulate the full content from each pass
    6. Update `subStep` to show category name
  - After all passes, concatenate accumulated content and run `handlePostStream` once with `expectStructuredOutput: false`

#### 3. `supabase/functions/analyze-blueprint/index.ts` — Focused scope prompt
In the scope injection block (lines 1032-1068), when `scope.focusCategory` is present:
- Replace the generic scope instructions with: `"FOCUS SCOPE: Analyze ONLY the following element types: {items}. Ignore ALL other element types for this pass. Output only elements matching these types."`
- Skip the "Analyze ALL" / full-scope logic when focusing

### Flow
```text
User selects Smart or Step-by-Step
  │
  ├─ [cage_only / bar_list_only] → single call (unchanged)
  │
  ├─ [general project] → category loop:
  │   ├─ Foundation → AI call → accumulate
  │   ├─ Structural → AI call → accumulate
  │   ├─ Walls → AI call → accumulate
  │   ├─ Other → AI call → accumulate
  │   ├─ Assemblies → AI call → accumulate
  │   └─ Final: merge all → handlePostStream
```

### Scope
- 3 files modified
- ~80 lines added/changed
- No database changes

