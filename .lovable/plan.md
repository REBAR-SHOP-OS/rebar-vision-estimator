
## Make Chat Messages More Visual with Proper Table Rendering

### Problem
AI messages contain markdown tables (pipe-delimited `| col | col |` format) but they render as plain unstyled text. The "Finder Pass" results and element tables look like a wall of text instead of clean, structured tables.

### Changes

**1. Add table rendering to ChatMessage.tsx**

Update the `ReactMarkdown` component to use custom `components` prop that renders `table`, `thead`, `tbody`, `tr`, `th`, and `td` elements with proper styling:

- Tables get rounded borders, alternating row colors, and proper padding
- Headers get a muted background with bold text
- Cells get consistent padding and border separators
- Code spans inside tables stay readable
- Tables are wrapped in a scrollable container for wide content

**2. Improve overall prose styling**

- Tighten up the prose classes so headings, lists, and paragraphs have better spacing
- Add `prose-table` overrides so tables integrate with the existing dark/light theme
- Bold text and inline code get slightly better contrast

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatMessage.tsx` | Add `components` prop to `ReactMarkdown` with custom renderers for `table`, `thead`, `tbody`, `tr`, `th`, `td`. Wrap tables in `overflow-x-auto` container. Style with Tailwind classes: rounded borders, `bg-muted/30` header, `text-xs` cells, alternating `even:bg-muted/20` rows. Also add renderers for `strong` (slightly bolder color) and `p` (better margin). |

This is a single-file change that dramatically improves readability of all AI responses containing tables.
