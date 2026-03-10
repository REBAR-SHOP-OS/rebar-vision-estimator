

## Plan: Click-to-Preview for Staged Files

### Problem
The staged file thumbnails are too small. Users want to click on a staged file to see a larger preview before sending.

### Changes (single file: `src/components/chat/ChatArea.tsx`)

#### 1. Add preview state
```typescript
const [previewFile, setPreviewFile] = useState<File | null>(null);
```

#### 2. Add a fullscreen preview modal
When `previewFile` is set, render a dialog/overlay showing the image at full size (or file info for non-images) with a close button. Use the existing `Dialog` component from `@/components/ui/dialog`.

#### 3. Make thumbnails clickable
On the staged file thumbnail/row, add `onClick={() => setPreviewFile(file)}` with `cursor-pointer` styling so clicking opens the large preview.

#### 4. No "mark/annotate" — keep it simple
The preview will be view-only (a lightbox). Annotation tools would add significant complexity; a clear full-size preview addresses the core need of "click to view."

### Scope
- 1 file modified, ~25 lines added
- No backend changes

