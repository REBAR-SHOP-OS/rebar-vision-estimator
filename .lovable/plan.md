

## Plan: Implement Audited Master Prompt Rev A

This upgrades the `analyze-blueprint` edge function's Master Prompt from the current v2026-03-05 to **Rev A** (the audited version), incorporating all hardening actions from the audit report.

### Changes

**1. Replace `MASTER_PROMPT` constant** (lines 299-798 in `analyze-blueprint/index.ts`)

Replace the entire prompt with the Rev A version from the audit. Key additions:
- `units_context` requirement at Stage 0 (METRIC / IMPERIAL / MIXED_CONFIRMED / UNKNOWN!)
- Explicit `view_type` and `region_ref` in evidence requirements
- SSLW-1 custom rule (regional stock-length + waste isolation) embedded in Stage 5.5
- R12 strict separation enforced: `evidence_refs >= 1` on drawing-spec items, no `assumptions` field allowed
- OCR tie-break policy: confidence-winner with minor-diff normalization
- Deterministic rounding rules section
- JSON schema constraints section (REBAR_ESTIMATE_V1 top-level keys)

**2. Update `REBAR_WEIGHT_TABLE`** (lines 862-877)

Add `#2: 0.167 lb/ft` with the note about plain/merchant bar verification.

**3. Update `CANADIAN_METRIC_TABLE`** (lines 879-912)

Add explicit stock lengths per CBSA/RSIC (6m/12m/18m), Grade 400R/W and 500R/W with weldability note, and CBSA standard length reference.

**4. Update `src/lib/rebar-weights.ts`**

Add `#2` to `IMPERIAL_LB_FT` table for consistency with the locked weight table.

**5. Update `supabase/functions/price-elements/index.ts`**

Add `#2` to `REBAR_WEIGHT` table for consistency.

### Scope
- 3 files modified
- No database migrations
- No UI changes
- No new dependencies

