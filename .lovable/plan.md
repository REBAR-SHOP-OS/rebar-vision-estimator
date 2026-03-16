

# Restructure Scope to "Follow the Concrete" — 5 Construction Buckets

## What Changes

### 1. Reorganize `SCOPE_ITEMS` into 5 Construction Buckets (`ScopeDefinitionPanel.tsx`)

Replace the current 4 abstract categories (Foundation, Structural, Walls, Other, Assemblies) with 5 construction-sequence buckets and add missing element types:

```text
Current (4 categories, 14 items):
  Foundation: FOOTING, GRADE_BEAM, RAFT_SLAB, PIER
  Structural: BEAM, COLUMN, SLAB, STAIR
  Walls: WALL, RETAINING_WALL, ICF_WALL, CMU_WALL
  Other: WIRE_MESH
  Assemblies: CAGE

New (5 buckets, 22 items):
  Bucket 1 — Substructure & Deep Foundations:
    PILE, CAISSON, GRADE_BEAM, FOOTING, RAFT_SLAB, PIER, ELEVATOR_PIT, SUMP_PIT

  Bucket 2 — Slab-on-Grade & Flatwork:
    SLAB_ON_GRADE, THICKENED_EDGE, TRENCH_DRAIN, EQUIPMENT_PAD, WIRE_MESH

  Bucket 3 — Superstructure:
    COLUMN, BEAM, ELEVATED_SLAB, STAIR, SHEAR_WALL, CAGE

  Bucket 4 — Masonry / CMU:
    CMU_WALL, BOND_BEAM, MASONRY_DOWEL

  Bucket 5 — Site, Civil & Landscape:
    RETAINING_WALL, ICF_WALL, LIGHT_POLE_BASE, TRANSFORMER_PAD, SITE_PAVING
```

### 2. Update the detection prompt (`detect-project-type/index.ts`)

- Add the new element IDs to the `recommendedScope` enum in the tool schema
- Update the detection prompt to use the "Follow the Concrete" methodology — instruct the AI to find every concrete element across S, A, C, L, MEP drawings and classify into the 5 buckets
- Add new keyword signals for the added element types (elevator pit, trench drain, equipment pad, etc.)

### 3. Update the analysis prompt (`analyze-blueprint/index.ts`)

- Add new `element_type` values to the ElementUnit schema enum
- Add the "3-Way Match" instruction to the master prompt: for every concrete element found, check (1) Plan View for location/quantity, (2) Section/Detail for shape, (3) General Notes for defaults
- Add the 5-bucket construction sequence to the scope discovery stage (Stage 1)
- Update `estimation_group` to support bucket-level grouping

### 4. Update scope-by-scope processing (`ChatArea.tsx`)

- The scope-by-scope iterative processing groups by `item.category` — these will now be the 5 bucket names, so each bucket gets its own focused AI pass
- Update `SCOPE_ITEMS` import references to work with new IDs

### 5. Fix the "No scope detected" bottom message

- The bottom status message appears because `scopeSourceType` defaults to `"none"` in certain render paths. Pass detection state properly so the message disappears once drawings are uploaded and detection completes.

### 6. Backward compatibility

- Keep old IDs (FOOTING, SLAB, WALL, etc.) as aliases mapped to new bucket items so existing saved projects don't break
- The `buildScopeFromDetection` function will map to new bucket structure

### Files Modified
- `src/components/chat/ScopeDefinitionPanel.tsx` — new SCOPE_ITEMS with 5 buckets, 22 elements
- `supabase/functions/detect-project-type/index.ts` — updated prompt + tool schema with new element IDs
- `supabase/functions/analyze-blueprint/index.ts` — 3-Way Match methodology + new element types in schema
- `src/components/chat/ChatArea.tsx` — fix scopeSourceType propagation

