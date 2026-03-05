

## Plan: ERP Pipeline Learning Sync + Click-to-Dig Lead Detail Panel

### What We're Building

Two features that turn completed ERP pipeline leads into learning data for the estimator:

1. **Lead Detail Edge Function** (`fetch-lead-details`) — fetches a single lead's full payload from the Rebar Shop OS database: lead fields, chatter/messages (via `lead_messages` or `mail.message` in Odoo), and attachments with download URLs.

2. **Click-to-Dig Side Panel** (`LeadDetailPanel`) — when a user clicks a lead row in `CrmSyncPanel`, a slide-out panel shows: chatter timeline, attachments list with preview links, extracted summary, and a "Use as Estimation Context" button that pushes the case into the active estimator session.

3. **Force Sync / Learn from Pipeline** (`learn-from-pipeline`) — an edge function that queries leads in outcome stages (`delivered_pickup_done`, `won`, `no_rebars_out_of_scope`), builds `case_record` objects (lead fields + files metadata + outcome label), and stores them as `learned` entries in `agent_knowledge`.

4. **Agent Brain Rule** — auto-insert the "ERP Pipeline Sync + Click-to-Dig Learning" rule into `agent_knowledge` so the AI knows how to use pipeline cases.

### Architecture Reality Check

The Rebar Shop OS backend is a **Supabase database** at `rzqonxnowjrtbueauziu.supabase.co`, not Odoo directly (the Odoo connection is only used for file attachments via `proxy-crm-file`). So:

- Lead list, chatter, and files metadata are queryable via the Supabase client with the existing anon key
- We need to discover what tables exist for chatter/messages on that remote DB — the `lead_messages` or `lead_notes` table name needs to be confirmed
- File binary downloads for Odoo-hosted attachments still go through `proxy-crm-file`

### Technical Details

**1. New Edge Function: `fetch-lead-details`**

Queries the remote Rebar Shop OS Supabase for a single lead by ID:
- `leads` table: full row with customer join
- `lead_files` table: all attachments for the lead
- `lead_messages` or equivalent: chatter/notes timeline (needs table name — will attempt `lead_messages` and gracefully degrade)
- Returns structured JSON with lead, attachments, and messages

**2. New Edge Function: `learn-from-pipeline`**

- Queries leads in learning stages: `delivered_pickup_done`, `won`, `no_rebars_out_of_scope`
- For each, builds a case_record with: lead_id, title, customer, stage, timestamps, files metadata, outcome label (SUCCESS/FAIL)
- Upserts into `agent_knowledge` with `type = 'learned'`, deduplicating by lead_id in content
- Returns count of new cases learned

**3. New Component: `LeadDetailPanel`**

- Slide-out Sheet triggered by clicking a lead row in `CrmSyncPanel`
- Sections: Lead Info, Chatter Timeline (chronological), Attachments (with download/preview), Actions
- "Use as Estimation Context" button calls `onStartEstimationWithFiles` with lead data
- "Learn from This Lead" button calls `learn-from-pipeline` for a single lead

**4. CrmSyncPanel Updates**

- Add click handler on lead rows to open `LeadDetailPanel`
- Add "Force Sync Learning" button in header that calls `learn-from-pipeline` for all outcome-stage leads
- Add learning stages to the stage color map

**5. Config**

- Add `fetch-lead-details` and `learn-from-pipeline` to `supabase/config.toml` with `verify_jwt = false`

### Files

- **New**: `supabase/functions/fetch-lead-details/index.ts`
- **New**: `supabase/functions/learn-from-pipeline/index.ts`
- **New**: `src/components/crm/LeadDetailPanel.tsx`
- **Modified**: `src/components/crm/CrmSyncPanel.tsx` (click-to-dig + force sync button)
- **Modified**: `supabase/config.toml` (2 new function entries)

No database migrations needed — uses existing `agent_knowledge` table for learned cases.

