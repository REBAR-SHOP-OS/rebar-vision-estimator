

## Fetch Pending Pipeline Leads from REBAR SHOP OS

### Problem

The CRM Deals panel shows "No deals found" because the `crm_deals` table in this project is empty. The actual pipeline data (leads with stages) lives in the **REBAR SHOP OS** project on a separate database (`rzqonxnowjrtbueauziu.supabase.co`). The `leads` table there has 29 pipeline stages including estimation, quotation, qualified, and other active stages.

### Solution

Create an edge function that connects to the REBAR SHOP OS database, fetches all leads in non-terminal stages (i.e., not won/lost/archived/merged), and returns them. Update the CRM panel to call this function instead of querying the local `crm_deals` table.

### What Changes

#### 1. New Edge Function: `fetch-pipeline-leads`

- Connects to REBAR SHOP OS Supabase using its URL and anon key (stored as secrets)
- Queries the `leads` table filtering OUT terminal stages: `won`, `lost`, `loss`, `merged`, `archived_orphan`, `delivered_pickup_done`, `no_rebars_out_of_scope`
- Returns: `id`, `title`, `stage`, `expected_value`, `expected_close_date`, `priority`, `probability`, `source`, `created_at`, `customer_id` joined with `customers.name` and `customers.company_name`
- Orders by `expected_value` descending (highest value leads first)

#### 2. Secrets Required

- `REBAR_SHOP_OS_SUPABASE_URL` = `https://rzqonxnowjrtbueauziu.supabase.co`
- `REBAR_SHOP_OS_SUPABASE_ANON_KEY` = the anon key from REBAR SHOP OS

#### 3. Update CrmSyncPanel

- Replace direct `crm_deals` table query with a call to `fetch-pipeline-leads` edge function
- Update the table columns to show: Lead Title, Company, Expected Value, Stage (with color-coded badge matching REBAR SHOP OS stage colors), Priority, Close Date
- Keep the "Link to Project" functionality (writes to local `estimate_outcomes` table using the lead ID as `crm_deal_id`)
- Add a refresh button to re-fetch from the pipeline

#### 4. Stage Color Mapping

Import the stage definitions from REBAR SHOP OS (29 stages with colors) to render proper colored badges in the CRM panel. Non-terminal stages that represent "pending" work:

- Prospecting, New, Telephonic Enquiries
- QC/Estimation stages (Ben, Karthick, Others, Partha)
- Hot Enquiries, Qualified, RFI, Addendums
- Quotation Priority, Quotation Bids
- Shop Drawing, Fabrication, Ready to Dispatch, Out for Delivery

### Implementation Order

1. Store REBAR SHOP OS credentials as edge function secrets
2. Create `fetch-pipeline-leads` edge function
3. Update `CrmSyncPanel` to call the edge function and display pipeline leads with stage badges

