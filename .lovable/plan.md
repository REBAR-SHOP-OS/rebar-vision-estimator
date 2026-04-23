

# Trust-First Shop Drawing System — Honest Modes, Deterministic Truth, Gated Export

Restructure the shop-drawing pipeline so AI-drafted sheets, reviewed drafts, and issued fabrication PDFs are **visually, structurally, and operationally distinct**. Stop the current behavior where AI previews look like issued drawings.

This plan implements **Phase 1 (Stop the bleeding)** in full and lays the data foundation for Phases 2–4. We do not boil the ocean — we ship the safety-critical separation first, then layer provenance + diff engines on top.

## End state

Three render modes. Three title blocks. Three export classes. One deterministic source of truth.

```text
┌──────────────────────────────────────────────────────────────┐
│  INGEST → AI EXTRACT → DETERMINISTIC MODEL → VALIDATE → ISSUE │
└──────────────────────────────────────────────────────────────┘
        │            │              │              │       │
   project_files  AI draft     bar_items +    validation  shop_drawings
                  (visual)     estimate_items   _issues   (mode-locked)
```

| Mode | Visual cues | Title block | Export label | Allowed if… |
|---|---|---|---|---|
| **AI Draft** | Diagonal `AI VISUAL DRAFT` watermark, amber frame, muted schedules, "inferred" tags | Schema A — generated_at, source count, AI confidence, **no** drawn-by/checked-by/approved-by | `AI Preview PDF` | always |
| **Review Draft** | Blue frame, "REVIEW DRAFT" banner, unresolved-issue count, diff highlights | Schema B — reviewer, last review, unresolved issues, deterministic coverage % | `Review Draft PDF` | deterministic model exists |
| **Issued** | Clean CAD frame, formal revision triangles, no watermark | Schema C — drawn/checked/approved by, revision, issue date, issue purpose | `Fabrication PDF` | validation passes + human approval |

## Phase 1 — Stop the bleeding (this implementation)

### 1. Mode field on shop drawings

Add `drawing_mode` enum to `shop_drawings` table: `ai_draft | review_draft | issued`. Default `ai_draft`. Every renderer reads this and picks the matching template.

### 2. Three title-block templates

Refactor `supabase/functions/generate-shop-drawing/shop-drawing-template.ts`:
- Split `renderTitleBlock(mode, data)` into three functions.
- **AI mode**: removes "Drawn / Checked / Approved by" rows entirely; replaces with "Generated / Sources / AI Confidence / Validation".
- **Review mode**: shows reviewer + unresolved issue count.
- **Issued mode**: full formal block, only mountable when status is approved.

### 3. AI watermark + frame color by mode

In `OutputsTab.tsx` HTML wrapper for AI Visual Draft:
- Add `<div class="watermark">AI VISUAL DRAFT — NOT FOR FABRICATION</div>` rotated -30°, 96pt, 8% opacity, repeated diagonally across every page.
- Sheet frame border color: amber `#d97706` for AI, blue `#1d4ed8` for review, black `#111` for issued.
- Replace any "REV 1" triangle in AI mode with `AI CHANGE CANDIDATE` chip. Formal revision triangles only render in `issued` mode.

### 4. Metadata validator + export gate

New file: `src/lib/shop-drawing/validate-metadata.ts`. Pure function, returns `{ ok: boolean; issues: Issue[] }`. Checks:
- Date format (`YYYY-MM-DD`, valid month/day) — catches the `2022-15` bug seen in the sample.
- Discipline label spelling against canonical list (`Architectural`, `Structural`, …) — catches `Architectral` typo.
- Required fields per mode (Schema A/B/C).
- Project name, sheet number, scale present.

Wired into the PDF export button in `OutputsTab.tsx`. If `!ok`, button shows toast with first 3 issues and refuses to export. Issues are also written to `validation_issues` so they appear in QA tab.

### 5. Schedule row provenance flag

Bar schedule rendering in the template: every row checks `row.deterministic_match === true`. If false (AI-inferred only), row gets:
- Muted gray text
- `[unverified]` suffix on the mark
- Italic font
- A `?` chip in the source column

This is non-blocking visual honesty — does NOT prevent the AI draft from rendering.

### 6. Export class selector

Replace single "Export PDF" button with a dropdown:
- **AI Preview PDF** — always enabled
- **Review Draft PDF** — enabled when `bar_items` exist for the project
- **Fabrication PDF** — enabled only when `drawing_mode='issued'` AND `validation_issues` has zero open critical/error rows

Each writes a different `drawing_mode` to the saved `shop_drawings` row and uses the matching template.

## Phase 2 foundation (data only, no UI yet)

Add columns now so Phase 2 work doesn't require another migration:
- `shop_drawings.drawing_mode` (text, default `ai_draft`)
- `shop_drawings.validation_state` (jsonb, default `{}`) — last validator output
- `shop_drawings.export_class` (text) — which class was rendered
- `shop_drawings.watermark_mode` (text) — `ai_draft | review | none`
- `bar_items.provenance_state` (text, default `ai_inferred`) — values: `source_detected | ai_inferred | deterministically_computed | human_confirmed`
- `bar_items.deterministic_match` (boolean, default false)

## Files changed

| File | Change | Lines |
|---|---|---|
| `supabase/migrations/...` | Add columns above | new |
| `supabase/functions/generate-shop-drawing/shop-drawing-template.ts` | 3 title-block schemas, mode-aware frame color, watermark CSS, schedule row provenance styling | ~120 |
| `src/lib/shop-drawing/validate-metadata.ts` | New pure validator | new (~80) |
| `src/components/workspace/OutputsTab.tsx` | Export-class dropdown, validator gate, AI watermark in HTML wrapper, mode-aware frame | ~60 |
| `src/components/workspace/QATab.tsx` | (no change — issues table already shows validation_issues) | 0 |

Net: 1 migration + 1 new file + 2 edits. No backend pipeline changes, no rebuild of estimation logic.

## Out of scope (later phases)

- **Phase 3**: Split into two completely separate renderer engines (AI vs deterministic SVG). Today's template handles both via mode flag.
- **Phase 4**: Revision diff engine comparing approved versions. Today we only suppress fake revision marks in AI mode.
- **Phase 5**: Role-based approval chain, audit log per export, version rollback.
- Provenance click-through panel on each bar mark — data captured now, UI later.

## Risk

Low for Phase 1. All changes are additive: new enum column with safe default, new validator that gates one button, template changes scoped to one file rendered inside an isolated iframe. Existing AI Visual Draft flow continues to work — it just now looks honestly like a draft.

## Why this order

The user's analysis is correct that the root problem is **mode confusion**, not visual polish. Making the AI draft prettier without separating modes makes the trust problem worse. Phase 1 ships the safety wall (watermark + title-block separation + export gate); Phases 2–4 build the trust scaffolding (provenance, diff, approval) on top of a foundation that already refuses to lie about what it's showing.

