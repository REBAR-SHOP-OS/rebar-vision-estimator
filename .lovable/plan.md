

## Plan: Always Show Brain Knowledge Count Badge

### Problem
The brain icon's count badge only appears after clicking it because knowledge data is fetched only when the dialog opens (`useEffect` fires on `open && user`). Before clicking, `items` is empty so the badge shows nothing.

### Fix (single file: `src/components/chat/BrainKnowledgeDialog.tsx`)

#### 1. Fetch counts on mount (not just when dialog opens)
Add a separate `useEffect` that runs on component mount (when `user` is available) to load the item counts, so the badge is visible immediately without opening the dialog.

Change line 64-69 from:
```typescript
useEffect(() => {
  if (open && user) {
    loadItems();
    loadTrainingExamples();
  }
}, [open, user]);
```

To:
```typescript
// Load counts on mount so badge is always visible
useEffect(() => {
  if (user) {
    loadItems();
    loadTrainingExamples();
  }
}, [user]);

// Refresh when dialog opens
useEffect(() => {
  if (open && user) {
    loadItems();
    loadTrainingExamples();
  }
}, [open]);
```

### Scope
- 1 file, ~3 lines changed
- No backend changes
- Badge will show the correct count immediately on page load

