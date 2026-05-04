-- ============================================================================
-- Canonical schema for a Trust-First / pipeline-style Lovable app.
-- Run this once in a fresh Lovable Cloud project (via the migration tool).
-- Domain-specific tables are NOT included — add them after this baseline.
-- ============================================================================

-- ── Roles enum + table (NEVER store roles on profiles) ─────────────────────
do $$ begin
  create type public.app_role as enum ('admin', 'reviewer', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "users read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

-- ── Profiles ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "profiles readable by owner" on public.profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "profiles updatable by owner" on public.profiles
  for update to authenticated using (auth.uid() = user_id);
create policy "profiles insertable by owner" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── updated_at helper ──────────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ── Projects ───────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  client_name text,
  status text default 'draft',
  workflow_status text default 'in_progress',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;

create policy "projects rw by owner" on public.projects
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger projects_updated_at before update on public.projects
  for each row execute function public.update_updated_at_column();

-- ── Project files (uploads metadata) ───────────────────────────────────────
create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  byte_size bigint,
  sha256 text,
  created_at timestamptz not null default now()
);
alter table public.project_files enable row level security;

create policy "project_files rw by owner" on public.project_files
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Audit events ───────────────────────────────────────────────────────────
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete cascade,
  action text not null,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;

create policy "audit readable by owner" on public.audit_events
  for select to authenticated using (auth.uid() = user_id);
create policy "audit insertable by owner" on public.audit_events
  for insert to authenticated with check (auth.uid() = user_id);

-- ── Storage bucket + RLS (private, user/project pathed) ────────────────────
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
  on conflict (id) do nothing;

create policy "uploads owner read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "uploads owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "uploads owner update" on storage.objects for update to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "uploads owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]);