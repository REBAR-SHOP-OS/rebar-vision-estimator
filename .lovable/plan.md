

## Plan: Show Attached Files in Chat Messages After Sending

### Problem
When a user stages a file (e.g., an image) and types a message, clicking send either uploads files OR sends text — never both. The staged file thumbnails disappear from the staging area but never appear in the chat message bubble.

### Changes

#### 1. Add `files` field to Message interface (`ChatArea.tsx`)
Add an optional `files?: { name: string; url: string; type: string }[]` field to the `Message` interface so messages can carry file references.

#### 2. Fix send button to handle both text + files together (`ChatArea.tsx`)
Change `uploadStagedFiles` to:
- Accept the current text input as a parameter
- Create a user message bubble that includes both the text AND file thumbnails
- Clear both `stagedFiles` and `input` together
- Then proceed with file upload + AI analysis

Current (broken):
```typescript
onClick={() => {
  if (stagedFiles.length > 0) uploadStagedFiles();
  else sendMessage();
}}
```

New:
```typescript
onClick={() => {
  if (stagedFiles.length > 0) uploadStagedFiles(input.trim());
  else sendMessage();
}}
```

#### 3. Show file thumbnails in user messages (`ChatMessage.tsx`)
- Add `files` to the message prop interface
- Before the markdown content, render a row of file thumbnails (small image previews for images, file icon + name for non-images)
- Style consistently with the existing staging area look

#### 4. Update `uploadStagedFiles` logic (`ChatArea.tsx`)
- Create thumbnail URLs from staged files using `URL.createObjectURL` before clearing them
- Insert a user message with both `content` (text) and `files` (thumbnail data)
- If text is empty, show just the file names as content (e.g., "📎 image.png")

### Scope
- 2 files modified: `ChatArea.tsx`, `ChatMessage.tsx`
- ~30 lines changed
- No backend changes

