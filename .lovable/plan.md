## Goal
Reword every QA / unresolved-geometry question so it asks the estimator for **raw drawing inputs** (dimensions, counts, spacing as drawn) and never for derived values ("perimeter", "total length", "qty", "verify total"). The system performs the math.

## Where questions are generated

1. **`supabase/functions/auto-estimate/index.ts`** (lines ~970–1014)
   - Currently builds:
     - `title = "Unresolved geometry: <description>"`
     - `description = "Missing: perimeter; element dimensions\nDetailer notes: …"`
   - This is the source string the user is seeing in the screenshot ("Missing: rebar callout; element dimensions").

2. **`src/features/workflow-v2/takeoff-data.ts`** — `buildQuestionText()`
   - Currently prefixes the location and falls back to the original description verbatim. It does not rewrite the ask.

## Rewrite strategy (deterministic, no AI call)

Add a small pure helper `buildRawInputAsk(ctx)` in `auto-estimate/index.ts` (and a mirror in `takeoff-data.ts` for legacy/canonical issues that already exist in the DB without the new wording). It maps:

- **element_type / callout keywords → element class**
  - `slab edge`, `frost slab`, `slab on grade` → `slab_edge`
  - `strip footing`, `cont footing`, `footing` → `strip_footing`
  - `pad`, `housekeeping pad`, `equipment pad` → `pad`
  - `wall`, `foundation wall`, `retaining wall` → `wall`
  - `column`, `pier`, `cage` → `cage`
  - else → `generic`

- **missing_refs token → required raw input phrase**
  - `perimeter`, `edge_length`, `run_length`, `length` → "the run/length dimension shown on the drawing"
  - `wall_height`, `height` → "the wall height shown on the drawing"
  - `pad_length`, `pad_width`, `dimensions`, `element_dimensions` → "the pad/element length and width shown on the drawing"
  - `spacing`, `o_c` → "the bar spacing shown on the drawing"
  - `count`, `qty` → "the bar count shown on the callout"
  - `rebar_callout`, `callout` → "the rebar callout text shown on the drawing"
  - `cover` → "the concrete cover shown on the drawing"

- **element class → what the system will compute** (closing clause):
  - slab_edge → "so the system can calculate total edge run, qty, length, and weight"
  - strip_footing → "so the system can calculate total length and weight"
  - wall → "so the system can calculate bar length, qty, and weight"
  - pad → "so the system can calculate qty and total length"
  - cage → "so the system can calculate stirrup count, length, and weight"
  - generic → "so the system can calculate qty, length, and weight"

Format produced:
```
<location_label>, <element noun> at <callout/grid>: enter <raw input list> for "<callout text>" <closing clause>.
```
If callout text is missing, drop the `for "..."` segment. If element noun unknown, omit it.

## Files to edit (minimal patch policy)

1. **`supabase/functions/auto-estimate/index.ts`**
   - Add `buildRawInputAsk()` helper near the unresolved-issues block.
   - Replace `baseTitle` / `baseDesc` construction (lines 988–989) so:
     - `title` = `<locLabel> — <element noun> at <where>` (short, no "Missing:")
     - `description` = the raw-input ask sentence above.
   - Keep `source_refs` shape unchanged.

2. **`src/features/workflow-v2/takeoff-data.ts`**
   - Add the same helper (or shared logic) and call it inside `buildQuestionText` *only when* the original description starts with `Missing:` or `Unresolved geometry` or the issue type is `unresolved_geometry`. This rewrites already-stored issues at read time so the user sees the new wording immediately without re-running auto-estimate.
   - For issues that aren't unresolved-geometry (e.g., generic warnings), keep current behavior but strip leading verbs like "verify", "confirm", "find", "calculate" → replace with "enter <raw input>".

3. **`src/features/workflow-v2/stages/QAStage.tsx`**
   - No structural change. The list row and detail panel already render `description`. Just confirm the longer sentence wraps cleanly (it already does — `line-clamp` removed earlier). No edit needed unless wrapping breaks; in that case widen the description container only.

## Out of scope
- No DB schema changes.
- No new tables, no migration.
- No change to overlay/zoom behavior.
- Canonical (rebar.takeoff_warnings) messages are kept as-is unless they match the unresolved-geometry pattern; the read-time rewrite handles cosmetic improvement.

## QA after implementation
- Reload `/app/project/3f840fa0-…` QA tab; verify the LEGACY:EF478A1E issue now reads e.g.:
  > Page 12, frost slab edge at "2-15M TOP AND BOTTOM": enter the slab edge length and width shown on the drawing for "2-15M TOP AND BOTTOM" so the system can calculate total edge run, qty, length, and weight.
- Confirm no question contains the words "verify total", "confirm total", "calculate", "find … length", "perimeter".
