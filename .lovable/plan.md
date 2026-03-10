

## Plan: Auto-detect and alert on special rebar coatings (epoxy, stainless, galvanized, etc.)

### Problem
The AI prompt already asks the model to identify coating types (Stage 2.5) and the truth schema includes a `coating` field, but:
1. **No alert is shown** when the AI detects non-standard coating (epoxy, stainless, galvanized) in the blueprint
2. **ValidationResults and BarListTable** completely ignore the `coating` field — it's never displayed
3. **Price impact** of special coatings is never flagged (epoxy ~15-25% premium, stainless ~5-8x premium)

### Changes

**File 1: `src/components/chat/ValidationResults.tsx`**
- After the summary stats section, scan all elements for non-"black"/"none" coatings
- If found, render a prominent alert banner: `⚠️ Special Rebar Detected: Epoxy-Coated (3 elements), Stainless Steel (1 element)` with a note about pricing impact
- Style with amber/orange background to stand out

**File 2: `src/components/chat/BarListTable.tsx`**
- Add a `coating` column (or badge next to the size column) that shows a colored badge when coating is non-standard:
  - Epoxy → green badge "ECR"
  - Stainless → blue badge "SS"  
  - Galvanized → yellow badge "GALV"
- Add `coating` to the `BarItem` interface

**File 3: `supabase/functions/validate-elements/index.ts`**
- Add a new **coating gate** (G6): check if `truth.coating` is non-"none"/"black" and add a warning (not blocking) so users are always reminded
- Include coating info in the validation `warnings` array: `"Special coating detected: EPOXY — verify pricing applies"`

**File 4: `supabase/functions/analyze-blueprint/index.ts`**
- In the prompt's Stage 2.5 section, add an explicit instruction: `"CRITICAL: If ANY note, legend, or specification mentions epoxy, stainless, galvanized, MMFX, or any coating/material type, you MUST populate the 'coating' field for EVERY affected element. Default is 'none'. This is a pricing-critical field — never omit it."`
- In the JSON template example, ensure `coating` field is prominent

**File 5: `supabase/functions/price-elements/index.ts`**
- Add coating multipliers to pricing: epoxy ×1.20, galvanized ×1.35, stainless ×6.0
- Include coating surcharge as a separate line in the quote output

### Technical Details

Coating detection flows:
```text
OCR text → analyze-blueprint (Stage 2.5 extracts coating per element)
  → truth.coating = "EPOXY" | "STAINLESS" | "GALVANISED" | "none"
    → validate-elements (G6 warning)
      → ValidationResults (alert banner)
      → BarListTable (badge column)
      → price-elements (multiplier applied)
```

