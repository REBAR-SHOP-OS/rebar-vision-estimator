## Goal

Keep the app running on Lovable Cloud (primary, unchanged) and maintain a **read-only mirror** of every table in your own Supabase project (`aogvxeiltgsyxdndvwja`) so you have full Supabase dashboard access to a complete copy of the data.

## Decisions (assumed — tell me to change before approving)

- **Direction:** one-way, Cloud → mirror. The app never reads/writes the mirror. Safer, no conflicts.
- **Frequency:** hourly. Adjustable later.
- **Scope:** all 36 public tables (full row mirror, not schema-only).
- **Storage / Auth users / Edge Functions:** NOT mirrored in v1. Only Postgres data. (Auth users and Storage objects can be added in a v2 if needed — they require separate flows.)

## Secrets you'll provide (I'll request via add_secret after approval)

1. `MIRROR_SUPABASE_URL` = `https://aogvxeiltgsyxdndvwja.supabase.co` (already have)
2. `MIRROR_SUPABASE_SERVICE_ROLE_KEY` — Supabase project → Project Settings → API Keys → `service_role` (secret)
3. `MIRROR_SUPABASE_DB_URL` — Project Settings → Database → Connection string → URI (`postgresql://postgres:<pwd>@db.aogvxeiltgsyxdndvwja.supabase.co:5432/postgres`)

Anon key is not needed since the app never reads the mirror.

## One-time setup you do in your Supabase project

Before the sync runs, the mirror needs the same schema as Cloud. Two options:

- **Option A (recommended):** I generate a single SQL file with the full schema (tables, RLS policies, functions, triggers, enums) extracted from Cloud. You paste it into your Supabase SQL editor and run once. Takes ~2 min.
- **Option B:** You run `pg_dump --schema-only` against Cloud and `psql` it into your project. Requires CLI access; equivalent result.

## Implementation (after approval + secrets)

1. **New edge function `mirror-sync`** (`supabase/functions/mirror-sync/index.ts`)
   - Runs with `verify_jwt = false` + a shared-secret header so only cron can call it.
   - For each table in a hard-coded list (the 36 public tables), in dependency order:
     - Reads rows from Cloud changed since `last_sync_at` (uses `created_at` / `updated_at` where available, full-table refresh for tables without timestamps — small ones only).
     - Upserts into mirror via `service_role` key, using primary key `id`.
   - Writes a row to a new local table `mirror_sync_runs` (started_at, finished_at, rows_per_table jsonb, error).

2. **New table `mirror_sync_runs`** in Cloud (small bookkeeping table, RLS off, only edge function writes it).

3. **Cron schedule** via `pg_cron` + `pg_net` — fires `mirror-sync` hourly.

4. **Settings page panel** (`/settings` or Cloud view → small "Mirror status" card): shows last run time, row counts, last error. Read-only.

## What this plan does NOT do

- Does not migrate auth users (passwords can't be exported in plaintext; Supabase has a separate "Auth migration" flow if you need it later).
- Does not mirror Storage bucket files (would need a separate `storage.objects` walker — can be added in v2).
- Does not sync deletes by default. Hard-deletes in Cloud will leave stale rows in the mirror. If you want deletes mirrored, say so and I'll add a soft-delete tracker or a periodic full-diff pass (more expensive).
- Does not change anything about how the app reads/writes data today. Zero risk to the live app.

## Rollback

The mirror is additive. To undo: delete the cron job, delete the `mirror-sync` function, drop `mirror_sync_runs`. The app is unaffected.

## What I need from you to proceed

1. **Approve this plan** (or tell me what to change — direction, frequency, scope, deletes, etc.).
2. After approval, in build mode I will:
   - Request the 2 missing secrets via `add_secret`
   - Generate the schema-mirror SQL file and tell you to run it in your Supabase SQL editor
   - Build the edge function, cron job, bookkeeping table, and status panel
