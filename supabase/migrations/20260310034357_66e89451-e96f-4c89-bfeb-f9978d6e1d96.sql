INSERT INTO public.agent_knowledge (user_id, type, title, content)
SELECT auth.uid(), 'rule', 'SYSTEM_PATCH v2026.03.HARDENED',
'PATCH VERSION: v2026.03.HARDENED | DATE: 2026-03-10 | STATUS: ACTIVE

ACTIVATED CAPABILITIES:
1. HP-1 Deterministic Compute Engine — LLM forbidden from arithmetic; weight = qty × length × unit_weight verified by system
2. HP-2 Quantity Graph Model — PROJECT → ELEMENT → REBAR_SET hierarchy enforced
3. HP-3 Reconciliation Thresholds — <15% OK, 15-35% FLAG, ≥35% RISK_ALERT
4. HP-4 G5 Unit Validation Gate — Mixed units without MIXED_CONFIRMED → BLOCKED
5. HP-5 Lineage Hash Chain — SHA256 stage_hash chaining in audit_trace.stage_hashes[]
6. HP-6 Stage 9 Estimation Validation — Re-verify G1-G5 before reconciliation
7. HP-7 Hallucination Containment — Missing data → UNKNOWN!, confidence=0, BLOCKED
8. HP-8 Locked Weight Tables — CSA G30.18 RSIC 2018 + ASTM A615, immutable
9. HP-9 Parallel Processing — ocr=4, sheet=6, estimation=3 workers
10. HP-10 Rule Governance — USER > PROJECT > AGENT > SYSTEM, RSIC_2018_v3
11. HP-11 Regression Targets — weight_error <3%, missing_items <1%
12. Master Prompt upgraded to Rev B (HARDENED)'
WHERE auth.uid() IS NOT NULL
LIMIT 1;