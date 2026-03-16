

# Improve Scope Detection for Multi-Discipline Drawings

## Problem

Three issues prevent accurate scope detection when both structural and architectural drawings are uploaded:

1. **Only 2 images scanned** — `detect-project-type` slices `fileUrls` to first 2 (`fileUrls.slice(0, 2)`). If a user uploads a structural PDF (3 pages rendered) and an architectural PDF (3 pages rendered), detection only sees pages 1-2 of the structural set. The architectural drawings are never analyzed.

2. **No discipline identification in the prompt** — The detection prompt asks the AI to classify into categories but never instructs it to identify which discipline each page belongs to (S, A, C, L, M, E, P). Without this, the AI can't report "I found architectural elements on sheet A3.1" vs "structural elements on S2.1."

3. **No multi-discipline conflict resolution** — When architectural drawings show CMU walls and structural drawings show footings, the prompt has no instruction to merge findings across disciplines or flag conflicts (e.g., architectural wall location vs structural detail for that wall).

## Plan

### 1. Increase scan coverage (`detect-project-type/index.ts`)

- Change `fileUrls.slice(0, 2)` → `fileUrls.slice(0, 6)` to scan up to 6 page images (covers ~2 PDFs × 3 pages each)
- OCR all 6 images instead of just 2
- This ensures both structural and architectural PDFs get analyzed

### 2. Add discipline detection to the prompt (`detect-project-type/index.ts`)

Add a new `disciplinesFound` output field to the tool schema and update the prompt to instruct the AI to:
- Identify each page's discipline from title block (S = Structural, A = Architectural, C = Civil, etc.)
- Report which disciplines were found and which scope items came from each
- Flag when scope elements are found on non-structural drawings (e.g., depressed s