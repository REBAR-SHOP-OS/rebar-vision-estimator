

## Fix: Add Public Read Policy on REBAR SHOP OS Leads Table

The `leads` table in REBAR SHOP OS has RLS policies that only allow **authenticated** users to read. Since our edge function connects with the `anon` key, it gets zero rows.

**The simplest fix**: Add a read-only policy for anonymous access on the `leads` table in the REBAR SHOP OS project. No service role key needed.

### Changes

**In the [REBAR SHOP OS](/projects/ef512187-6c6b-411e-82cc-200307028719) project** (database migration):
```sql
CREATE POLICY "Allow anon read access for leads"
ON public.leads
FOR SELECT
TO anon
USING (true);
```

Also add the same for the `customers` table (since we join on it):
```sql
CREATE POLICY "Allow anon read access for customers"
ON public.customers
FOR SELECT
TO anon
USING (true);
```

**In this project** (`supabase/functions/fetch-pipeline-leads/index.ts`):
- Remove the debug discovery query and `_debug` response field (clean up)
- Keep the targeted `.in("stage", TARGET_STAGES)` query as-is

This approach avoids needing any secret keys -- the anon key will work once the read policy is added.

