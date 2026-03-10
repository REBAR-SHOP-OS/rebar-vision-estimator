

## Plan: Fix Download PDF & Excel — Real File Downloads

### Problem
1. **PDF button** sends `sendMessage("Export to PDF")` which triggers an AI chat response with markdown text instead of generating an actual PDF file
2. **Excel button** crashes when `quoteResult.quote` is undefined (restored projects have a different data shape)
3. Output format must match the uploaded reference workbook (20_york-3.xlsx): Sheet 1 = Estimate Summary with side-by-side weight tables + notes + mesh; Sheet 2 = Bar List with 13-column grouped table

### Changes

**1. New file: `src/lib/pdf-export.ts`**

Extract the PDF HTML generation from `ExportButtons.tsx` lines 47-278 into a standalone exported function:

```typescript
export function exportPdfFile(params: { quoteResult: any; elements: any[]; scopeData?: any; projectId?: string }): void
```

This function opens a print window with the same HTML report currently in `ExportButtons.handlePdfExport`. No logic changes to the PDF HTML itself — it already matches the reference format (Estimate Summary page + Bar List page).

**2. File: `src/components/chat/ChatArea.tsx`** (3 lines changed)

- Import `exportPdfFile` from `@/lib/pdf-export`
- Line 1604-1608: Replace both export handlers with guarded calls:

```typescript
} else if (card.action === 'exportExcel') {
  if (!quoteResult?.quote) {
    toast.error("Complete estimation first to export");
    return;
  }
  exportExcelFile({ quoteResult, elements: validationData?.elements || [], scopeData });
  toast.success("Excel exported");
} else if (card.action === 'exportPdf') {
  if (!quoteResult?.quote) {
    toast.error("Complete estimation first to export");
    return;
  }
  exportPdfFile({ quoteResult, elements: validationData?.elements || [], scopeData, projectId: currentProjectId });
  toast.success("PDF exported");
}
```

**3. File: `src/components/chat/ExportButtons.tsx`**

- Import `exportPdfFile` from `@/lib/pdf-export`
- Replace the ~230-line inline `handlePdfExport` method body with a one-liner call to `exportPdfFile({ quoteResult, elements, scopeData, projectId })`

### Scope
- 1 new file: `src/lib/pdf-export.ts`
- 2 files modified: `ChatArea.tsx`, `ExportButtons.tsx`
- No database or backend changes

