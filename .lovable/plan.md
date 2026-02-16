

## Add Contextual Suggestion Chips Above Chat Input

### What This Does
Adds a row of clickable suggestion chips (ideas/prompts) just above the chat input bar. These give users quick actions they can tap instead of typing, adapting based on the current state of the conversation.

### Suggestion Categories

**When no files uploaded yet:**
- "Upload a blueprint PDF"
- "What file types are supported?"
- "How does the AI detection work?"

**When files uploaded but no mode selected (scope/mode picking phase):**
- "Start step-by-step analysis"
- "What elements can you detect?"
- "Explain the estimation process"

**When analysis is running or results are available:**
- "Show me the bar list"
- "Export to Excel"
- "Review flagged elements"
- "Recalculate with edits"

**When the AI asks a confirmation question (like "Do you agree with this scope?"):**
- "Yes, proceed to next stage"
- "I need to adjust the scope"
- "Add more element types"

### Visual Design
- Small rounded pill-shaped chips in a horizontally scrollable row
- Subtle border, muted text, hover highlights to primary color
- Positioned directly above the input bar (inside the bottom input section)
- Chips auto-hide when the user starts typing

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatArea.tsx` | Add a suggestion chips section above the input bar that renders context-aware suggestions based on current state (uploadedFiles, calculationMode, validationData, messages). Clicking a chip sets the input text and optionally auto-sends it. Chips hidden when `input` is non-empty or `loading` is true. |

No new files needed -- this is a self-contained addition to the input area in ChatArea.tsx.

