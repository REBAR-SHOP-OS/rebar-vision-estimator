

# Redesign: Trust-First Estimating Workspace

This is a large-scope UI redesign. To follow the minimal-change policy and avoid destabilizing working backend logic, the plan is broken into **4 phases**, each independently shippable. I recommend implementing Phase 1 first and iterating.

---

## Phase 1: Dashboard Redesign + New Layout Shell

### A. New Dashboard Project List (`src/pages/Dashboard.tsx`)

Replace the current welcome screen + sidebar-only project list with a proper dashboard view when no project is selected:

- **Project table/card grid** with columns: Name, Client, Type, Files, Latest Version, Approved/Review/Blocked counts, Trusted Total, Pending Total, Updated At
- **Status filters**: All, Has Blocked, Needs Review, Approved
- **Search bar** for project name/client
- **Health indicators**: color-coded dots (green/amber/red) based on blocked/review counts
- Data source: query `projects` joined with `estimate_versions` and `project_files` counts (client-side aggregation from existing tables)

### B. 3-Pane Layout Shell for Active Project

When a project is selected, replace the current single ChatArea with a 3-pane resizable layout:

```text
┌──────────┬──────────────────────┬──────────────┐
│  LEFT    │  CENTER              │  RIGHT       │
│  NAV     │  ESTIMATE TABLE      │  EVIDENCE    │
│  SIDEBAR │  + SUMMARY CARDS     │  DRAWER      │
│          │                      │              │
│ Files    │  [Summary Cards]     │ Source Refs   │
│ Versions │  [Estimate Grid]     │ Validation   │
│ Workflow │                      │ Actions      │
└──────────┴──────────────────────┴──────────────┘
```

- Use `react-resizable-panels` (already installed via `ResizablePanel`)
- Left: ~220px, Center: flex, Right: ~320px (collapsible)

### C. New Components to Create

1. **`src/components/workspace/ProjectDashboard.tsx`** — project list table with filters, search, health indicators
2. **`src/components/workspace/WorkspaceLayout.tsx`** — 3-pane shell with ResizablePanel
3. **`src/components/workspace/ProjectSidebar.tsx`** — left nav: files, versions, drawing sets, workflow stage
4. **`src/components/workspace/EstimateSummaryCards.tsx`** — top cards: Trusted Total, Pending Total, Blocked, Approved, Review, Pricing Allowed, Drawing Gen Allowed
5. **`src/components/workspace/EstimateGrid.tsx`** — dense table: Element ID, Type, Status, Evidence Grade, Weight, Cost, Issues, Questions, Source Sheets
6. **`src/components/workspace/EvidenceDrawer.tsx`** — right pane: source refs, validation errors/warnings, conflicts, assumptions, bar lines, questions, action buttons (Approve, Review, Block, Clarify)
7. **`src/components/workspace/StatusBanner.tsx`** — "Pricing Locked" / "X items need review" banner

### D. Status Model Mapping

Map existing statuses to the 3-state model:
- `READY` / `approved` → **Approved** (green)
- `FLAGGED` / `needs_review` → **Needs Review** (amber)
- `BLOCKED` → **Blocked** (red)

### E. Critical Trust Behaviors

- Summary cards show **Trusted Total** (approved rows only) and **Pending Total** (review rows) as separate values — never a single combined total
- When blocked > 0 or needs_review > 0: show "Pricing Locked" banner, disable pricing/drawing generation buttons
- Pricing and drawing generation buttons are visually gated (grayed + tooltip explaining why)

---

## Phase 2: Estimate Grid + Evidence Drawer (Detail Implementation)

### EstimateGrid
- Reuse data structures from existing `BarListTable` and `ValidationResults`
- Row click selects and populates EvidenceDrawer
- Status badges with color coding
- Sortable columns
- Sticky header

### EvidenceDrawer
- Tabs: Source | Validation | Bar Details | Questions
- Action buttons at bottom: Approve, Mark Review, Block, Request Clarification
- These update local state (future: persist to `review_queue` or `estimate_versions.line_items`)

---

## Phase 3: Blueprint Viewer Enhancement

- Add context panel showing which element/row is selected
- Highlight related pages/regions
- Add "Back to Estimate" navigation
- Professional review-tool styling (dark toolbar, minimal chrome)

---

## Phase 4: Public Review Page Redesign

- Clean read-only layout with summary cards (Trusted/Pending/Blocked)
- Row status indicators
- Questions and source references visible
- Trust indicators prominent
- No action buttons (read-only)

---

## Design Tokens (index.css additions)

Extend the existing CSS variables for the industrial SaaS aesthetic:
- `--status-approved`: green (reuse `--primary`)
- `--status-review`: amber
- `--status-blocked`: red (reuse `--destructive`)
- Keep existing light/dark theme structure
- Dense table styling: smaller padding, 13px font, tighter row height

---

## Files Modified/Created

### Modified
- `src/pages/Dashboard.tsx` — replace welcome screen with ProjectDashboard, replace ChatArea with WorkspaceLayout when project active
- `src/index.css` — add status color tokens and dense table utilities

### Created (new directory: `src/components/workspace/`)
- `ProjectDashboard.tsx`
- `WorkspaceLayout.tsx`
- `ProjectSidebar.tsx`
- `EstimateSummaryCards.tsx`
- `EstimateGrid.tsx`
- `EvidenceDrawer.tsx`
- `StatusBanner.tsx`

### Preserved (no changes)
- All edge functions
- `src/components/chat/*` — kept as-is, referenced from workspace components
- Auth flow, routes, contexts
- `BlueprintViewerPage.tsx`, `ReviewPage.tsx` — Phase 3/4

---

## Implementation Order

For the first implementation pass, I will build **Phase 1 + Phase 2** together:
1. Create the 7 new workspace components
2. Wire them into Dashboard.tsx
3. Add CSS tokens
4. Ensure existing ChatArea still works (accessible via a "Chat" tab in the workspace)

The existing ChatArea, BarListTable, ValidationResults, and all edge functions remain untouched. The new workspace components consume the same data but present it in the trust-first layout.

