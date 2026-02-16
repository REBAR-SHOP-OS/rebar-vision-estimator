

## Upgrade Suggestion Chips to Visual Idea Cards

### Problem
The current suggestion chips are plain text pills that feel vague and easy to miss. Users need clearer, more visual prompts that explain what each action does.

### Solution
Replace the single-line text chips with a grid of small **idea cards**, each containing an icon, a bold title, and a short description line. This makes the options self-explanatory and impossible to misunderstand.

### Visual Layout

Each card is a compact rounded box (~140px wide) with:
- An icon at the top (from lucide-react)
- A bold 1-2 word title
- A muted one-line description underneath

Cards sit in a horizontally scrollable row above the input, or wrap into a 2x2 grid on wider screens.

### Card Content by State

**No files uploaded:**
| Icon | Title | Description |
|---|---|---|
| Upload | Upload PDF | Drop your blueprint here |
| FileQuestion | File Types | See supported formats |
| Sparkles | How It Works | Learn about AI detection |

**Files uploaded, no mode selected:**
| Icon | Title | Description |
|---|---|---|
| Zap | Smart Analysis | Auto-detect and estimate |
| ListChecks | Step-by-Step | Review each element |
| HelpCircle | What's Detected? | Preview element types |

**Results available:**
| Icon | Title | Description |
|---|---|---|
| Table | Bar List | View full rebar table |
| Download | Export Excel | Download spreadsheet |
| AlertTriangle | Review Flags | Check flagged items |
| RefreshCw | Recalculate | Update with your edits |

**AI asks confirmation question:**
| Icon | Title | Description |
|---|---|---|
| CheckCircle | Yes, Proceed | Continue to next step |
| SlidersHorizontal | Adjust Scope | Change element types |
| Plus | Add More | Include more elements |

### Technical Details

| File | Change |
|---|---|
| `src/components/chat/ChatArea.tsx` | Replace the plain `button` chips (lines 904-961) with styled card components. Each card uses a `div` with icon + title + description, arranged in a `flex gap-2 overflow-x-auto` container. Cards have `border border-border rounded-xl p-3 min-w-[130px]` styling with hover effects (`hover:border-primary/50 hover:bg-primary/5`). Icons rendered from lucide-react at `h-4 w-4`. Title is `text-xs font-semibold`, description is `text-[10px] text-muted-foreground`. Click behavior unchanged (autoSend for confirmations, setInput for others, file picker for upload). |

Single file change only.

