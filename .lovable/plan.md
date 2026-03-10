

## Patch: Fix JSON Extraction Failure + Async Post-Processing Pipeline

### Part A: Fix "Estimation completed but structured output was not returned"

**File 1: `supabase/functions/analyze-blueprint/index.ts`** (lines 645-700)
- Remove contradictory line 655 ("At the VERY END of your response")
- Remove the triple-backtick wrapper around the marker example (lines 657, 697)
- Add explicit instruction: "Do NOT wrap markers in markdown code fences"
- Result: one clear directive — JSON block with markers goes FIRST

**File 2: `src/components/chat/ChatArea.tsx`** — `extractAtomicTruthJSON` (lines 477-490)
- Before returning null, strip markdown code fences from content and retry marker search
- In `processAtomicTruth` fallback (lines 612-625): add aggressive regex to find any JSON object containing `"elements"` array (not just ````json` blocks)
- Log first 500 chars when extraction fails for debugging

### Part B: Async Post-Processing Pipeline (perceived speed improvement)

**File 3: `src/components/chat/ChatArea.tsx`** — `handleModeSelect` (lines 628-714) and `processAtomicTruth`

Current blocking flow:
```text
streamAI → processAtomicTruth → runValidation → [user waits for everything]
```

New flow:
```text
streamAI → extractJSON → setValidationData(raw) → render immediately
         └─ background: runValidation() → update validationData
         └─ background: triggerLearning()
         └─ background: DB message save
```

Changes:
- In `processAtomicTruth`: immediately set raw extracted data into state so UI renders element cards before validation completes
- Add a `processingSubStep` state: `"parsing" | "validating" | "dedupe-scan" | "ready"` 
- Run `runValidation` as a background update — when it returns, merge validated statuses into already-rendered elements
- Move `triggerLearning` and DB message save to fire-and-forget (already partially done, just ensure they don't block)
- DB message insert already doesn't block UI (no await needed for non-critical path)

**File 4: `src/components/chat/ChatArea.tsx`** — new sub-step progress indicator

- Add state: `const [subStep, setSubStep] = useState<string | null>(null)`
- Show a small inline progress strip below the chat during post-processing:
  - ✅ Parsing — ⏳ Validating — ○ Dedupe Scan — ○ Ready
- Clear when all background tasks complete

### What becomes async/background
| Step | Before | After |
|------|--------|-------|
| AI streaming | Blocking | Blocking (must be) |
| JSON extraction | Blocking | Blocking (instant, <1ms) |
| Initial render | After validation | **Immediate after extraction** |
| Validation (runValidation) | Blocking | Background → merges into UI |
| Learning extraction | Fire-and-forget | Fire-and-forget (no change) |
| DB message save | Awaited | Fire-and-forget |

### What remains blocking
- AI streaming (unavoidable — it produces the data)
- JSON marker extraction (instant — not a bottleneck)

### Data integrity risks
- **None.** Validation still runs fully — it just updates the UI after initial render instead of blocking it. Elements render with a "validating..." badge until validation completes and merges gate statuses.

### Files changed summary
1. `supabase/functions/analyze-blueprint/index.ts` — prompt fix (remove contradiction, clean marker example)
2. `src/components/chat/ChatArea.tsx` — parser hardening + async post-processing + sub-step progress state

