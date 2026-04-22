

# Fix "verified_estimate_results table not found" error

## Root cause

The `OutputsTab` export flow (and the verified-estimate store) reads/writes a `verified_estimate_results` table that was never created in the database. Every Export / AI Visual click hits PostgREST, which returns:

> Could not find the table 'public.verified_estimate_results' in the schema cache

Other referenced tables (`export_jobs`, `reference_answer_lines`, `estimation_validation_rules`, `document_sheets`) are already wrapped in `try/catch` or treated as optional, so they don't break exports — only `verified_estimate_results` does.

## Fix (single migration, no code changes)

Create the missing table with the exact columns the store reads/writes:

```sql
create table public.verified_estimate_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  version_number int not null default 1,
  status text not null check (status in ('draft','verified','blocked')),
  result_json jsonb not null,
  content_hash text not null,
  inputs_hash text,
  blocked_reasons jsonb default '[]'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index on public.verified_estimate_results (project_id, is_current);
create index on public.verified_estimate_results (project_id, created_at desc);

alter table public.verified_estimate_results enable row level security;

-- Owner-scoped policies (same model as other project-owned tables)
create policy "owners read" on public.verified_estimate_results
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners insert" on public.verified_estimate_results
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "owners update" on public.verified_estimate_results
  for update to authenticated
  using (auth.uid() = user_id);
```

## What this unblocks

- `Export` for Estimate Summary, Shop Drawings, AI Visual Draft will stop throwing the schema-cache error.
- `Refresh canonical estimate` will successfully persist a snapshot.
- `getCurrentVerifiedEstimate()` will return a row instead of failing.

## Files touched

- New migration only. **No TypeScript changes.** The store already uses `(supabase as any).from("verified_estimate_results")` so generated types don't need to know about the table.

## Out of scope (intentionally)

- `export_jobs`, `reference_answer_lines`, `estimation_validation_rules`, `document_sheets` — already optional in code; leave for a future task if you want them tracked.

