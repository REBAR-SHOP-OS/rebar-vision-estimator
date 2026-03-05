

## Filter Pipeline Leads to Specific Stages

The user wants to fetch leads only from these 4 pipeline stages (visible in the screenshot):
- **Estimation - Ben**
- **Estimation - Karthick**  
- **Hot Enquiries**
- **Qualified**

### Changes

**`supabase/functions/fetch-pipeline-leads/index.ts`**
- Replace the current "exclude terminal stages" filter with an "include only" filter for these 4 stages:
  - `estimation_ben`
  - `estimation_karthick`
  - `hot_enquiries`
  - `qualified`
- Use `.in("stage", [...])` instead of `.not("stage", "in", ...)`

**`src/components/crm/CrmSyncPanel.tsx`**
- Trim `PIPELINE_STAGES` map to only these 4 stages
- Update badge text to "X leads" instead of "X pending"

