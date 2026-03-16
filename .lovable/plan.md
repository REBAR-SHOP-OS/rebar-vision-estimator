

# Brain Knowledge Audit: Conflicts, Redundancies & Cleanup Plan

## Summary of Current State
Your brain has **4 files**, **~12 learned rules**, and **~12+ manual rules**. After cross-referencing every entry, here are the issues found:

---

## CRITICAL ISSUES

### 1. Duplicate Rule: "Corrected Human Method" exists TWICE
- **ID `a9fd2d59`** — "Corrected Human Method (Granular + Full Scope + Accessories)"
- **ID `d932d5ca`** — "Rebar Estimator — Corrected Human Method (Granular + Full Scope + Accessories)"

These are nearly identical (same 5 sections: Granularity, Callout Chasing, Standard Practice, Accessory Bars, Coverage Ledger). The second version (`d932d5ca`) is slightly more refined (adds "cite Manual of Standard Practice" requirement and "UNVERIFIED_ASSUMPTION!" language). **Action: Delete `a9fd2d59` (the older, less complete version).**

### 2. Empty Rule: "instruction main" has NULL content
- **ID `da26d2d0`** — title "instruction main", content is `<nil>` (empty). This is dead weight and could confuse prompt injection. **Action: Delete it.**

### 3. Double-prefix on learned rule
- **ID `6db9feef`** — Content starts with `[Methodology only]: [Methodology only]:` (doubled prefix from a merge bug). Also contains two near-identical sentences: "NEVER assume standard lap splice lengths..." and "NEVER assume default lap lengths..." **Action: Clean up to single sentence, single prefix.**

---

## REDUNDANCY CLUSTERS (Learned Rules)

### Cluster A: "State assumptions / missing info explicitly" (5 overlapping entries)
These all say roughly the same thing — "tell the user what's missing, state assumptions clearly":
- `794fde9e` — "confirm project category before proceeding"
- `a065b072` — "ask for missing details, identify discrepancies, state when can't proceed"
- `64a8d565` — "ask for clarification on scope exclusions"
- `8bde85bd` — "clarify industry-norm vs drawing-specific, state exclusions"
- `d00f0c1c` — "state assumptions, communicate missing details, provide reconciliation report"
- `fbb153cf` — "state assumptions about concrete cover"

**Action: Merge into ONE consolidated rule** like: *"ALWAYS explicitly state assumptions, missing details, and scope exclusions. Distinguish industry-norm assumptions from drawing-specific data. Provide a reconciliation/risk report before proceeding with any assumed values."*

### Cluster B: "Use current project data only" (2 overlapping entries)
- `acfbed4c` — "using data exclusively from current project's drawings"
- `4555f467` — "explicit dimensions on plans take precedence over scaled measurements"

These reinforce the same isolation principle. **Action: Merge into one rule.**

---

## OVERLAP BETWEEN RULES (Not conflicts, but bloat)

### "AI Studio Method" vs "Corrected Human Method" vs "Scope Finding Logic" vs "Scope Categorization"
These 4 large rules cover overlapping ground:
- **AI Studio Method** (`f02b6119`) — 6-phase SOP (Discovery → Takeoff → Hidden Rebar → Accessories → Waste → Output)
- **Corrected Human Method** (`d932d5ca`) — 5-step methodology (Granularity → Callout Chasing → Standard Practice → Accessories → Coverage Ledger)
- **Scope Finding Logic** (`b4535846`) — 7-step scope identification across S/A/C/L/MEP drawings
- **Scope Categorization** (`d5a39dba`) — 3-Way Match + 5 Construction Buckets

These are **not conflicting** — they are complementary layers. However, the AI Studio Method's Phase 1-2 overlaps heavily with the Corrected Human Method's steps 1-4. **No action needed** as long as rule priority is clear, but consider adding a note: "AI Studio Method provides the general SOP; Corrected Human Method provides the mandatory enforcement layer."

---

## NO CONFLICTS FOUND
There are no rules that directly contradict each other. The hierarchy (USER_RULES > PROJECT_RULES > AGENT_RULES > SYSTEM_RULES) is consistent. The "fail-closed" vs "industry-norm" distinction is properly separated across Drawing/Spec mode vs Industry-Norm mode in all relevant rules.

---

## Recommended Cleanup Actions

| Action | Target | What |
|--------|--------|------|
| DELETE | `da26d2d0` | Empty "instruction main" rule |
| DELETE | `a9fd2d59` | Duplicate Corrected Human Method (older version) |
| FIX | `6db9feef` | Remove doubled `[Methodology only]:` prefix, deduplicate sentence |
| MERGE 5→1 | `794fde9e`, `a065b072`, `64a8d565`, `8bde85bd`, `d00f0c1c`, `fbb153cf` | Consolidate "state assumptions/missing info" cluster |
| MERGE 2→1 | `acfbed4c`, `4555f467` | Consolidate "use current project data only" cluster |

This would reduce your brain from ~24 entries to ~18 cleaner, non-redundant entries.

