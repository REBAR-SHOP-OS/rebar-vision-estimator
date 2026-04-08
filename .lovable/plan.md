

# Add Download Button + Fine-Tune Shop Drawing Template

## Problem
1. **No download**: Shop drawings open as a blob URL in a new tab. Users cannot easily save/download the HTML file.
2. **Template differences from reference**: The reference PDF (SD01–SD04) has a specific consolidated layout per sheet with the REBAR.SHOP branding, revision history table, drawing number (SD01, SD02…), and a tighter professional title block. The current template is close but needs refinements.

## Changes

### 1. OutputsTab.tsx — Add download button for shop drawings
Instead of only `window.open(url, "_blank")`, trigger a proper file download using an anchor element with `download` attribute:
```
a.href = url; a.download = `shop-drawing-${projectId.slice(0,8)}.html`; a.click();
```
Also open in new tab for preview. This gives users both: a downloadable file and a preview.

### 2. OutputsTab.tsx — Add "Print to PDF" instruction
After opening the HTML, show a toast with instructions: "Use Ctrl+P / Cmd+P to save as PDF".

### 3. shop-drawing-template.ts — Add drawing number to each sheet
Each sheet's title block should show a sequential drawing number like "SD01", "SD02", etc., matching the reference format. Add a `drawingNumber` field to `SheetDefinition` and render it in the title block footer area.

### 4. shop-drawing-template.ts — Add revision history table
The reference PDF has a revision block with rows like:
- △ FOR APPROVAL (date)
- △ AS PER A/E COMMENTS (date)
- △ AS PER NEW DRAWING (date)

Add a static revision history table in the title block area with the current date as "FOR APPROVAL" entry.

### 5. shop-drawing-template.ts — Refine title block to match reference
The reference has a right-side panel with:
- REBAR.SHOP logo + company name + tagline
- Address line
- Part of structure label
- Customer field
- Project number field
- Drawing number (SD01, SD02…)
- "DETAILED BY / CHECKED BY" fields

Update the existing title block section to include these fields, matching the reference layout more closely.

### 6. shop-drawing-template.ts — Add "E.O.R. ALL REBAR ON THIS DWG IS 400/R" note
The reference has a standard note at the bottom of the BBS area. Add this as a configurable note.

## Files Modified
- `src/components/workspace/OutputsTab.tsx` — add download trigger alongside preview
- `src/lib/shop-drawing-template.ts` — add drawing numbers, revision table, refined title block, E.O.R. note

## No new files, no migrations, no edge function changes

