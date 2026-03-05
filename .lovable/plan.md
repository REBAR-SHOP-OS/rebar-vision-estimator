

## Plan: Fix CRM File Downloads via Server-Side Proxy

### Problem
When clicking "Start" on a CRM lead with attachments, the browser tries to fetch files directly from Odoo URLs (`rebarshop-24-rebar-shop.odoo.com/web/content/...`). These fail due to CORS restrictions -- browsers block cross-origin requests to Odoo. All 4 fetch attempts for "110 Mornelle Court" failed with "Failed to fetch".

### Solution
Create a proxy edge function in this project that fetches Odoo files server-side (no CORS issues), then update the Dashboard to route downloads through it.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/proxy-crm-file/index.ts` | **New** -- accepts a `url` query param, fetches it server-side, streams binary back with correct Content-Type and CORS headers |
| `supabase/config.toml` | Add `[functions.proxy-crm-file]` with `verify_jwt = false` (public proxy limited to Odoo domain) |
| `src/pages/Dashboard.tsx` | Change `fetch(att.url)` (line 381) to `supabase.functions.invoke("proxy-crm-file", ...)` passing the Odoo URL, then convert the response to a File object |

### How the Proxy Works
- Validates the URL points to the known Odoo instance (`rebarshop-24-rebar-shop.odoo.com`) to prevent open-proxy abuse
- Fetches the file server-side (no CORS)
- Returns the binary with proper Content-Type header
- If Odoo requires session auth, falls back to JSON-RPC via the REBAR SHOP OS `odoo-file-proxy` using the odoo_id extracted from the URL

### Result
Clicking "Start" on any lead with attachments will successfully download the PDFs and feed them into the auto-estimation pipeline.

