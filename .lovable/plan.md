

## Plan: Add Download PDF & Excel Buttons to Confirmation Cards

### Problem
When the AI shows a report with a confirmation question ("do you agree / proceed?"), the user only sees "Yes, Proceed", "Adjust Scope", and "Add More" action cards. The user wants "Download PDF" and "Download Excel" buttons in this same row so they can export the report at this stage.

### Changes

**File: `src/components/chat/ChatArea.tsx`**

1. Import `exportExcelFile` from `@/lib/excel-export` and add `FileText`, `FileSpreadsheet` to the lucide imports.

2. In the `hasConfirmQuestion` cards array (~line 1558-1563), add two new cards with a custom `action` type that directly triggers the export functions instead of sending a chat message:

```typescript
cards = [
  { icon: 'CheckCircle', title: 'Yes, Proceed', ... },
  { icon: 'SlidersHorizontal', title: 'Adjust Scope', ... },
  { icon: 'Plus', title: 'Add More', ... },
  { icon: 'FileText', title: 'Download PDF', description: 'Export PDF report', sendText: '', action: 'exportPdf' },
  { icon: 'FileSpreadsheet', title: 'Download Excel', description: 'Export spreadsheet', sendText: '', action: 'exportExcel' },
];
```

3. Add `FileText` and `FileSpreadsheet` to the `iconMap` object (~line 1585).

4. Update the card `onClick` handler (~line 1596-1601) to handle the new action types:
   - `exportPdf`: Call `handlePdfExport()` — extract the inline PDF generation logic from `ExportButtons.tsx` into a shared utility, or replicate a simpler version that uses the current `quoteResult`, `validationData`, and `scopeData` state.
   - `exportExcel`: Call `exportExcelFile({ quoteResult, elements: validationData?.elements || [], scopeData })`.

5. Since `quoteResult` may not exist yet at the confirmation stage (it's set after pricing), the export buttons will only render when `quoteResult` is available. Add a condition: only include the download cards if `quoteResult` exists.

6. Update the `IdeaCard` type's `action` union to include `'exportPdf' | 'exportExcel' | 'upload'`.

### Scope
- 1 file modified: `src/components/chat/ChatArea.tsx`
- No new files, no backend changes

