## Goal

Act on the four prioritized recommendations in `docs/full-audit-2026-05-08.md` without breaking working features. Tests and build are green today; this plan focuses on **performance, type-safety debt, and CI/security visibility**.

## Phased plan

### Phase 1 — Bundle splitting (High priority)

Target: bring the main `index-*.js` chunk from ~3.2 MB (~930 KB gzip) down by route + heavy-lib lazy loading.

1. **Route-level lazy loading** in `src/App.tsx`:
   - Convert page imports to `React.lazy(() => import(...))` for: `Dashboard`, `ProjectWorkspace`, `LegacyProjectWorkspace`, `BlueprintViewerPage`, `ReviewPage`, `OrdersPage`, `OrderDetail`, `SegmentDetail`, `StandardsPage`. Keep `LandingPage`, `AuthPage`, `NotFound` eager.
   - Wrap `<Routes>` in `<Suspense fallback={...}>` using existing loading UI.
2. **Heavy-lib dynamic imports** (only inside the handlers that use them):
   - `src/lib/pdf-export.ts`, `src/lib/quote-pdf-export.ts`, `src/lib/excel-export.ts` — already export functions; switch call sites to `await import(...)` so jsPDF / xlsx / pdfjs land in their own chunks.
   - `src/lib/pdf-to-images.ts` — dynamic-import `pdfjs-dist` inside `renderPdfPagesToImages`.
3. **Manual chunks** in `vite.config.ts` `build.rollupOptions.output.manualChunks` for: `react`, `radix` (`@radix-ui/*`), `pdf` (`pdfjs-dist`, `jspdf`, `html2canvas`), `xlsx`, `charts` (`recharts`).
4. Re-run `npm run build`, confirm main chunk shrinks and no chunk-size warning fires (or budget < 800 KB).

### Phase 2 — Lint / type-safety guardrails (High priority)

Goal: stop the bleeding now; burn down later.

1. Add a CI gate: `npm run lint -- --max-warnings=454` in `.github/workflows/ci.yml` (and `pr-validation.yml`) so new warnings fail PRs. Lower the cap as warnings are fixed.
2. Remove unused `eslint-disable` directives in any file we touch this round (mechanical, low risk).
3. Document the burn-down policy in `AGENTS.md`: new code must be `any`-free; touched files lose one `any` per PR opportunistically.

No code-wide refactor of `any` in this phase — explicitly out of scope per minimum-patch policy.

### Phase 3 — Dependency vulnerability visibility (High priority)

1. Add a scheduled job `.github/workflows/dependency-audit.yml`: weekly cron + manual dispatch, runs `npm audit --audit-level=high` and uploads JSON as an artifact. Failures only on `high`/`critical`.
2. Add the same step (non-blocking, `continue-on-error: true`) to `ci.yml` so every PR gets a snapshot.
3. Note in `README.md` how to run locally (`npm audit --json > audit.json`).

### Phase 4 — Performance guardrails (Medium priority)

1. Add `vite-bundle-visualizer` (or `rollup-plugin-visualizer`) as devDependency; add `npm run analyze` script.
2. Add bundle-size check to CI using a small node script that reads `dist/assets/*.js` sizes and fails if any single chunk exceeds an agreed budget (proposed: 800 KB raw / 250 KB gzip for the main entry).

## Out of scope

- Mass `any → typed` refactor (deferred to ongoing burn-down).
- Rewriting edge functions for lint compliance.
- Lighthouse / runtime perf instrumentation beyond bundle size.
- Any product/UX changes.

## Acceptance

- `npm run build`: no Rollup chunk-size warning; main entry < 800 KB raw.
- `npm run test`: still 106/106 passing.
- `npm run lint`: warnings ≤ current cap; CI fails on new warnings.
- New weekly dependency-audit workflow visible in GitHub Actions.
- README documents local audit command.

## Risk / rollback

All changes are additive (CI workflows, vite config, lazy-loading wrappers). Rollback = revert the PR; no DB or edge-function impact.
