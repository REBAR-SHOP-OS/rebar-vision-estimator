

# Multi-Select Rebar Coating

## Problem
Currently, rebar coating is single-select (radio behavior using Checkbox). The user wants to select **all** coating types to detect which ones are present in the drawings.

## Changes

### `src/components/chat/ScopeDefinitionPanel.tsx`

1. **Change state from `string` to `string[]`**:
   - `rebarCoating: string` → `rebarCoatings: string[]`
   - Default: `["black_steel"]`
   - Auto-detection sets detected coating in the array alongside black_steel

2. **Update checkbox to multi-select toggle**:
   - `checked={rebarCoatings.includes(coating.id)}`
   - `onCheckedChange` toggles the coating in/out of the array (ensure at least one stays selected)

3. **Update `ScopeDefinition` interface**:
   - `rebarCoating: string` → `rebarCoating: string | string[]` (backward compatible)

4. **Update `handleLockScope`** to pass the array in `onScopeConfirmed`

5. **Add "Select All" checkbox** at the top of the coating grid to toggle all 4 coatings on/off

### Downstream
- `ChatArea.tsx` and `analyze-blueprint` already receive `rebarCoating` as a string in the scope payload — update to handle array (join with comma or pass as array). The analysis prompt should check for all selected coatings.

