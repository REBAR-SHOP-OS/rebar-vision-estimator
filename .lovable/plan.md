

## Smart Project Type Detection and Adaptive Scope

Make the app intelligently detect the project type after file upload and automatically adapt the scope panel, workflow, and estimation approach.

---

### Problem

Currently, after uploading files, all 13 element types are pre-selected regardless of project type. For a **Cage** project, only Columns (and maybe Piers) are relevant. For a **Residential** project, Wire Mesh, Footings, and Walls dominate. The scope panel doesn't adapt, and "Cage" isn't even a project type option.

---

### Solution: Two-Phase Smart Detection

**Phase 1 -- Quick Pre-Analysis (new edge function)**

After files are uploaded but BEFORE showing the scope panel, run a fast AI call to detect the project type from the blueprints. This returns:
- Detected project category (Cage, Industrial, Residential, Commercial, Bar List, Infrastructure)
- Recommended scope items (which element types are relevant)
- Detected standard (Metric/Imperial, Canadian/US)
- Confidence level

**Phase 2 -- Adaptive Scope Panel**

The scope panel pre-selects only the relevant items and shows the detected project type, with an info banner explaining what was detected and why.

---

### Changes

**1. New Edge Function: `detect-project-type`**

A lightweight, non-streaming edge function that:
- Takes the uploaded file URLs
- Runs a quick Vision OCR scan (reusing existing Google Vision logic)
- Sends a focused prompt to Gemini Flash (fast, cheap) asking ONLY for project type detection
- Returns structured JSON: `{ category, recommendedScope, detectedStandard, confidence }`
- Uses tool calling for structured output (no JSON parsing issues)

**2. Update `ScopeDefinitionPanel.tsx`**

- Accept new props: `detectedCategory`, `recommendedScope`, `detectedStandard`
- Pre-select only recommended scope items (instead of all 13)
- Show a detection banner: "Detected: **Cage Project** (Canadian Metric) -- scope adjusted automatically"
- Add "Cage" and "Infrastructure" to the Project Type dropdown
- If detected standard is metric, show a note about RSIC rules being applied
- User can still override and select/deselect any items

**3. Update `ChatArea.tsx`**

- After file upload completes, call `detect-project-type` edge function
- Show a brief loading state: "Analyzing project type..."
- Pass detection results to `ScopeDefinitionPanel`
- Include detected category in the scope data sent to the main analysis

**4. Update `analyze-blueprint` edge function**

- Accept `detectedCategory` in the scope object
- Use it to reinforce the system prompt: "This project has been pre-classified as [CATEGORY]. Prioritize this classification unless blueprints clearly indicate otherwise."

---

### Project Type Scope Mappings

| Category | Pre-Selected Elements |
|---|---|
| Cage | Columns, Piers/Pedestals |
| Residential | Footings, Walls, ICF Walls, Slabs, Wire Mesh |
| Commercial | Footings, Beams, Columns, Slabs, Walls, Stairs |
| Industrial | Footings, Grade Beams, Beams, Columns, Walls, Retaining Walls |
| Infrastructure | Footings, Retaining Walls, Walls, Grade Beams, Slabs |
| Bar List | All items (user picks from parsed list) |

---

### Technical Details

| File | Changes |
|---|---|
| `supabase/functions/detect-project-type/index.ts` | New edge function -- quick AI call with tool calling for structured project type detection |
| `supabase/config.toml` | Add `[functions.detect-project-type]` with `verify_jwt = false` |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Accept detection props, pre-select recommended scope, show detection banner, add Cage/Infrastructure to Project Type dropdown |
| `src/components/chat/ChatArea.tsx` | Call detect-project-type after upload, pass results to scope panel, include in scope data |
| `supabase/functions/analyze-blueprint/index.ts` | Accept and use `detectedCategory` from scope to reinforce system prompt |

### Flow

1. User uploads blueprint files
2. Files upload to storage, signed URLs generated
3. App calls `detect-project-type` with file URLs (shows "Analyzing project type..." spinner)
4. Edge function runs quick Vision OCR + Gemini Flash analysis (~5-10 seconds)
5. Returns detected category + recommended scope
6. Scope panel appears with only relevant items pre-checked and detection banner
7. User confirms/adjusts scope, picks mode
8. Main analysis runs with both user scope AND detected category for reinforcement
