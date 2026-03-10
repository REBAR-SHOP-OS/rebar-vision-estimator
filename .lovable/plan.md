

## Plan: Disable Auto-Start Smart Calculation

### Problem
When a blueprint is uploaded and detection confidence is >= 0.7, the system automatically skips the Mode Picker and starts Smart Calculation. The user wants to always see the Mode Picker so they can choose.

### Change — `src/components/chat/ChatArea.tsx`

**Lines 1123-1161**: Remove the auto-proceed branch. Instead, always show the Scope Definition Panel / Mode Picker regardless of confidence. Keep the auto-scope building and system message for high-confidence detections (so the user sees what was detected), but stop short of calling `handleModeSelect("smart")`.

Replace the `if (confidence >= AUTO_THRESHOLD)` block so that:
1. High confidence still auto-fills scope data (saves the user from manual entry)
2. A system message still reports what was detected
3. But the Mode Picker is shown (`setShowModePicker(true)`) instead of auto-triggering smart mode
4. Remove the early `return` so it falls through to the normal panel display

### Scope
- 1 file: `src/components/chat/ChatArea.tsx` (~15 lines changed)
- No backend changes

