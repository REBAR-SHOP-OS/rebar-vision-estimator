

## Smarter Project Type Detection and Category-Specific Estimation

Enhance the detection edge function and analysis pipeline to be truly intelligent about project categories -- especially Cage projects -- and enforce Canadian RSIC standards when detected.

---

### Problem

The detection function exists but its prompt is generic. When a cage project is uploaded, the system needs to:
1. Confidently detect "Cage" and pre-select only COLUMN + PIER scope items
2. Adapt the entire estimation approach for cage assembly (verticals, ties, spirals, cage marks)
3. Apply RSIC Canadian rules automatically when metric sizes are found

Currently the detection prompt is too brief and the analysis prompt treats all project types similarly.

---

### Changes

**1. Enhance `detect-project-type` edge function prompt**

Make the detection prompt much more specific with clear indicators for each category:
- **Cage**: Look for column cage schedules, "cage" labels, prefab marks (e.g., C1-CAGE), tied assemblies, cage height/diameter callouts, spiral details, shop drawing format
- **Bar List**: No drawings -- just tables with bar marks, sizes, quantities, cut lengths
- **Residential**: Strip footings, ICF, SOG, basement walls, light bars (10M-20M)
- **Industrial**: Heavy footings, equipment pads, 25M+ bars, crane beams
- **Commercial**: Multi-storey columns, flat slabs, parking, drop panels
- **Infrastructure**: Bridges, abutments, retaining walls, MTO/OPSS references

Add a secondary check: if OCR text contains "cage", "spiral", "tied assembly" keywords, boost cage confidence.

**2. Add cage-specific estimation rules to `analyze-blueprint`**

Add a new `CAGE_PROJECT_RULES` constant with detailed instructions:
- Focus on cage assembly output: cage mark, vertical bar count/size, tie size/spacing, cage height, cage diameter/dimensions
- Calculate tie quantity = (cage_height / tie_spacing) + 1
- Calculate tie perimeter from column dimensions minus 80mm per RSIC
- Include spiral calculations if present
- Output format: one row per cage type (not per column instance)
- Multiply cage weights by quantity of that cage type
- Include shop bending details (offset bends for verticals, hooks for ties)

When `scope.detectedCategory === "cage"`, prepend these rules to the system prompt.

**3. Add category-specific prompt reinforcement blocks**

For each detected category, inject a focused instruction block into the system prompt:
- **Cage**: "This is a CAGE project. Focus exclusively on cage assemblies..."
- **Residential**: "This is a RESIDENTIAL project. Focus on footings, walls, SOG mesh..."
- **Industrial**: "This is an INDUSTRIAL project. Focus on heavy foundations..."
- **Bar List**: "This is a BAR LIST project. Parse the table directly, skip OCR element detection..."
- **Infrastructure**: "This is an INFRASTRUCTURE project. Check for DOT specs..."

**4. Improve scope panel feedback for cage detection**

When cage is detected, show a specific note: "Cage project detected -- only Column and Pier elements are relevant. The estimator will focus on cage assembly details (verticals, ties, spirals)."

---

### Technical Details

| File | Changes |
|---|---|
| `supabase/functions/detect-project-type/index.ts` | Enhanced detection prompt with keyword boosting; more specific category indicators; add cage-specific OCR keyword search before AI call |
| `supabase/functions/analyze-blueprint/index.ts` | New `CAGE_PROJECT_RULES` constant; category-specific prompt blocks injected based on `scope.detectedCategory`; cage output format (cage mark, qty, verticals, ties, height, weight per cage) |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Category-specific help text in detection banner (e.g., cage-specific note about assembly focus); show detected standard more prominently |

### Flow for Cage Project

1. User uploads cage blueprint PDF
2. `detect-project-type` runs OCR, finds keywords like "cage", "spiral", "tied assembly", column schedules
3. Returns `{ category: "cage", recommendedScope: ["COLUMN", "PIER"], detectedStandard: "canadian_metric", confidence: 0.95 }`
4. Scope panel shows only COLUMN + PIER pre-checked, banner says "Cage Project (Canadian Metric)"
5. User confirms, picks mode
6. `analyze-blueprint` receives `detectedCategory: "cage"`, injects `CAGE_PROJECT_RULES` into prompt
7. AI focuses on cage assemblies: cage marks, vertical counts, tie calculations, spiral data
8. Output includes per-cage-type weight breakdown with RSIC rules applied
