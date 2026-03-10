

## Fix: PDF Export Shows 404, Excel May Crash

### Root Cause
`exportPdfFile` uses `window.open("", "_blank")` then writes HTML to the new window. In the Lovable preview iframe, this popup either gets blocked or routes through React Router, showing a **404 page** instead of the PDF report.

The second screenshot (image-63) shows the AI responding with a markdown download link — this happens when the user types "export PDF" manually in chat instead of clicking the card button. The card buttons are wired correctly now, but the underlying PDF generation is broken.

### Fix

**File: `src/lib/pdf-export.ts`** — Replace `window.open` approach with a Blob-based download

Instead of opening a new window and writing HTML (which fails in iframe contexts), create an HTML Blob, convert to a downloadable URL, and trigger a download via an anchor click. Then also offer print via an iframe approach.

```typescript
export function exportPdfFile({ quoteResult, elements, scopeData, projectId }: PdfExportParams): void {
  // ... all existing HTML generation stays the same ...
  
  // Replace the window.open approach:
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectSlug}_estimate_report.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

This downloads an HTML file that the user can open in any browser and print to PDF (Ctrl+P → Save as PDF). It works reliably in iframes, popups, and all browsers.

### Scope
- 1 file modified: `src/lib/pdf-export.ts` — replace last 5 lines (window.open/write/print) with blob download
- No new files, no backend changes

