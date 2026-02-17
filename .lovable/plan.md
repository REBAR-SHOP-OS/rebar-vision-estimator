

## Smart Category-Adaptive Detection: "Dominance + Veto" Architecture

### Problem
The current detection returns a single `category` field. If the AI sees one caisson/cage detail in a 20-page residential set, it labels the entire project as "cage", which locks scope to cage-only items, skips all footing/wall/slab analysis, and produces wrong results.

### Solution: Two-Layer Detection Output

Instead of one `category`, the system outputs:
- **primaryCategory** -- what the overall project "is" (residential, commercial, cage_only, etc.)
- **features** -- what sub-modules are present (hasCageAssembly, hasBarListTable)

A residential project with one caisson detail becomes `primaryCategory: "residential"` + `features.hasCageAssembly: true`. The system runs the full residential pipeline AND the cage module, keeping results separated by `estimation_group`.

### Detection Logic: Dominance + Veto

`cage_only` is set ONLY when:
1. Cage page ratio >= 70% of sheets
2. Zero strong building signals (FOUNDATION PLAN, BASEMENT WALL, SOG, FRAMING PLAN, etc.)

Otherwise: primaryCategory = residential/commercial/etc., features.hasCageAssembly = true.

---

### File Changes

#### 1. `supabase/functions/detect-project-type/index.ts`

**Change the tool schema and prompt to output the new DetectionResultV2 format:**

- Replace the `classify_project` tool parameters:
  - `category` becomes `primaryCategory` with enum adding `"cage_only"` and `"bar_list_only"`
  - Add `features` object: `{ hasCageAssembly: boolean, hasBarListTable: boolean }`
  - Add `evidence` object: `{ buildingSignals: string[], cageSignals: string[], barListSignals: string[] }`
  - Rename `confidence` to `confidencePrimary`

- Update the detection prompt to include the **Dominance + Veto rule**:
  - List building veto signals (FOUNDATION PLAN, FOOTING, STRIP FOOTING, BASEMENT WALL, ICF, SOG, FRAMING PLAN, BEAM, GRIDLINES, FLOOR LEVELS, sheet patterns S0xx/S1xx)
  - Instruct: "Set primaryCategory = cage_only ONLY if cage pages dominate (>70%) AND no building signals exist. Otherwise set the building category and set features.hasCageAssembly = true."

- Add server-side veto logic after AI returns: if `primaryCategory === "cage_only"` but keyword analysis found building signals (residential/commercial/industrial keywords), override to the strongest building category and force `features.hasCageAssembly = true`.

- Backward-compatible fallback: also return a `category` field mapped from the new format so existing code doesn't break during transition.

#### 2. `src/components/chat/ScopeDefinitionPanel.tsx`

**Update the `DetectionResult` interface and scope-locking logic:**

- Expand `DetectionResult` to `DetectionResultV2` with `primaryCategory`, `features`, `evidence`, `confidencePrimary`
- Add backward compatibility: if old `category` field exists but no `primaryCategory`, map it

- Scope auto-selection logic based on `primaryCategory`:
  - `cage_only`: auto-select CAGE, COLUMN, PIER only; gray out others with note "Not applicable for cage-only projects"; show "Reset to all" link
  - `bar_list_only`: hide element type grid entirely; show note "Bar list project -- elements parsed from schedule table"
  - `residential`: auto-select FOOTING, WALL, ICF_WALL, SLAB, WIRE_MESH; deselect RAFT_SLAB, PIER
  - `commercial/industrial/infrastructure`: keep current recommended behavior

- If `features.hasCageAssembly` is true AND primaryCategory is NOT cage_only: show a toggle checkbox "Include Cage Assembly module" (auto-checked), allowing user to include/exclude cage processing

- Update detection banner to show primaryCategory label + feature badges (e.g., "Residential + Cage Assembly detected")

#### 3. `supabase/functions/analyze-blueprint/index.ts`

**Make the pipeline category-adaptive with estimation_group separation:**

- Update `getCategorySpecificRules()`:
  - `cage_only` (renamed from `cage`): Replace 9-stage pipeline entirely with cage-only pipeline (verticals, ties, spirals). All output elements get `"estimation_group": "CAGE_ASSEMBLY"`.
  - `bar_list_only` (renamed from `bar_list`): Replace pipeline with table-parse-only. 
  - For ALL other categories: keep 9-stage pipeline with category focus. If `features.hasCageAssembly`, append cage module instructions as an additional stage: "After completing the 9-stage pipeline for loose rebar, also run a cage assembly scan for any cage schedules/details found. Output cage elements separately with `estimation_group: CAGE_ASSEMBLY`."

- Add `estimation_group` to the ElementUnit JSON schema:
  - `"estimation_group": "LOOSE_REBAR" | "CAGE_ASSEMBLY"`
  - Default is `LOOSE_REBAR` for all standard elements
  - Cage schedule elements are `CAGE_ASSEMBLY`

- Add anti-double-counting instruction: "If a cage mark/type exists in a cage schedule, do NOT also count those bars as loose rebar from plan scanning. Cage assembly elements are self-contained."

- Update scope injection block to read `primaryCategory` and `features` from the new scope format, falling back to old `detectedCategory` for backward compatibility.

- Update the summary JSON to include weight breakdowns per estimation_group.

#### 4. `src/components/chat/ChatArea.tsx`

**Adapt post-analysis UI and tab defaults:**

- Update `DetectionResult` type import to use new `DetectionResultV2`
- Map old detection results for backward compatibility

- Update scope data passed to edge function: include `features` and `primaryCategory` alongside existing `detectedCategory`

- Tab default logic (lines ~966):
  - If `primaryCategory === "cage_only"` or `primaryCategory === "bar_list_only"`: default tab = `"barlist"`
  - Else: default tab = `"cards"` (current behavior)

- Add estimation group filter to tabs: when elements exist with both `LOOSE_REBAR` and `CAGE_ASSEMBLY` groups, show filter chips ("All" | "Loose Rebar" | "Cage Assembly") above the cards/bar list

- Update `handleModeSelect` initial message to include category context:
  - cage_only: "Begin cage assembly estimation -- focus on verticals, ties, and spirals"
  - bar_list_only: "Parse the bar schedule table and calculate weights"
  - Others with hasCageAssembly: "Begin full estimation. Also process cage assemblies found in the set."
  - Others: current generic message

---

### Technical Details

| primaryCategory | Pipeline | estimation_group | Scope Items | Default Tab |
|---|---|---|---|---|
| cage_only | Cage-only (replaces 9-stage) | CAGE_ASSEMBLY only | CAGE, COLUMN, PIER (locked) | Bar List |
| bar_list_only | Table-parse only | LOOSE_REBAR | Hidden | Bar List |
| residential | Full 9-stage + optional cage module | LOOSE_REBAR + CAGE_ASSEMBLY if feature on | FOOTING, WALL, ICF_WALL, SLAB, WIRE_MESH | Cards |
| commercial | Full 9-stage + optional cage module | LOOSE_REBAR + CAGE_ASSEMBLY if feature on | All recommended | Cards |
| industrial | Full 9-stage + optional cage module | LOOSE_REBAR + CAGE_ASSEMBLY if feature on | All recommended | Cards |
| infrastructure | Full 9-stage + optional cage module | LOOSE_REBAR + CAGE_ASSEMBLY if feature on | All recommended | Cards |

### Anti-Double-Counting Rule
If a cage schedule exists with cage marks (e.g., C1-CAGE), those verticals/ties/spirals are exclusively under CAGE_ASSEMBLY. The 9-stage pipeline must skip those bars during loose rebar scanning. This is enforced via prompt instruction in the system prompt.

### Acceptance Tests

**Test A: Residential set + 1 caisson detail**
- Expected: primaryCategory = residential, features.hasCageAssembly = true
- Output: loose rebar elements (footings/walls/mesh) + cage assembly elements (verticals/ties)
- UI: Cards tab default, "Cage Assembly" filter available

**Test B: Pure caisson cage package (2 pages)**
- Expected: primaryCategory = cage_only
- Output: cage elements only
- UI: Bar List tab default, scope locked

**Test C: Bar schedule PDF**
- Expected: primaryCategory = bar_list_only
- Output: parsed table rows
- UI: Bar List tab default, no Cards tab

### What Stays the Same
- Google Vision OCR integration
- Triple OCR pass system
- Validation and pricing edge functions
- Blueprint viewer and overlay system
- Shop drawing feature
- Authentication and database schema (no migrations needed -- estimation_group is in the AI output JSON, not a DB column)

