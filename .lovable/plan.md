

## Audit: Obstacles Found and Improvement Plan

### Issues Discovered

**1. Console Warning: `BrainKnowledgeDialog` ref error**
- `Dialog` is passed a ref but `BrainKnowledgeDialog` is a function component without `forwardRef`. React logs: "Function components cannot be given refs."
- **Fix**: Not critical (cosmetic warning), but clean it up by ensuring the component doesn't receive an unexpected ref.

**2. ChatArea.tsx is a 2,119-line monolith**
- Contains ALL logic: file upload, PDF extraction, OCR routing, streaming, validation, pricing, overlay computation, scope detection, mode selection, rendering. This is the single biggest obstacle to maintainability and debugging.
- **Fix (incremental)**: Extract into custom hooks without changing behavior:
  - `useFileUpload` — handles upload, progress, search index population
  - `useAIStream` — streamAIResponse, handlePostStream, processAtomicTruth
  - `useBlueprintViewer` — overlay elements, viewer navigation, review state
  - Keep ChatArea as the orchestrator/renderer only

**3. Missing error boundary around ChatArea**
- Any runtime error in the 2,119-line component crashes the entire app with a white screen. No recovery possible.
- **Fix**: Wrap ChatArea in an `ErrorBoundary` component that shows a "Something went wrong — reload" fallback.

**4. `useCallback` dependency arrays are incomplete**
- `streamAIResponse` (line 602) lists `[onStepChange, projectId]` but references `scopeDataRef`, `user`, `fetchKnowledgeContext`, `supabase` — some closures are stale-safe via refs, but `fetchKnowledgeContext` itself captures `user` without being in the dep array. Not causing bugs today (user rarely changes mid-session) but fragile.
- **Fix**: Add `user` to `streamAIResponse` deps, or wrap `fetchKnowledgeContext` in `useCallback` with `[user]`.

**5. Signed URL expiry during long sessions**
- `loadUploadedFiles` creates 2-hour signed URLs (7200s). If a user leaves the tab open and returns after 2 hours, all file references are dead — AI calls fail silently.
- **Fix**: Add a `useEffect` interval that refreshes signed URLs every 90 minutes, or refresh lazily before each AI call.

**6. No loading/disabled state on delete project**
- `deleteProject` (line 120) has no optimistic update guard. Double-clicking fires two deletes. The button has no disabled state during the async call.
- **Fix**: Add a `deletingId` state and disable the button while deleting.

**7. Memory leak: `URL.createObjectURL` in staged files preview**
- Lines 2011 and 2026 call `URL.createObjectURL` inside render without ever calling `URL.revokeObjectURL`. Each render creates a new blob URL that leaks.
- **Fix**: Use `useMemo` or `useEffect` cleanup to revoke object URLs.

**8. Export buttons not visible in step-by-step mode**
- The export PDF/Excel buttons and suggestion cards (lines 1934-1937, 1942-1944) only appear when `quoteResult?.quote` exists. In step-by-step mode, the `buildSyntheticQuote` path may not run if the AI response doesn't contain `ATOMIC_TRUTH` markers — the user sees results but no export buttons.
- **Fix**: After step-by-step conversation completes and produces elements, ensure `buildSyntheticQuote` runs so exports are available. This connects to the user's question about "why is not showing PDF and Excel download."

### Implementation Plan

**Phase 1 — Critical fixes (patch now)**

1. **Fix export button visibility in step-by-step mode** (`ChatArea.tsx`, ~5 lines)
   - In `sendMessage` after `handlePostStream`, if `validationData` exists but `quoteResult` is null, auto-build a synthetic quote so export buttons appear.

2. **Fix BrainKnowledgeDialog ref warning** (`BrainKnowledgeDialog.tsx`, ~2 lines)
   - The Dialog component in Radix doesn't need a ref from the parent. The warning likely comes from `DialogTrigger asChild` wrapping a non-forwardRef component. Wrap the trigger child properly.

3. **Fix object URL memory leak** (`ChatArea.tsx`, ~8 lines)
   - Store object URLs in state, revoke on unmount/change.

4. **Add delete-in-progress guard** (`Dashboard.tsx`, ~5 lines)

**Phase 2 — Stability improvements**

5. **Add ErrorBoundary around ChatArea** (new file `src/components/ErrorBoundary.tsx`, ~30 lines; update `Dashboard.tsx` ~3 lines)

6. **Fix signed URL refresh** (`ChatArea.tsx`, ~15 lines)
   - Add interval-based refresh or refresh before AI calls.

**Phase 3 — Refactor (optional, larger scope)**

7. **Extract hooks from ChatArea** — deferred, large diff, risk of regressions.

### Scope
- 4 files modified: `ChatArea.tsx`, `Dashboard.tsx`, `BrainKnowledgeDialog.tsx`, new `ErrorBoundary.tsx`
- ~60 lines changed total for Phase 1+2
- No backend/migration changes

