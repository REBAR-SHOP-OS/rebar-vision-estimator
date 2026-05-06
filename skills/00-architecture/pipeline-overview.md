# Pipeline Overview

```text
 Legacy Project Intake ──► Bridge Into rebar Schema ──► Parse + OCR ──► Canonical Estimate JSON
          │                           │                        │                    │
          ▼                           ▼                        ▼                    ▼
   public.projects / files     rebar.projects / files   drawing_sheets       takeoff persistence
                                                                                  │
                                                                                  ▼
                                                                      warnings + estimate versions
```

## Current flow

1. **Intake** — `Dashboard.tsx` and `FilesTab.tsx` still create projects and uploads through the legacy `public` tables.
2. **Bridge** — `src/lib/rebar-intake.ts` plus `ensure_rebar_project_bridge` and `ensure_rebar_project_file_bridge` mirror those records into the new `rebar` schema.
3. **Parse and index** — `supabase/functions/populate-search-index` stores searchable page data and now mirrors sheet metadata into `rebar.drawing_sheets` and `rebar.drawing_detections`.
4. **Estimate** — the chat estimating path builds canonical line items and quote totals from OCR and model output.
5. **Persist takeoff** — `persistVerifiedEstimateFromChat` now calls `persistRebarTakeoffFromCanonical`, which writes `rebar.takeoff_runs`, `rebar.takeoff_items`, `rebar.takeoff_warnings`, `rebar.takeoff_assumptions`, and linked `rebar.estimate_versions` rows.
6. **Review and export** — the new rebar tables are now the durable base for QA queues, estimate summaries, and future Excel/PDF export workflows.

## Persisted system of record

- **Legacy intake compatibility** — `public.projects`, `public.project_files`, `public.rebar_project_links`, `public.rebar_project_file_links`
- **Rebar intake + drawing intelligence** — `rebar.projects`, `rebar.project_files`, `rebar.drawing_sheets`, `rebar.drawing_detections`
- **Takeoff core** — `rebar.takeoff_runs`, `rebar.takeoff_items`, `rebar.takeoff_warnings`, `rebar.takeoff_assumptions`, `rebar.manual_adjustments`, `rebar.human_reviews`
- **Commercial outputs** — `rebar.estimate_versions`, `rebar.estimate_exports`, `rebar.v_takeoff_summary_by_bar_size`, `rebar.v_takeoff_summary_by_element`, `rebar.v_estimate_detail_export`

## Key modules

- **Ingest UI** — `src/pages/Dashboard.tsx`, `src/components/workspace/FilesTab.tsx`
- **Bridge helpers** — `src/lib/rebar-intake.ts`
- **Parsing + sheet sync** — `supabase/functions/populate-search-index/index.ts`
- **Canonical estimate persistence** — `src/lib/verified-estimate/persist.ts`, `src/lib/rebar-takeoff-persistence.ts`
- **Workflow reference** — `docs/system-workflow.md`

## MVP alignment notes

- The repo is now halfway through the MVP data migration: intake, drawing metadata, and persisted takeoff runs are in the `rebar` schema, while much of the UI still reads and writes through legacy project workflows.
- Human review remains essential. Low-confidence rows, unsupported bar sizes, and missing sheet references are persisted as warnings instead of being silently dropped.
- Deterministic rebar weight math belongs in the persisted takeoff layer so summaries and exports can be derived from stored rows rather than recomputed ad hoc.

## Hard limits to remember

- Edge functions: under roughly 150 MB RAM, around 500 KB JSON payloads, and at most 3 Vision images per request.
- PDFs larger than about 3 MB should be rendered client-side, then page images uploaded and processed by signed URL.
- AI extraction should stay deterministic: `temperature: 0` and structured JSON output with no markdown fences.
- Any export or QA screen should read from persisted rebar takeoff tables once available rather than from transient chat-only state.
