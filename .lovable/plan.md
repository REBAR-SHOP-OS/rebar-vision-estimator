

## Plan: Fix ODOO_URL Parsing in Proxy Edge Function

### Problem
The `ODOO_URL` secret was stored with internal spaces (e.g., `https:// rebarshop-24-rebar-shop .odoo.com`). The current code only `.trim()`s the edges, so `new URL(...)` throws "Invalid URL".

### Fix
One change in `supabase/functions/proxy-crm-file/index.ts`:

| Line | Current | New |
|------|---------|-----|
| 17 | `url: new URL(rawUrl.trim()).origin` | `url: new URL(rawUrl.replace(/\s+/g, "")).origin` |

This strips **all** whitespace from the stored secret before parsing, handling both edge and internal spaces.

### Verification
After the fix, I will curl the edge function with a test `odoo_id` to confirm it no longer throws "Invalid URL" and can reach Odoo's JSON-RPC endpoint.

