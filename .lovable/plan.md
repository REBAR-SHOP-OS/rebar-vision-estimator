## Why the selected F footings aren't recognized

Looking at your screenshot, the orange-boxed marks on the foundation plan look like `F2.0`, `F-2.0`, `F1.5`, etc. — footing tags that include a **decimal size suffix**. The current detection misses them for three concrete reasons:

1. **Regex is too strict.** `src/lib/ocr-page-labels.ts` accepts only `^F[-.\s]?\d+[A-Z]?$` and `markBucket` uses `^F[-.]?\d`. Tokens like `F2.0`, `F-2.0`, `FTG-1`, `PAD-2` are rejected, so even when Vision reads them correctly they never become hits.
2. **Whole‑block matching loses tokens.** Vision often returns a block as `"F2.0\n2'-0\""`. We split on whitespace/punctuation, but `F2.0` then fails the strict regex above, so the whole block is dropped.
3. **No visibility when zero hits.** When `hitsByLayer` is empty for "Footings" the UI just says "No structural marks detected." You can't see what OCR actually read, so you can't tell whether it's a regex problem or an OCR miss.

Separately, "Footings" → `inferSegmentType` → `"footing"` → `markBucket("F-1") === "footing"` already lines up correctly, so the layer wiring is fine. The failure is purely at the token-recognition step.

## Plan — 1 file, low risk

**Single file:** `src/lib/ocr-page-labels.ts` (no UI, no DB, no edge function changes).

1. **Broaden `DEFAULT_MARK_PATTERNS`** to include the real-world variants:
   - `F`, `WF`, `P`, `C`, `B`, `S`, `GB`, `PC` followed by optional `-`/`.`/space, digits, optional `.digits` (decimal size), optional letter suffix. Example: `^F[-.\s]?\d+(\.\d+)?[A-Z]?$`.
   - Add `FTG[-.\s]?\d+` and `PAD[-.\s]?\d+` as additional footing aliases.

2. **Mirror the same loosening in `markBucket`** so `F2.0`, `FTG-1`, `PAD-2` all bucket to `"footing"`, and `WF1.5` to `"wall"`.

3. **Token normalization tweak:** keep the decimal point during normalization (don't strip `.`), and bump the length window from `2..8` to `2..10` so `F-2.0A` survives.

4. **Diagnostic fallback (still same file):** when zero hits matched but blocks were returned, attach the raw token list to the result as `unmatchedTokens` (already returned via `OcrPageResult` extension — purely additive field). The canvas can log it in dev to see why.

### Out of scope
- `TakeoffCanvas.tsx`, `region-segmentation.ts`, `ocr-image` edge function, `ScopeStage`, DB tables, RLS — all untouched.
- No new dependencies. `bunx tsc --noEmit` must remain clean.

### Acceptance
- Pick "Footings" candidate on the foundation plan in your screenshot → OCR runs → every `F-#`, `F#.#`, `FTG-#`, `PAD-#` mark is highlighted in footing color and pulses; auto-frame zooms to their union bbox.
- Existing `WF-1`/`F-1`/`S-1` behavior unchanged.
- If OCR genuinely can't read a tag (too small / rotated), the toast still says "No structural marks detected" but `unmatchedTokens` is available for follow-up debugging.
