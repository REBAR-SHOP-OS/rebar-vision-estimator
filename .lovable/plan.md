

## Add Cage Element and Fix Right Panel Scrolling

### What's Already Done
The **Cage** element type with its **Assemblies** category and orange color-coding (`#F97316`) has already been added in the previous changes to `ScopeDefinitionPanel.tsx` and `DrawingOverlay.tsx`. No further changes needed there.

### Remaining Change: Right Panel Text Layout

The right-side chat panel (visible when the Blueprint Viewer is open in split mode) currently constrains content to `max-w-3xl` (768px) and uses `overflow-y-auto`, causing unnecessary scrolling and wasted horizontal space.

**Fix in `src/components/chat/ChatArea.tsx`:**

- Remove or relax the `max-w-3xl` constraint on the messages container when in split-panel mode, so text fills the available width
- Keep vertical scroll functional but improve content density so less scrolling is needed

**Fix in `src/components/chat/ChatMessage.tsx`:**

- Tighten prose spacing (reduce vertical margins on paragraphs, lists, headings) to make content more compact
- Ensure long text wraps properly with `break-words` to avoid horizontal overflow

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatArea.tsx` | Change `max-w-3xl` to `max-w-none` inside the messages container div (line 713) so content uses full panel width in split view |
| `src/components/chat/ChatMessage.tsx` | Add `break-words` and tighten prose spacing classes for more compact, readable text that fills the panel |

