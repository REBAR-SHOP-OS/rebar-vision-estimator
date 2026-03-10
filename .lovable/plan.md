

## Plan: Add Paste and Drag-and-Drop File Support to Chat Input

### Problem
The chat input area only supports file uploads via the paperclip button. Users cannot paste files/images from clipboard or drag-and-drop files onto the input area.

### Changes (single file: `src/components/chat/ChatArea.tsx`)

#### 1. Add `onPaste` handler to textarea
Intercept paste events, extract files from `clipboardData`, and feed them through the existing `handleFileUpload` logic:

```typescript
const handlePaste = (e: React.ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    e.preventDefault();
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    handleFileUpload({ target: { files: dt.files } } as any);
  }
};
```

#### 2. Add drag-and-drop handlers on the input container div
Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` to the input wrapper div (line 1684). Show a visual drop indicator with a state variable `isDragging`:

- `onDragOver`/`onDragEnter`: prevent default, set `isDragging = true`
- `onDragLeave`: set `isDragging = false`
- `onDrop`: extract files from `e.dataTransfer.files`, feed through `handleFileUpload`, set `isDragging = false`
- Apply a highlight border style (`ring-2 ring-primary`) when `isDragging` is true

#### 3. Wire up
- Add `const [isDragging, setIsDragging] = useState(false);` state
- Add `onPaste={handlePaste}` to the textarea element
- Add drag handlers + conditional styling to the input container div

### Scope
- 1 file modified: `ChatArea.tsx`
- ~30 lines added
- No backend changes

