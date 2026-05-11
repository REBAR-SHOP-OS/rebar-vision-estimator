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

create index verified_estimate_results_project_current_idx on public.verified_estimate_results (project_id, is_current);
create index verified_estimate_results_project_created_idx on public.verified_estimate_results (project_id, created_at desc);

alter table public.verified_estimate_results enable row level security;

create policy "owners read verified_estimate_results" on public.verified_estimate_results
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners insert verified_estimate_results" on public.verified_estimate_results
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "owners update verified_estimate_results" on public.verified_estimate_results
  for update to authenticated
  using (auth.uid() = user_id);