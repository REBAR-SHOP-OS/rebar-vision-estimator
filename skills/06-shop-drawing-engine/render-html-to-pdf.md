# Render HTML → PDF

The shop-drawing engine emits a single HTML string per export, then prints to
PDF at the chosen real sheet size from `sheet-sizes.ts`. Use Puppeteer/Chromium
inside an edge function or a server worker.

## CSS contract for every template

```css
@page { size: 1728pt 1296pt; margin: 0; } /* match SHEET_SIZES_PT[size] */
html, body { margin: 0; padding: 0; }
.sheet { width: 1728pt; height: 1296pt; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
```

## Rules

- One sheet per `<section class="sheet">`. Never shrink content to fit — split
  to a new sheet instead.
- Reserve zones: header (~1.1"), drawable, right metadata rail (~2.9"), footer (~1.8").
- AI Candidate template: dashed amber border, watermarks, no formal revision fields.
- Issued template: title block with discipline, scale, drawn/checked/approved, issue date.
- Validate metadata via `validate-metadata.ts` BEFORE rendering. Hard-fail on errors.