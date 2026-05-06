## Goal

Apply the **Industrial Precision** visual language (uploaded `stitch_precision_rebar_estimating_system_6.zip`) to the new estimator workflow (`src/features/workflow-v2/*`). Mix and match the strongest layouts from the mockups into our existing 6 stages — without rebuilding logic, routes, or data plumbing.

## Visual Language (locked)

- **Sharp 0px corners**, 1px hairline dividers, no shadows/gradients
- **Inter** everywhere; ALL CAPS 11px labels; tabular numeric font for data
- **Color tokens** (added to `src/index.css` dark theme):
  - `--surface 220 14% 8%`, `--surface-container 220 13% 12%`, `--surface-container-high 220 12% 16%`
  - `--primary 220 100% 84%` (Industrial blue `#adc6ff`)
  - `--status-direct` blue, `--status-inferred` amber, `--status-supported` green, `--status-blocked` red
- 32px table row height, 24px input height, 4px base unit
- Status pills: 2px radius only; everything else sharp

## Stage-by-Stage Mix

| Stage | Source mockup | What we adopt |
|---|---|---|
| **Files** | `files_revisions` | Document Register table (file/discipline/rev/status/parse/sheets/upload), right-side Preview + Metadata + Revisions History panel, sheet-completeness warning bar |
| **Scope** | `scope_review` | Two-column Candidate Scope Items (left) → vertical Approve/Reject/Merge/Split rail (center) → Approved Scope buckets grid (right) with totals header |
| **Takeoff** | `takeoff_workspace_traceability_pro` + `takeoff_control_room_final_production_state` | Three-pane: left Estimator Copilot + Issue Queue, center Sheet viewer + Production Takeoff Data table, right Quantity Inspector tabs (Proof / History / Warnings / RFI) with sticky "Confirm Takeoff Data" CTA |
| **QA** | `qa_issue_management` | Red "Approval Gate Blocked" banner with Resolve/Override CTAs, grouped issue table (Critical Blockers / Review Warnings / Revision Conflicts), right Linked Source Review panel with isometric drawing + Recommended Fix |
| **Confirm** (Estimator Confirmation) | `revision_compare_production_audit_desk` action panel | Single-column signoff sheet: precondition checklist, signature block, "Confirm Takeoff Data" primary CTA, secondary "Mark for Review" / "Request Override" |
| **Outputs** | `project_deliverables_export_control` | Export Blocked banner (when applicable), 4 deliverable cards (Estimate Workbook / Quote Package / Review Draft / Fabrication Output) each with status pill + Generate/Download, Output Generation History table |

## Shell (`WorkflowShell.tsx`)

Mix `project_operations_dashboard` chrome:
- Left rail keeps stage list but switches to **icon + caps label** style with active state = filled primary bar on the left edge
- Top header gets the **6 KPI cards** strip (Files / Scope Approved / Takeoff Rows / QA Critical / QA Open / Outputs Ready) using Industrial cards
- Footer status bar reformatted as monospaced telemetry strip (already close — just retype + colors)
- Stage rail gets the "Stage 0X" kicker + sharp square step indicators (already close, just restyle)

## Files Touched (minimum patch)

1. `src/index.css` — append Industrial Precision tokens to `.dark` block + add `.font-tabular` and `.hairline` utilities (no removals)
2. `src/features/workflow-v2/WorkflowShell.tsx` — restyle header/rail/footer; KPI strip insert
3. `src/features/workflow-v2/stages/_shared.tsx` — extend `Pill` tones (direct/inferred/supported/blocked), add `<DataTable>`, `<KpiCell>`, `<SectionHeader>` primitives
4. `src/features/workflow-v2/stages/FilesStage.tsx` — relayout to Document Register + Preview/Metadata
5. `src/features/workflow-v2/stages/ScopeStage.tsx` — three-zone candidate/rail/approved layout
6. `src/features/workflow-v2/stages/TakeoffStage.tsx` — three-pane Copilot/Viewer+Table/Inspector
7. `src/features/workflow-v2/stages/QAStage.tsx` — gate banner + grouped table + Linked Source Review panel
8. `src/features/workflow-v2/stages/ConfirmStage.tsx` — signoff sheet
9. `src/features/workflow-v2/stages/OutputsStage.tsx` — deliverable cards + history table

## Out of Scope

- No data model / Supabase changes
- No router changes (workflow-v2 already primary)
- No new dependencies
- Legacy workspace under `src/pages/legacy/` untouched
- No copy edits to existing audit/persistence logic

## Acceptance

- All 6 stages render with the Industrial Precision look & feel
- Existing state hook (`useWorkflowState`) and persistence untouched
- No regressions in build / typecheck / tests
- Stage gating (locked / blocked / active) still functions exactly as today
