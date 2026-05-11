## Problem

Stage 02 (Scope Review) shows "Loading PDF…" indefinitely in the Takeoff Canvas. Network confirms the signed-URL fetch returns the PDF bytes successfully (HTTP 200, valid `%PDF-1.7` body), but `PdfRenderer` never transitions out of its loading state — meaning `pdfjsLib.getDocument({ data: buffer }).promise` is not resolving and no error is being thrown to the UI.

Most likely cause: the pdf.js worker (`pdfjs-dist/build/pdf.worker.min.mjs?url`) is not initialising in this context. There is no fetch for the worker in network logs, and pdfjs v4 silently hangs `getDocument` if the worker module fails to bootstrap. There is also no visible error toast or destructive state because the component swallows non-throwing hangs.

## Fix (minimal patch)

Edit only `src/components/chat/PdfRenderer.tsx`:

1. **Add a load timeout + visible error.** Wrap `getDocument(...).promise` in `Promise.race` with a ~20 s timeout. On timeout, set `error` ("PDF worker did not respond") and call `onError`, so the user no longer sees a frozen "Loading PDF…".
2. **Harden worker init.** Guard the `GlobalWorkerOptions.workerSrc` assignment so it only runs once, and add a fallback to the matching `cdnjs` URL (`pdfjs-dist@${pdfjsLib.version}/pdf.worker.min.mjs`, same pattern already used in `BrainKnowledgeDialog.tsx`) if the bundled `?url` import returns an empty string. This protects against the rare Vite case where the `?url` import resolves to "" before the worker chunk is emitted.
3. **Try `getDocument({ url })` first when we have an https URL,** and only fall back to `{ data: buffer }` on failure. The current code does the opposite — a hung `data:` path leaves the second branch unreached. Switching the order makes the fast path more reliable for signed-URL PDFs and keeps the byte fallback for blobs.
4. **Surface a Retry button** in the error state so the user can recover without reloading the page.

No changes to `TakeoffCanvas.tsx`, `ScopeStage.tsx`, the storage signing flow, or any backend code.

## Out of scope

- Re-architecting PdfRenderer or moving to a different PDF library.
- Changes to `pdf-to-images.ts` (server/worker pipeline) — that path is unrelated.
- The Stage 02 layout/UX (kept exactly as-is).

## Verification

- Reload Stage 02 with the same `CRU-1 Structral (4).pdf`. Expect the page raster to appear within a few seconds and "Loading PDF…" to disappear.
- Force-fail the worker (block the worker URL in devtools) and confirm the new error state + Retry button replaces the indefinite spinner.
- Re-check Stage 04 / QA Stage which also use PdfRenderer to ensure the legacy `file`/`page`/`onRender` props still work.
