

## Complete the Estimation Group Filter UI and Regression Tests

### Already Implemented (no changes needed)
- detect-project-type: V2 output with primaryCategory, features, evidence, server-side veto
- analyze-blueprint: getCategorySpecificRules with cage/bar_list pipelines, estimation_group in schema, anti-double-counting
- ScopeDefinitionPanel: smart locking, cage toggle, feature badges, "Reset to all"
- ChatArea: estimationGroupFilter state (line 77), category-specific initial messages (lines 508-517), scope data passed to edge function (line 222)

### Gap 1: Estimation Group Filter Chips + Filtered Tabs

File: `src/components/chat/ChatArea.tsx` (lines 977-1043)

Replace the current Tabs block with a version that:

1. Computes hasLoose / hasCage / hasBothGroups from validationData.elements using estimation_group field
2. Filters elements and bar list data by the active estimationGroupFilter before passing to children
3. Recomputes summary counts from filtered elements
4. Renders 3 filter chip buttons ("All" / "Loose Rebar" / "Cage Assembly") above tabs when hasBothGroups is true
5. Hides Cards tab when primaryCategory is cage_only or bar_list_only, or when no loose elements survive the filter
6. Shows Bar List and Bending tabs only when filtered bar list has items

No changes needed to ValidationResults, BarListTable, or BendingScheduleTable -- filtering happens upstream before data is passed as props.

### Gap 2: Detection Regression Tests

File: `src/test/detection-regression.test.ts` (new file)

Create vitest test cases that validate the veto logic:

- Test A: OCR text containing building signals ("FOUNDATION PLAN", "SOG", "BASEMENT WALL") plus cage signals ("CAISSON DETAIL") -- assert primaryCategory is NOT cage_only and features.hasCageAssembly is true
- Test B: OCR text with only cage signals ("PIER SCHEDULE", "CAGE SCHEDULE"), no building signals -- assert primaryCategory is cage_only
- Test C: OCR text with bar list signals ("BAR LIST", "BAR SCHEDULE") only -- assert primaryCategory is bar_list_only
- Fail condition: primaryCategory === "cage_only" while buildingSignals array is non-empty

Tests call the deployed detect-project-type edge function with constructed payloads.

### Technical Summary

| File | Change | Lines |
|---|---|---|
| src/components/chat/ChatArea.tsx | Replace Tabs block with group-filtered version + filter chips | 977-1043 |
| src/test/detection-regression.test.ts | New regression test file | new |

