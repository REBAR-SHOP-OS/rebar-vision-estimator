

# Fine-tune Shop Drawing Frame + Refresh Logo

Two minimal patches: replace the brand logo asset with the uploaded REBAR.SHOP coin image so it appears everywhere it's already wired (PDF exports, shop drawings, quote PDFs, sidebar), and tighten the shop-drawing **sheet frame + title block** so the printed sheet looks like a proper CAD plot.

## Part 1 — Logo refresh (zero code change)

- Copy `user-uploads://ChatGPT-Image-Nov-7-2025-03_09_08-PM-220x71.png.bv.webp` → `src/assets/logo.png` (overwrite).
- All 18 files already import via `@/assets/logo.png` or `getLogoDataUri()` — no code edits needed.
- The base64 cache in `logo-base64.ts` rebuilds on next page load.

Affected automatically: shop drawing title block, quote PDF header, Excel exports, sidebar, auth page, AI Visual Draft watermark.

## Part 2 — Shop drawing frame fine-tune

Single file: **`supabase/functions/generate-shop-drawing/shop-drawing-template.ts`** (CSS + 1 small HTML block, ~25 lines touched).

### Frame upgrades (title block + sheet border)

1. **Outer sheet border** — change `.sheet-frame` from a single 2px line to a proper CAD-style **double border** (2px outer + 0.5px inner with 4px gutter). Adds professional "drawing sheet" feel.

2. **Title block layout** — current block stacks logo over a 2-column table. Refine to a 3-zone layout matching ANSI/ISO title blocks:
   - **Top zone**: larger logo (48px) left, company name + tagline right, separated by a 1px rule.
   - **Middle zone**: project / customer / address as a clean 2-row table, monospace values.
   - **Bottom zone**: drawing-no, scale, sheet x/y, revision triangle, date — laid out in a 4-cell grid (not the current footer row).

3. **Logo rendering** — the new logo is a wide rectangle (220×71). Switch from circular `border-radius:50%` crop to a clean rectangular embed with `object-fit: contain`, max-height 44px, preserves the gold coin + dark bar without distortion.

4. **Border color + weight consistency** — unify all internal panel borders to `#111` at 1px (some are 2px today, looks uneven on print). Title block keeps 2px to anchor it.

5. **Print margins** — bump `@page` margin from current setting to `0.4in` so the doubled border doesn't touch sheet edge in browser print-to-PDF.

6. **Revision triangle** — replace current text "△ 1" with a proper SVG triangle so it renders crisp at any zoom.

### Out of scope

- AI Visual Draft (`draft-shop-drawing-ai`) prompt — already uses `REBAR.SHOP` placeholder; the generated raster image will reflect the new brand naturally on next render. No prompt change.
- DB / RLS / edge function contracts — untouched.
- All other components, exports, Excel templates — untouched.

## Files changed

| File | Change |
|---|---|
| `src/assets/logo.png` | Overwrite with uploaded REBAR.SHOP image |
| `supabase/functions/generate-shop-drawing/shop-drawing-template.ts` | Title block HTML + frame CSS refinements (~25 lines) |

Net: 1 asset replace + 1 file edit. No DB, no new deps, no behavioral changes.

## Risk

Very low. Logo is a drop-in same-format swap. Template changes are CSS + one HTML block reflow inside an isolated `<iframe srcDoc>` — cannot affect the rest of the app.

