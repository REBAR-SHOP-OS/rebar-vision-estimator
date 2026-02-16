

## Add "Cage" Element Type to Scope Definition

### What Changes

Add **"Cage"** as a new element type in the scope definition panel, placed under a new **"Assemblies"** category (or under "Structural"). This aligns with the cage estimation logic already built into the system.

### Technical Details

**`src/components/chat/ScopeDefinitionPanel.tsx`**

- Add a new entry to `SCOPE_ITEMS`:
  ```
  { id: "CAGE", label: "Cage", category: "Assemblies" }
  ```
- This will automatically render a new "ASSEMBLIES" category section with the Cage checkbox

**`src/components/chat/DrawingOverlay.tsx`**

- Add a color entry for the new type:
  ```
  CAGE: "#F97316"   (orange, distinct from existing colors)
  ```

No other files need changes -- the element type flows through the existing scope/validation pipeline as a string ID.

