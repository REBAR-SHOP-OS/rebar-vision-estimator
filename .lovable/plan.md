Implement a focused QA viewer fix plus a temporary debug mode so the drawing compare area becomes inspectable and the broken behavior is visible instead of silent.

What I’ll change

1. Fix the PDF page reset bug
- Preserve the issue’s linked `page_number` when a new QA issue is selected.
- Remove the current reset sequence that sets `pdfPage` back to 1 after selection.
- Ensure the preview loader initializes to the locator page instead of always showing the cover/first page.

2. Fix pointer placement so it points to the exact element
- Rework the overlay positioning to anchor against the actual rendered image bounds, not the full container.
- Stop using percentage placement over an `object-contain` image without accounting for letterboxing.
- Use the same pattern as the working drawing overlay viewer: render the image in a measurable wrapper and place the bbox overlay relative to that wrapper.
- Keep the “ask question / fix / impact” callout attached to the bbox.

3. Make Overlay / Side-by-Side / Difference visibly update
- Right now all three modes use the same single image, so Difference is effectively a no-op and Side-by-Side looks fake.
- Add explicit mode behavior:
  - Overlay: current drawing + bbox/callout.
  - Side-by-Side: two labeled panes with visible per-pane styling and pointer shown on the active pane.
  - Difference: visible diff treatment only when a second source exists; otherwise show a clear “compare source missing” notice instead of pretending it works.
- If the data only has one revision source, the UI will say that clearly in debug mode and in the status area.

4. Add a QA debug mode
- Add a small “Debug” toggle in the QA canvas toolbar.
- When enabled, show:
  - container bounds
  - rendered image bounds
  - bbox bounds and normalized coordinates
  - current `viewMode`, `zoom`, `tx`, `ty`
  - requested page vs rendered page
  - current blend/filter settings
  - redraw counters / last redraw trigger
  - source file id, issue id, and whether a compare layer exists
- Draw colored rectangles for:
  - canvas container
  - rendered image area
  - bbox target
- Add a compact debug panel pinned to the canvas so you can verify why a mode did or didn’t redraw.

5. Improve redraw observability
- Track redraw triggers from:
  - issue selection changes
  - page changes
  - PDF render callback
  - image load
  - view mode changes
  - zoom mode changes
- Show a monotonic redraw count and last trigger reason in debug mode.
- This makes it obvious whether the buttons are failing to update state or the renderer is reusing the same visual source.

6. Handle missing locator / compare data safely
- If an issue only has page-level linkage and no bbox, show that clearly in the debug panel and status rail.
- If canonical compare data fails to load, surface that state instead of leaving the compare tools looking broken.

Likely root causes already identified
- `pdfPage` is being set from the issue locator, then immediately reset to 1 by the preview-loading effect. That explains why you keep seeing the first page.
- The bbox overlay is drawn against the full transformed container while the image is rendered with `object-contain`, so the pointer can land in the wrong place or appear disconnected from the actual element.
- Side-by-Side and Difference currently reuse the same source image, so the buttons change state but do not produce a meaningful visual comparison.
- There is also a backend warning in the console for missing `rebar_project_links`, which can prevent canonical compare data from loading. I won’t change backend schema in this patch unless necessary, but I’ll make the UI report that compare data is unavailable instead of silently failing.

Files to update
- `src/features/workflow-v2/stages/QAStage.tsx`
- Possibly `src/components/chat/PdfRenderer.tsx` for render-cycle metadata callbacks if needed
- Possibly `src/features/workflow-v2/takeoff-data.ts` only for safer compare-data/status shaping, with a minimal patch

Validation after implementation
- Select a QA issue with a linked page and confirm the viewer opens on that exact page, not page 1.
- Toggle Overlay / Side-by-Side / Difference and confirm the canvas state and debug panel both update.
- Confirm the pointer box sits on the exact drawing region, not on the page margin or unrelated area.
- Confirm the debug panel shows redraw reasons when switching issues, pages, and modes.
- Confirm the UI clearly reports when compare data is missing, instead of acting like the buttons work.

Technical details
- Keep the patch minimal and isolated to the QA drawing viewer.
- No broad refactor.
- No changes to generated backend client files.
- If compare mode depends on unavailable compare assets, the UI will degrade honestly and expose that in debug mode rather than fabricating a diff.