

# Modularize: Split Estimate and Shop Drawing into Separate Modules

Restructure the workspace so **Estimation** and **Shop Drawings** are two clearly separated modules with their own sidebar entries, routes, and tabs — instead of being mixed together inside the single project workspace's "Outputs" tab.

## Current state

- One workspace at `/app/project/:id` with tabs: Overview, Files, Segments, QA, Outputs, Settings.
- "Outputs" tab mixes: Estimate Summary, Draft Shop Drawings, Issue Report, Quote Packages.
- Shop drawing UI lives in `OutputsTab.tsx` + `ShopDrawingModal.tsx` + `DrawingViewsPanel.tsx` (per-segment).
- Sidebar (`AppSidebar.tsx`) has only top-level entries (Dashboard, Standards, Orders).

## Target state

Two distinct modules accessible from the project workspace:

```text
Project Workspace
├── Overview
├── Files
├── Segments
├── QA / Issues
├── Estimate        ← NEW (was part of Outputs)
│   ├── Summary
│   ├── Bar List
│   ├── Quote Packages
│   └── Issue Report
├── Shop Drawings   ← NEW (was part of Outputs + per-segment)
│   ├── Generate (per segment / project)
│   ├── History
│   └── AI Visual Drafts
└── Settings
```

"Outputs" tab is retired; each module owns its own outputs.

## Minimal-patch implementation

### 1. New tab components (extract, don't rewrite)
- **`src/components/workspace/EstimateTab.tsx`** — move estimate cards (Estimate Summary, Quote Packages, Issue Report, exports) out of `OutputsTab.tsx`. Reuse `EstimateGrid`, `EstimateSummaryCards`, `ExportButtons`, `quote-pdf-export.ts` as-is.
- **`src/components/workspace/ShopDrawingsTab.tsx`** — move shop-drawing cards out of `OutputsTab.tsx`. Reuse `ShopDrawingModal`, `DrawingViewsPanel`, `draft-shop-drawing-ai` edge function as-is. Add a History list (already exists inside the modal — surface it as the tab's main view).

### 2. Router additions (`src/App.tsx`)
Add two routes alongside existing ones:
```text
/app/project/:id/estimate
/app/project/:id/shop-drawings
```
Both render `ProjectWorkspace` (same shell), which already routes by URL suffix.

### 3. Tab wiring (`src/pages/ProjectWorkspace.tsx`)
- Add to `TAB_SUFFIXES`: `"/estimate": "estimate"`, `"/shop-drawings": "shop-drawings"`.
- Add to `suffixMap` in `handleTabChange`.
- Replace the single `Outputs` `TabsTrigger` with two: `Estimate` and `Shop Drawings`.
- Add two `TabsContent` blocks rendering the new components.
- **Remove** the old `outputs` tab + route (or keep `/outputs` as a redirect to `/estimate` for back-compat — one line).

### 4. Sidebar (optional, `AppSidebar.tsx`)
When a project is active, show two sub-links under the project: "Estimate" and "Shop Drawings". Keep this minimal — only if a project is currently open.

### 5. Files NOT touched
- `OutputsTab.tsx` — kept for one release as a thin re-export, or deleted if you confirm.
- `ShopDrawingModal.tsx`, `DrawingViewsPanel.tsx`, `EstimateGrid.tsx`, `ExportButtons.tsx`, all edge functions, all DB tables, RLS policies — **zero changes**.
- No DB migration needed.

## Files changed

| File | Change |
|---|---|
| `src/components/workspace/EstimateTab.tsx` | NEW — extracted estimate cards |
| `src/components/workspace/ShopDrawingsTab.tsx` | NEW — extracted shop drawing cards + history |
| `src/pages/ProjectWorkspace.tsx` | +2 tabs, +2 suffix mappings, −1 (outputs) |
| `src/App.tsx` | +2 routes |
| `src/components/workspace/OutputsTab.tsx` | Deleted (or kept as redirect) |
| `src/components/layout/AppSidebar.tsx` | Optional: project sub-nav |

Net: 2 new files, 2–3 edits, 0 backend changes.

## Risk

Very low. Pure UI reorganization; all data flows, edge functions, modals, and exports stay intact. Old `/outputs` URLs can redirect to `/estimate` to avoid broken bookmarks.

## Confirm before I implement

1. **Retire "Outputs" tab entirely**, or keep it as a redirect to `/estimate`?
2. **Sidebar sub-nav** under the active project — yes or skip for now?
3. **Issue Report** — belongs under Estimate, or keep it solely in the existing QA tab?

