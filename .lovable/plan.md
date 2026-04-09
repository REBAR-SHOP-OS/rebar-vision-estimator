

# Fix: Use Real Shop Drawing Data to Fine-Tune Estimation

## Problem Summary
The current project has 3 generic segments ("Foundation Plan", "Parking Structure Concrete", "Suspended Slabs/Beams") with 19 fabricated bar_items (marks like A1, B1, C1) that don't match the real shop drawings at all.

The real SD06-SD12 drawings contain:
- **SD06**: Foundation Plan — SOG mesh (152X152XMW18.7/18.7, 510 sheets), plus 10M corner/continuous bars (B1001, BS31, BS38, BS48)
- **SD07**: Isolated Footings F1-F8 schedule (F1=1000x1000, F2=1500x1500 ×8, F3=1600x1600 ×4, F4=1700x1700 ×4, F5=1800x1800 ×4, F6=2000x2000 ×2, F7=2100x2100 ×1, F8=2200x2200 ×4), plus 10M/15M tie wire bars
- **SD08**: W1 Wall Elevation — 10M verticals, 15M/20M continuous, dowels, ties, pier D/V bars
- **SD09**: W1/W2 Wall Elevations continued — pier dowels, corner bars, slab dowels
- **SD10**: W3/W4 Wall Elevations — wall bars, 20M continuous, 10M verticals
- **SD11**: Pier/Grade Beam details — 15M ties, 20M mains, 10M stirrups
- **SD12**: W5/W6 Wall Elevations — wall rebar

## Plan

### 1. Fine-tune `auto-segments` prompt to recognize real drawing elements

**File: `supabase/functions/auto-segments/index.ts`**

Update the AI prompt (lines 121-157) to include:
- Explicit instruction to parse bar list tables for bar marks and extract element references (F-1 through F-8, W1-W8, P1-P8, SOG, etc.)
- Add reference to RSIC standards already stored in `agent_knowledge` — query the knowledge table and include key rules in the prompt context
- Increase `max_tokens` from 3000 to 4000 to allow more detailed segment descriptions
- Add instruction: "If bar lists are found, extract ACTUAL element names from bar marks (e.g., B1001 = SOG slab bar, BS03 = Footing F-1 bar, B2001 = Wall corner bar). Map bar marks to structural elements."

### 2. Fine-tune `auto-estimate` prompt with RSIC weight standards

**File: `supabase/functions/auto-estimate/index.ts`**

Update the prompt (lines 106-141) to:
- Fetch `agent_knowledge` entries for RSIC standards and include mass table + estimating rules in system prompt
- Add instruction to parse the drawing_search_index text directly (not just pdf_metadata which may be empty for large files)
- Query `drawing_search_index` for the specific segment's drawing pages and pass that text to the AI
- Add explicit rule: "Parse bar list tables from the drawing text. Each row typically has: Bar Mark, Qty, Size, Total Length, Type, and shape dimensions. Use these EXACT values."

### 3. Fine-tune `auto-bar-schedule` prompt to use real bar marks

**File: `supabase/functions/auto-bar-schedule/index.ts`**

Update the prompt (lines 67-94) to:
- Also fetch `drawing_search_index` text for the segment's related pages
- Add instruction: "Use the ACTUAL bar marks from the drawings (e.g., BS03, B1001, B2001) instead of generic sequential marks (A1, A2, B1)."
- Include bar shape dimension columns from the drawing text so cut_length and shape_code are accurate

### 4. Delete incorrect data and re-run

**Database migration**: Delete the 3 wrong segments and their 19 fabricated bar_items for project `2fbf1ab0-a319-4f66-bbca-2571b0573ee6` so the user can re-run auto-segments with the improved prompts.

## Technical Details

All three edge functions currently only read drawing text from `document_versions.pdf_metadata`, which is empty for large PDFs. The fix adds a fallback to query `drawing_search_index` (which was populated by the OCR pipeline we built earlier) and passes that text to the AI prompts.

The RSIC standards data is already stored in `agent_knowledge` — we just need to query it and inject it into the prompts.

## Files Modified
- `supabase/functions/auto-segments/index.ts` — enhanced prompt with bar list parsing instructions + knowledge query
- `supabase/functions/auto-estimate/index.ts` — add drawing_search_index query + RSIC standards injection
- `supabase/functions/auto-bar-schedule/index.ts` — add drawing_search_index context + real bar mark instructions
- Database migration to clean wrong segments/bar_items for this project

