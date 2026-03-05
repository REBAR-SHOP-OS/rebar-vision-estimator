

## Plan: Fix CRM File Discovery in Edge Function

### Problem
The edge function queries `lead-files` storage bucket at path `{lead_id}/` but returns zero attachments for all leads. The files visible in your CRM chatter (e.g., "110 Mornelle. Slab Strengthening...", "MORNELLE COURT_Estimation File...") are stored somewhere else -- likely in a different table or bucket path from the Odoo sync.

### Solution
Update `fetch-pipeline-leads` edge function to **discover** where files live by:

1. **Try multiple storage buckets** -- list all available buckets in REBAR SHOP OS and check each for files under the lead ID
2. **Query attachment-related tables** -- try `lead_attachments`, `attachments`, `mail_attachments`, `chatter_attachments`, or similar tables that Odoo sync may have created
3. **Log what's found** so we can see exactly what tables/buckets exist and where files are

### File to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-pipeline-leads/index.ts` | Add bucket discovery (list all buckets), try querying common attachment table names, add detailed logging |

### What This Gives Us
After deploying, the edge function logs will tell us exactly where the chatter files are stored, and we can then wire up the correct query path. This is a one-time discovery step -- once we find the right source, we'll hardcode that path.

