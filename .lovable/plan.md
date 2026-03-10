

## Plan: Add Active Spinning Indicator During Category Processing

### Problem
The sub-step indicator (Parsing → Validating → Ready) only recognizes those three exact strings. During the scope-by-scope loop, `subStep` is set to `"analyzing foundation"` etc., which doesn't match any of the three — so the circles all appear empty/grey with no spinning animation. The user sees a static, dead-looking UI.

### Fix
Update the sub-step indicator UI (lines 1882-1897) to handle the category-loop phase:

1. **When `subStep` starts with `"analyzing"`**, show a dedicated animated indicator:
   - Display the category name (e.g., "Analyzing: Foundation") with a spinning `Loader2` icon
   - Replace the three-dot stepper with a single prominent animated status line

2. **When `subStep` is `"parsing"`, `"validating"`, or `"ready"`**, keep the existing three-step display (already has spin on active step)

### Implementation
**File: `src/components/chat/ChatArea.tsx`** (~10 lines changed in the JSX block at lines 1882-1897)

Replace the current sub-step rendering with:

```tsx
{subStep && (
  <div className="py-2 px-1">
    {subStep.startsWith("analyzing") ? (
      <div className="flex items-center gap-2 text-xs text-primary font-medium">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="capitalize">{subStep.replace("analyzing ", "Analyzing: ")}</span>
        <span className="text-muted-foreground font-normal">— processing scope...</span>
      </div>
    ) : (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {/* existing parsing/validating/ready stepper */}
      </div>
    )}
  </div>
)}
```

### Scope
- 1 file: `src/components/chat/ChatArea.tsx`
- ~12 lines changed in JSX rendering block

