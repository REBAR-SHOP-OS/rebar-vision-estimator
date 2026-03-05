

## Plan: Fully Automated Estimation Pipeline (Upload → Detect → Scope → Analyze)

### Current Flow (requires 4+ manual clicks)
1. User uploads files → sees Scope Definition Panel → manually confirms scope
2. User clicks "Proceed" → sees Calculation Mode Picker → picks Smart/Step-by-Step
3. AI analysis begins

### New "Fully Auto" Flow (zero clicks after upload)
1. User uploads files
2. System auto-detects project type (already happens)
3. System auto-accepts detected scope + defaults to Smart mode
4. System immediately shows a **confirmation toast/banner**: "Detected: Commercial project, 18.33 tonnes. Auto-analyzing with Smart mode. [Cancel]"
5. AI analysis streams automatically
6. User can interrupt/adjust at any time

### Implementation

**1. ChatArea.tsx — Auto-proceed after detection completes**

After `setDetectionResult(result)` in `handleFileUpload` (~line 725), instead of just showing the scope panel and waiting, auto-build scope data from detection result and immediately trigger analysis:

- If detection confidence >= 0.7: skip scope panel, skip mode picker, auto-set `scopeData` from detection result's `recommendedScope`, auto-set `calculationMode = "smart"`, and call `handleModeSelect("smart")` directly
- If detection confidence < 0.7: fall back to current manual flow (show scope panel)
- Show a system message: "🤖 Auto-detected: [category] project. Starting Smart estimation... (say 'stop' to cancel)"

**2. ScopeDefinitionPanel — Add auto-accept helper**

Add a static method or exported utility function `buildScopeFromDetection(result: DetectionResult): ScopeData` that creates scope data from a detection result without user interaction.

**3. Dashboard.tsx — No changes needed**

The `handleNewProjectFileSelect` already passes files to ChatArea via `initialFiles`. The auto-flow triggers inside ChatArea after upload completes.

### Files to Modify

| File | Change |
|------|--------|
| `src/components/chat/ChatArea.tsx` | Add auto-proceed logic after detection, skip scope panel + mode picker when confidence is high |
| `src/components/chat/ScopeDefinitionPanel.tsx` | Export `buildScopeFromDetection()` utility |

### Safety Rails
- Confidence threshold (0.7) prevents auto-proceeding on ambiguous drawings
- System message clearly states what was auto-detected
- User can type "stop" or "adjust scope" to interrupt
- All auto-decisions are logged as system messages in the chat
