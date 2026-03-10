

## Fix: Export Cards Still Sending Chat Messages Instead of Downloading Files

### Problem
There are **two sets** of action cards in `ChatArea.tsx`. The first set (lines 1565-1568, shown when `hasConfirmQuestion` is true) was fixed to use `action: 'exportPdf'` and `action: 'exportExcel'`. But the **second set** (lines 1570-1576, shown when `validationData || quoteResult` without a confirm question) still has:
- `{ sendText: 'Export to Excel' }` — sends a chat message instead of downloading
- No PDF export card at all

This is the set the user keeps seeing, which is why clicking "Export Excel" sends a message and gets an AI response with copy-paste text.

### Fix

**File: `src/components/chat/ChatArea.tsx`** — lines 1571-1576

Replace the second card set to include proper `action` triggers:

```typescript
cards = [
  { icon: 'Table', title: 'Bar List', description: 'View full rebar table', sendText: 'Show me the bar list' },
  { icon: 'FileText', title: 'Download PDF', description: 'Export PDF report', sendText: '', action: 'exportPdf' as const },
  { icon: 'FileSpreadsheet', title: 'Download Excel', description: 'Export spreadsheet', sendText: '', action: 'exportExcel' as const },
  { icon: 'RefreshCw', title: 'Recalculate', description: 'Update with your edits', sendText: 'Recalculate with edits' },
];
```

### Scope
- 1 file, 4 lines changed in `ChatArea.tsx`
- No new files, no backend changes

