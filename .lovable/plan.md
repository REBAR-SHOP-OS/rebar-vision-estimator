## Goal

The Scale Calibration gate currently treats Architectural sheets as "reference only" and only blocks on Structural sheets. The user wants it to **check both** — every Structural and Architectural sheet must have a usable scale before Takeoff unlocks. When both disciplines exist and conflict, Structural still wins (resolver behavior unchanged).

## Single file: `src/features/workflow-v2/stages/CalibrationStage.tsx`

1. **New combined gate cohort**
   - Add `gateRows = [...structural, ...reference.filter(r => r.discipline === "Architectural")]`. (Sheets classified as "Other" remain optional, since they are noise.)
   - If that set is empty (no Structural and no Architectural), fall back to all sheets so Architectural-only or Other-only projects don't deadlock.
   - Replace the current `structuralResolved` / `allConfirmable` derivations to run on `gateRows` instead of `structural`.

2. **Banner + footer copy update**
   - Top `GateBanner`: when confirmed, show `Calibration confirmed (${resolvedCount}/${gateRows.length} sheets across Structural + Architectural). Takeoff can proceed.`
   - Replace the "No Structural sheets detected" empty-state text inside the Structural panel with: "No Structural sheets detected. Architectural sheets will be used for calibration; reclassify any sheet below if needed."
   - Bottom gate panel (lines ~214-219): rewrite the three states:
     - All resolved → "Ready to confirm — every Structural and Architectural sheet has a usable scale."
     - Mixed unresolved → "Resolve every Structural and Architectural sheet (${resolved}/${total} done)."
     - Empty cohort (no Structural, no Architectural) → "No discipline-tagged sheets. Reclassify at least one sheet, or confirm to proceed with the available pages."

3. **Manual reclassify shortcut (kept from prior turn)**
   - Inside the Structural panel empty state, keep a small "Mark all as Structural" button that bulk-applies `disciplineOverride` for every sheet so the user can promote Architectural pages in one click.

4. **No changes to:**
   - `scale-resolver.ts` (Structural-still-wins resolver intact for Takeoff sheet selection).
   - The `reference` panel UI: Architectural sheets stay visible there with the existing override Select; only the gate math changes.
   - Confirm/Reset handlers, persistence, or workflow status broadcast.
   - DB schema, RLS, edge functions.

## Verification

1. Open Stage 03 on the current project (only Architectural sheets):
   - Banner now shows the new info text.
   - "Mark all as Structural" appears.
   - Confirm button enables once each Architectural sheet has a usable scale.
2. Open a project with mixed Structural + Architectural sheets:
   - Gate counts both disciplines (e.g. `0/5 sheets` until each is resolved).
   - Confirm stays disabled while any Structural OR Architectural row is unresolved.
3. Resolver behavior in Takeoff is unchanged: Structural calibration still wins where present.
