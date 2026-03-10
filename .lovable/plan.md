

## Plan: SYSTEM_PATCH v2026.03.HARDENED — Master Prompt Hardening

### What Already Exists vs What's New

| Patch Item | Status | Action |
|---|---|---|
| 1. Deterministic Compute | Partial (weight tables locked, but no explicit LLM math ban) | Add explicit rule |
| 2. Quantity Graph Model | Partial (ElementUnit has bar_lines) | Add REBAR_SET schema note |
| 3. Reconciliation Engine | Partial (Stage 10 exists, no variance thresholds) | Add thresholds |
| 4. Silent Corruption Guard | Partial (G1-G4 exist, no G5 unit_validation) | Add G5 |
| 5. Lineage Hash Chain | Partial (SHA-256 placeholders exist) | Add stage_hash chaining rule |
| 6. Strict JSON Schema | Partial (most keys required) | Add audit_trace to required |
| 7. Hallucination Containment | Partial (R1 exists) | Strengthen with confidence=0, BLOCKED |
| 8. Lock Weight Tables | Exists | Add explicit "LLM cannot modify" |
| 9. Parallel Processing | Client-side exists | Add worker config constants |
| 10. Stage 9 Validation | Missing | Insert between Stage 8 and Stage 10 |
| 11. Rule Governance | Partial (priority order exists) | Add RULE_SET_VERSION |
| 12. Regression Testing | Partial (tests exist) | Expand accuracy targets |

### Changes

**1. `supabase/functions/analyze-blueprint/index.ts`** — Inject hardened rules into MASTER_PROMPT

Insert a new `HARDENED_PATCH` block after the existing CHM block (line ~510) and before SSLW-1. This adds:

- **Deterministic Compute Engine**: Explicit instruction: "You are FORBIDDEN from performing arithmetic. All weight = qty × length × unit_weight must be computed deterministically using the locked tables. Output the formula and inputs; the system will verify."
- **Reconciliation Thresholds**: After Stage 10 reconciliation, apply: variance <15% → OK, 15-35% → FLAG, >35% → RISK_ALERT. Output `reconciliation.variance_pct` and `reconciliation.risk_level`.
- **G5 Unit Validation Gate**: Add to AT-4 validation gates: "G5 Unit: confirm units_context is consistent across all line items. If mixed without explicit MIXED_CONFIRMED, set BLOCKED."
- **Lineage Hash Chain**: Each stage output must include `stage_hash = SHA256(previous_stage_hash + stage_output)`. Store in `audit_trace.stage_hashes[]`.
- **Stage 9 — Estimation Validation**: Insert between Stage 8 and Stage 10. Re-verify all elements pass G1-G5. Any element failing → BLOCKED. Count READY/FLAGGED/BLOCKED. If BLOCKED > 0, set `job_status = VALIDATION_FAILED`.
- **Hallucination Containment Reinforcement**: "If ANY data point is missing: value = UNKNOWN!, confidence = 0, status = BLOCKED. Never infer, interpolate, or approximate without evidence."
- **Rule Governance Version**: Add `RULE_SET_VERSION: RSIC_2018_v3` and priority chain: USER_RULES > PROJECT_RULES > AGENT_RULES > SYSTEM_RULES.

Update JSON schema required keys (line ~550 area) to add `audit_trace` alongside existing required keys.

Update `MASTER_PROMPT` version string from `v2026-03-05` to `v2026-03-10 (Rev B — HARDENED)`.

**2. `supabase/functions/validate-elements/index.ts`** — Add G5 unit validation gate

Add `unitGate(element)` function that checks `element.extraction?.truth` for unit consistency. Wire it into the 4-gate sequence (making it 5 gates).

**3. Database migration** — Seed hardened patch rule into `agent_knowledge`

Insert one row: `type = 'rule'`, title = "SYSTEM_PATCH v2026.03.HARDENED", content = summary of all 12 activated capabilities. Makes it visible in Agent Brain UI.

**4. `src/test/detection-regression.test.ts`** — Add accuracy target assertions

Add test cases asserting `weight_error < 3%` and `missing_items < 1%` targets from the patch spec, expanding the existing regression harness.

### Scope
- 2 edge functions modified: `analyze-blueprint/index.ts`, `validate-elements/index.ts`
- 1 test file updated: `detection-regression.test.ts`
- 1 database migration: seed rule into `agent_knowledge`
- No UI changes, no new dependencies

