

## Plan: Fix File Upload + Message Not Triggering AI Analysis

### Problem
When a user stages files and types a message, `uploadStagedFiles` uploads files and shows them in chat, but **never triggers AI analysis**. The text input is displayed in the bubble but never sent to `sendMessage()` or `streamAIResponse()`. The AI simply never sees the user's question.

### Root Cause
`uploadStagedFiles` calls `handleFileUpload` (which stores files and populates `uploadedFiles`), but then returns without calling `sendMessage()`. The `sendMessage` function is only called in the else-branch of the send button click.

### Fix (single file: `src/components/chat/ChatArea.tsx`)

#### Modify `uploadStagedFiles` (~line 1161-1188)
After `handleFileUpload` completes and files are stored:
1. If the user typed text AND a `calculationMode` is already set, call `sendMessage(textInput)` to trigger AI analysis with the uploaded file URLs
2. If no calculationMode yet, the existing flow (mode picker shown on next interaction) still works, but the text is preserved as context

The key change:
```typescript
const uploadStagedFiles = async (textInput?: string) => {
  // ... existing file metadata capture & user message creation ...
  
  // Upload files to storage (this populates uploadedFiles)
  await handleFileUpload(...);
  
  // NEW: If user typed a message, trigger AI analysis
  if (textInput && calculationMode) {
    await sendMessage(textInput);
  } else if (textInput && !calculationMode) {
    // No mode yet — show mode picker so user can proceed
    setShowModePicker(true);
  }
};
```

Also need to prevent `sendMessage` from re-adding the user message (since `uploadStagedFiles` already added it). Add a flag or modify `sendMessage` to accept a `skipAddMessage` option, or simply call `streamAIResponse` directly with the text.

#### Prevent duplicate "Uploaded:" messages
`handleFileUpload` currently adds its own "📎 Uploaded: file.png" message (line 1009-1015). When called from `uploadStagedFiles`, this creates a duplicate since we already added the user message with thumbnails. Add a parameter to skip this when called from staging.

### Scope
- 1 file modified: `ChatArea.tsx`
- ~20 lines changed
- No backend changes

