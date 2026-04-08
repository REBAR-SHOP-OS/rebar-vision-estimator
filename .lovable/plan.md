

# Wire Draft Shop Drawings Export to Professional Template

## Problem
The "Draft Shop Drawings" export in the Outputs tab generates a basic HTML table when no saved `shop_drawings` record exists. The professional multi-sheet template (`buildShopDrawingHtml` in `src/lib/shop-drawing-template.ts`) — which matches the reference PDF format with plan layouts, bar bending schedules, shape keys, lap schedules, cover details, revision blocks, and REBAR.SHOP title block — is never called.

## What Changes

### OutputsTab.tsx — Replace basic HTML fallback with professional template
In the `handleExport` for `type === "shop_drawing"`, when no saved `shop_drawings` record exists, instead of building basic `<table>` HTML:

1. Fetch `segments` (id, name, segment_type) and `bar_items` for the project
2. Fetch project metadata (name, client_name, address)
3. Map `bar_items` to the `ShopDrawingBar[]` format expected by `buildShopDrawingHtml`
4. Call `buildShopDrawingHtml()` directly (client-side, no edge function call needed)
5. Open the resulting HTML in a new tab (same as current behavior)

### Data mapping (bar_items → ShopDrawingBar)
```
element_id    → segment name
element_type  → segment_type
bar_mark      → mark
size          → size
shape_code    → shape_code
qty           → quantity
length_mm     → cut_length
```

## Technical Details

**File modified**: `src/components/workspace/OutputsTab.tsx`
- Add import: `import { buildShopDrawingHtml } from "@/lib/shop-drawing-template"`
- Replace lines 97-112 (the else block for shop_drawing) with the professional template call
- Fetch project info for projectName/clientName
- No new files, no migrations, no edge function changes

