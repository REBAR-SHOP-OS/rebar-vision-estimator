

# Auto-Segments: Cross-Reference ALL Uploaded Drawings

## Problem
The `auto-segments` edge function only passes **file names** to the AI. It doesn't read any extracted drawing content. With scope_items, project_type, and description all null, the AI can only guess from file names like "CRU-1 Structral (4).pdf" — producing generic segments that ignore the architectural file entirely.

The user wants the system to read BOTH structural and architectural drawings and cross-reference them to generate accurate, specific segments.

## Root Cause
1. `auto-segments/index.ts` fetches `project_files.file_name` only — no extracted text
2. `drawing_search_index` and `logical_drawings` tables are empty for this project (blueprint analysis hasn't populated them)
3. No `document_versions` data exists either
4. The function has no fallback to read raw text from any source

## Changes

### 1. `supabase/functions/auto-segments/index.ts` — Inject extracted drawing text

Fetch extracted text from `drawing_search_index` for the project. If empty (as currently), fall back to fetching `document_versions.pdf_metadata` pages. Group text snippets by discipline (detected from file name patterns: S-/STR = Structural, A-/ARCH = Architectural).

Pass this grouped text context to the AI prompt so it can:
- Parse actual footing schedules, slab callouts, wall types from structural drawings
- Identify architectural elements (CMU walls, concrete curbs, equipment pads) from architectural drawings
- Cross-reference: flag "Hidden Scope" (structural items found only on architectural sheets) and "Orphan Scope" (architectural concrete lacking structural details)
- Tag each suggested segment's `notes` with which file(s) it was derived from (e.g., "Found on: S-101, A-201")

Updated prompt additions:
```
=== STRUCTURAL DRAWING TEXT ===
[extracted text from structural files]

=== ARCHITECTURAL DRAWING TEXT ===  
[extracted text from architectural files]

Cross-reference rules:
- Check BOTH structural and architectural drawings for concrete elements
- Architectural drawings may show concrete elements (curbs, pads, CMU walls) not on structural sheets
- Structural drawings show rebar details; architectural shows dimensions and locations
- Note which drawing(s) each segment was found on
```

### 2. Handle empty extraction gracefully

If no extracted text is available from either `drawing_search_index` or `document_versions`, the function should still work (current behavior) but add a note: "No drawing text extracted — segments inferred from file names and project type only."

### 3. Increase `max_tokens` to 3000

With more context (drawing text from multiple files), the AI needs more room to respond.

## Files Modified
- `supabase/functions/auto-segments/index.ts` — fetch drawing text from `drawing_search_index` / `document_versions`, group by discipline, inject into prompt

## No new files, no migrations

