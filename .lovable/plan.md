## Audit summary — Productivity & Performance

Build, tests, and CI guardrails are healthy after the May 2026 audit work (route-level lazy loading, manual chunks, size budgets, weekly `npm audit`). The remaining drag is concentrated in **(a) heavy libs still loading on first project open**, **(b) oversized "god components"** that slow iteration and re-render, and **(c) noise/cleanup debt**.

### Current bundle baseline (post-build)

```text
index (main)               377 KB  / 105 KB gzip   ✅ under 500 KB budget
ProjectWorkspace            317 KB  /  93 KB gzip   ⚠ heavy for a single route
radix                       277 KB  /  88 KB gzip   ✅
pdf  (jspdf+html2canvas+pdfjs)   923 KB / 271 KB gz  ⚠ pulled eagerly by OutputsTab
excel (exceljs)             937 KB / 269 KB gz   ⚠ pulled eagerly by OutputsTab
LegacyProjectWorkspace      153 KB /  42 KB gz   ⚠ kept for archive only
```

### Key findings

1. **Eager heavy-lib imports in `OutputsTab.tsx`** — `html2canvas`, `jsPDF`, and `exceljs` (via `excel-export`) are top-level imports. Opening any project workspace downloads ~1.9 MB of export libs the user may never click. The Phase 1 audit plan called for dynamic imports but `OutputsTab` was missed.
2. **God components hurting iteration speed**:
   - `src/components/chat/ChatArea.tsx` — 2 360 lines
   - `src/features/workflow-v2/stages/QAStage.tsx` — 1 293 lines
   - `src/components/workspace/OutputsTab.tsx` — 1 073 lines
   - `src/features/workflow-v2/stages/TakeoffStage.tsx` — 865 lines
   - `src/pages/SegmentDetail.tsx` — 733 lines
   These files mix data fetching, derived state, UI, and exports; they re-render entirely on any state change and are the primary source of `any` warnings.
3. **Re-render thrash** — 89 `useState/useEffect/useMemo` calls across the three biggest workspace files, with very few `useCallback`/`React.memo` wrappers. Lists (segments, elements, QA rows) re-render on every parent state change.
4. **Noise** — 60+ `console.log` calls in production code (top: `ChatArea` 23, `FilesTab` 11, `takeoff-data` 10). Adds bundle bytes and slows DevTools.
5. **`pdfjs-dist` worker pinned to a public CDN** (`PdfRenderer.tsx`, `pdf-to-images.ts`). External fetch on every PDF open = latency + offline failure risk.
6. **`html2pdf.js` dependency** is bundled in the `pdf` chunk but the codebase only uses `html2canvas` + `jspdf` directly. Likely dead weight.
7. **Type-safety debt** — 454 ESLint warnings (mostly `no-explicit-any`). Capped in CI but never burned down; slows refactor confidence.

### Plan (prioritized, minimum-patch)

#### Phase A — Quick perf wins (≤ a few small files each)

1. **Lazy-load export libs in `OutputsTab.tsx`**: move `html2canvas`, `jsPDF`, and `exportExcelFile` into the click handlers via `await import(...)`. Expected: removes ~1.9 MB from the workspace's eager graph; main `pdf`/`excel` chunks become user-action-triggered.
2. **Self-host the `pdfjs` worker**: replace the `cdnjs.cloudflare.com` worker URL in `PdfRenderer.tsx` and `pdf-to-images.ts` with a Vite `?url` import of the worker shipped by `pdfjs-dist`. Removes external network dependency and cold-start latency.
3. **Drop unused `html2pdf.js`** dep from `package.json` and the `pdf` manualChunk in `vite.config.ts`. Re-run build to confirm shrinkage.
4. **Strip noisy `console.log`** in the top offenders (`ChatArea`, `FilesTab`, `takeoff-data`). Keep `console.warn`/`console.error`. Optional: add a tiny `debug()` helper gated by `import.meta.env.DEV`.

#### Phase B — Render-cost fixes (targeted, no rewrites)

5. **Memoize hot list rows**: wrap `SegmentsTab` row components, `QATab` rows, and the QA-stage element table rows in `React.memo` with stable keys; convert their parent callbacks to `useCallback`. This is the highest-ROI re-render fix without restructuring.
6. **Stabilize derived data** in `OutputsTab` and `TakeoffStage`: replace inline `.map`/`.filter` chains in render with `useMemo` for the few heavy ones (sheet filtering, estimate aggregation).

#### Phase C — Productivity refactors (one component per PR, opt-in)

7. **Split `OutputsTab.tsx`** into `OutputsTab` (shell + tab state) + `ShopDrawingsPanel` + `ExcelExportsPanel` + `PdfExportsPanel`. Pure file moves; no behavior change.
8. **Split `ChatArea.tsx`** by message-kind: `ChatMessageList`, `ChatComposer`, `ChatToolPanels`. Same surface, smaller files = faster lints, faster Vite HMR.
9. **Extract data-loading hooks** from `QAStage` and `TakeoffStage` into `useQaState` / `useTakeoffState` so the stage components stay presentational.

#### Phase D — Type-safety burn-down (continuous)

10. Lower the lint cap by ~25 warnings each PR, focusing on files touched by phases A–C. No mass refactor.

### Acceptance

- `npm run build`: workspace route no longer eagerly loads `pdf`/`excel` chunks (verifiable in `dist/bundle-stats.html`).
- Phase A measurable: workspace cold-load JS drops by ≥ 500 KB gzip when no export is clicked.
- `npm run test`: still 106/106 passing after each phase.
- `npm run check:bundle-size`: still green.
- Lint cap monotonically decreasing.

### Out of scope

- DB / RLS / edge-function changes.
- UI redesigns or new features.
- Mass `any → typed` rewrite (handled opportunistically per Phase D).

### Suggested execution order

A1 → A3 → A4 → A2 (one PR), then B5 → B6 (one PR), then C7/C8/C9 as separate PRs only if you want them.
