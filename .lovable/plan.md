

## Plan: Update reporting-and-results knowledge entry

Update the `features/reporting-and-results` memory entry to accurately reflect the current export format:

- Excel: 2 primary sheets (Estimate Summary, Bar List) + 3 optional power-user sheets (Reconciliation, Audit Trace, Raw JSON)
- PDF: Same 2-section layout
- Bar List identification format: `{size} @ {spacing} {description}`

This is a knowledge/memory update only — no code changes.

**File: `src/components/chat/BrainKnowledgeDialog.tsx`** or via the Brain Knowledge UI — update the `features/reporting-and-results` entry text to:

> Estimation results are managed via a tabbed interface and finalized through a multi-format export engine (SYSTEM_PATCH v2026.03.UI_EXPORT):
> - UI Interaction: Structured JSON is hidden in a collapsible "Structured JSON Output" accordion (collapsed by default) with a copy-to-clipboard button and monospace viewer.
> - Layout: Both Excel and PDF formats mirror a two-section structure: 'Estimate Summary' (project headers and side-by-side weight reports by size and element) and 'Bar List' (a detailed 13-column takeoff table).
> - Bar List Format: The 'Identification' column follows the specific format: '{size} @ {spacing} {description}'.
> - Excel Export: Generates a workbook with 2 primary sheets (Estimate Summary, Bar List) plus 3 optional power-user sheets (Reconciliation, Audit Trace, Raw JSON), named '{project_name}_estimate_export.xlsx'.
> - PDF Export: A professional report ('{project_name}_estimate_report.pdf') using portrait layout by default, with landscape support for table overflow and an optional JSON appendix.
> - Safety: If an estimate is BLOCKED or FLAGGED, mandatory warning banners are injected into all exports. Action buttons follow the order: View JSON, Export PDF, Export Excel.

### Scope
- 1 database record updated (brain_knowledge table, key `features/reporting-and-results`)
- No code file changes

