

## Plan: Embed "Corrected Human Method" Rule into Master Prompt + Agent Brain

### Problem
The estimator misses floors, uses broad approximations, skips callout cross-referencing, and omits accessory bars. The uploaded "Manual-Standard-Practice-2018" PDF in Agent Brain should be the source-of-truth for standard assumptions (not guesses).

### Changes

**1. Insert Corrected Human Method block in `analyze-blueprint/index.ts`**

Insert after `CUSTOM RULES INJECTION` block (line 469) and before `SSLW-1` (line 470). Five enforced behaviors:

- **Granularity**: Break into plan-defined segments (F1, W1, GB1), no "total perimeter" shortcuts. Each segment gets its own takeoff with evidence refs.
- **Callout chasing**: Cross-reference all plan callouts to details/schedules/notes. Mark `MISSING_DETAIL!` if not found after searching detail sheets, typical details, and notes.
- **Standard practice from Manual**: When drawings are ambiguous, assumptions in Industry-Norm mode MUST reference the uploaded "Manual of Standard Practice" file in Agent Brain (not invented defaults). In Drawing/Spec mode, ambiguity stays `UNKNOWN!`.
- **Accessory bars**: Track chair bars, nosing bars, brick ledge dowels, step bars, edge bars, re-entrant corner bars as separate line items. Drawing/Spec if specified; Industry-Norm if standard practice per Manual.
- **Coverage ledger**: Output `coverage_ledger` proving every level/sheet group was reviewed (Foundation, Ground, Upper floors, Roof, Site). On revisions, output `revision_change_log` with delta check — flag `POSSIBLE_OMISSION_RECHECK_REQUIRED!` if revision claims missing scope but delta < 2%.

**2. Add `coverage_ledger` to JSON schema required keys** (line 508 area)

Add to the top-level required keys list alongside `meta`, `scope_matrix`, etc.

**3. Seed the rule into `agent_knowledge` via database migration**

Insert one row: `type = 'rule'`, title = "Rebar Estimator — Corrected Human Method", content = the full rule text. This makes it visible in Agent Brain UI and injected into prompts.

### Key difference from previous plan
Standard practice assumptions are now explicitly tied to the **Manual of Standard Practice PDF** uploaded in Agent Brain Files, not invented by the AI. The prompt will instruct: "When applying Industry-Norm assumptions, reference the Manual of Standard Practice file in the knowledge base. If no such file exists, mark assumptions as `UNVERIFIED_ASSUMPTION!`."

### Scope
- 1 file modified: `supabase/functions/analyze-blueprint/index.ts`
- 1 database migration: seed rule into `agent_knowledge`
- No UI changes, no new dependencies

