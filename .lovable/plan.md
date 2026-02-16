

## UI Design Overhaul -- Beam AI-Inspired Stepped Workflow

A comprehensive redesign of the application's UI to create a polished, professional rebar estimation experience inspired by Beam AI's clean stepped workflow interface.

---

### Design Philosophy

The reference images show Beam AI uses a **numbered step-based workflow** with expandable/collapsible accordion steps, clean cards, and a main content area showing the active step. The current app uses a chat-based flow which works, but the UI needs polish and a more structured visual hierarchy.

---

### 1. Dashboard Welcome Screen Redesign

Replace the basic centered text with a professional landing:
- Large hero area with the app logo and tagline
- 4-step visual process guide (like Beam AI's left column):
  1. "Upload your plans in PDF format"
  2. "Confirm the scope of work"
  3. "AI does the rebar takeoff"
  4. "Get QA-reviewed results"
- Each step is a rounded card with a circled number, title, and expand/collapse chevron
- Animated entrance for each step card
- A prominent "Start New Estimation" CTA button

**File**: `src/pages/Dashboard.tsx` -- Replace the welcome `else` block

---

### 2. Sidebar Modernization

Clean up the sidebar with better visual hierarchy:
- Branded header section with logo + app name (not just in the top bar)
- Project list with better status indicators (colored dot: green = complete, amber = in progress, gray = new)
- Step progress redesigned as a vertical timeline with connecting lines (not just a list)
- Smooth animated transitions for sidebar open/close
- Better visual grouping with subtle section dividers

**Files**: `src/pages/Dashboard.tsx`, `src/components/chat/StepProgress.tsx`

---

### 3. Step Progress -- Vertical Timeline Redesign

Replace the flat list with a **connected vertical timeline** (inspired by Beam AI's numbered steps):
- Each step is a circle connected by a vertical line
- Completed steps: filled green circle with checkmark, solid connecting line
- Active step: pulsing ring animation, highlighted label
- Pending steps: empty circle with dashed connecting line
- Processing phase text appears as a subtitle under the active step
- Overall progress bar at the top remains but is styled as a thin accent bar

**File**: `src/components/chat/StepProgress.tsx`

---

### 4. Chat Area -- Upload & Empty State Redesign

Redesign the empty chat state to match Beam AI's upload experience:
- Large dashed-border drop zone area ("Drag and drop your files here or click to choose files")
- File type icons (PDF, DWG) inside the drop zone
- After upload, files shown as horizontal chips/tags (like Beam AI shows uploaded project tabs)
- Drag-and-drop support on the entire chat area (not just the file input)
- Upload progress as a slim animated bar inside the drop zone

**File**: `src/components/chat/ChatArea.tsx`

---

### 5. Scope Definition Panel -- Beam AI-Inspired Layout

Redesign to match the reference images:
- Step number badge at the top ("2" in a circle) with title "Confirm Your Project Scope"
- Scope item checkboxes in a clean 2-column grid with category headers
- "Please Confirm Your Scope" helper text box (like Beam's blue info panel)
- Right-side reference panel for "Included Items" (scrollable list showing what each scope item includes)
- Better visual separation between sections using subtle dividers
- Deviations box styled as a distinct card with placeholder examples

**File**: `src/components/chat/ScopeDefinitionPanel.tsx`

---

### 6. Calculation Mode Picker -- Card Redesign

Polish the mode selection cards:
- Larger cards with more prominent icons
- Subtle gradient background on hover
- Selected state with primary border + check icon
- Add estimated time labels ("~2 min" for Smart, "~10 min" for Step-by-Step)
- Add a brief bullet list of what each mode does

**File**: `src/components/chat/CalculationModePicker.tsx`

---

### 7. Chat Messages -- Better Typography & Spacing

- Increase message padding and add subtle left border for assistant messages
- Better code block styling with copy button
- Improved table rendering within markdown
- Typing indicator animation (three bouncing dots) during streaming
- Timestamp shown on hover

**File**: `src/components/chat/ChatMessage.tsx`

---

### 8. Validation Results -- Dashboard-Style Cards

Redesign the results view:
- Summary section as large stat cards in a responsive grid (Total Weight, Elements, Confidence)
- Element cards with better visual hierarchy and subtle shadows
- Animated confidence bars with color transitions (red to yellow to green)
- Collapsible groups with smooth animation and element count badges
- Export buttons section as a distinct footer card with larger, more prominent buttons (matching Beam AI's export icons: PDF, Excel, Share link, Screenshot)

**Files**: `src/components/chat/ValidationResults.tsx`, `src/components/chat/ExportButtons.tsx`

---

### 9. Input Bar -- Modern Chat Input

Redesign the bottom input bar:
- Rounded pill-shaped input with inner shadow
- File attachment button with tooltip
- Send button with smooth color transition
- "Powered by AI" badge instead of plain text
- Keyboard shortcut hint (Shift+Enter for new line)

**File**: `src/components/chat/ChatArea.tsx`

---

### 10. Global Styling Improvements

- Add subtle animations for page transitions (fade-in on route change)
- Improve the blueprint grid background (lighter, less busy)
- Better dark mode contrast for all new components
- Add glass-morphism effects to key cards (scope panel, mode picker, results)
- Consistent border-radius across all cards (rounded-xl)
- Better focus states and keyboard navigation indicators

**File**: `src/index.css`

---

### 11. Auth Page Polish

- Add a subtle animated background (slowly moving blueprint grid)
- Better form field styling with floating labels
- Social login button placeholders (Google, Microsoft)
- "Forgot password?" link

**File**: `src/pages/AuthPage.tsx`

---

### Technical Details -- Files & Changes

| File | Changes |
|---|---|
| `src/pages/Dashboard.tsx` | Welcome screen redesign with 4-step visual guide; sidebar branded header with project status dots |
| `src/components/chat/StepProgress.tsx` | Complete rewrite as vertical connected timeline with circles, lines, and animations |
| `src/components/chat/ChatArea.tsx` | Drag-and-drop upload zone; file chips display; modern input bar; typing indicator |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Beam AI-inspired layout with step badge, info panel, included items reference sidebar |
| `src/components/chat/CalculationModePicker.tsx` | Larger cards with gradients, time estimates, bullet features |
| `src/components/chat/ChatMessage.tsx` | Better spacing, left border accent, hover timestamps, typing dots |
| `src/components/chat/ValidationResults.tsx` | Stat card grid, animated confidence bars, smoother collapsibles |
| `src/components/chat/ExportButtons.tsx` | Larger icon buttons matching Beam AI export style (PDF icon, Excel icon, share) |
| `src/components/chat/QuestionCard.tsx` | Better styling with colored severity indicators |
| `src/components/chat/SizeBreakdownTable.tsx` | Zebra-striped rows, colored percentage bars |
| `src/index.css` | New animation keyframes, glass-card improvements, refined blueprint background |
| `src/pages/AuthPage.tsx` | Animated background, polished form |

### Implementation Order

1. Global CSS improvements (index.css) -- foundation for everything
2. StepProgress timeline redesign
3. Dashboard welcome screen + sidebar polish
4. ChatArea upload zone + input bar
5. ScopeDefinitionPanel Beam-style layout
6. CalculationModePicker cards
7. ChatMessage styling
8. ValidationResults + ExportButtons dashboard cards
9. QuestionCard + SizeBreakdownTable polish
10. AuthPage refinements

