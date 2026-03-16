

# Fix: "No Scope Detected" Warning Showing During Active Detection

## Problem
The screenshot shows both messages simultaneously:
- "No scope detected" (amber warning)
- "Analyzing blueprints to detect project type..." (green spinner)

The detection **is working** — edge function logs confirm it successfully detected "residential" with cage assembly signals. The bug is purely UI timing.

## Root Cause
In `ChatArea.tsx` line 2004:
```typescript
scopeSourceType={detectionResult ? "detected" : "none"}
```
While detection is in progress (`isDetecting=true`), `detectionResult` is still `null`, so `scopeSourceType="none"`. In `ScopeDefinitionPanel.tsx`, the warning renders when `scopeSourceType === "none"` (line