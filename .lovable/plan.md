

## Plan: Auto-Fetch CRM Lead Files and Start Pipeline Automatically

### What's Happening Now
When you click "Start" on a CRM lead (e.g., "110 Mornelle Court"), the system creates a project but lands on a blank upload screen. It does not attempt to find or fetch any files associated with that lead from your CRM/REBAR SHOP OS.

### What Needs to Change

**1. Update `fetch-pipeline-leads` edge function to also query for lead attachments**
- Query the REBAR SHOP OS for any `lead_attachments`, `documents`, or storage files linked to the lead's `id`
- Return attachment URLs alongside lead data so the frontend knows if files exist

**2. Update `CrmSyncPanel.tsx` — pass attachment info when starting estimation**
- When `startEstimationFromLead` is called, pass any discovered file URLs to the Dashboard
- Add a new prop `onStartEstimationWithFiles` that includes file metadata

**3. Update `Dashboard.tsx` — auto-download CRM files and trigger pipeline**
- When a lead has attachments: fetch them as blobs, create `File` objects, set as `initialFiles`, and navigate to ChatArea (which will auto-detect + auto-analyze via the existing auto-flow)
- When a lead has NO attachments: still create the project but show a toast: "No files found in CRM for this lead. Upload blueprints to begin."

**4. Update `ChatArea.tsx` — handle pre-fetched CRM files same as uploaded files**
- The existing auto-proceed logic (confidence >= 0.7 → skip scope → Smart mode) already handles this. No change needed here.

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-pipeline-leads/index.ts` | Query for lead attachments/documents from REBAR SHOP OS |
| `src/components/crm/CrmSyncPanel.tsx` | Pass attachment URLs when starting estimation |
| `src/pages/Dashboard.tsx` | Auto-download CRM files → set as initialFiles → trigger full auto pipeline |

### Important Question
Before implementing: does the REBAR SHOP OS have a table for lead attachments or documents (e.g., `lead_attachments`, `documents`, `lead_documents`)? Or are files stored in a Supabase storage bucket tied to the lead ID? I need to know the exact schema of where files live in your CRM system to wire this up correctly.

