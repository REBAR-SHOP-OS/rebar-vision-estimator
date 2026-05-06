-- Rebar MVP schema foundation
-- Adds a parallel canonical schema for the estimating workflow so the current
-- public-schema app can keep running while new MVP-aligned flows are wired in.

create extension if not exists pgcrypto;

create schema if not exists rebar;
grant usage on schema rebar to authenticated;

do $$
begin
  create type rebar.file_kind as enum (
    'structural_pdf',
    'architectural_pdf',
    'addendum_pdf',
    'spec_pdf',
    'bar_list',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.project_status as enum (
    'intake',
    'processing',
    'qa_review',
    'approved',
    'quoted',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.sheet_category as enum (
    'foundation_plan',
    'slab_plan',
    'wall_section',
    'grade_beam_detail',
    'schedule',
    'notes',
    'general',
    'unknown'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.element_type as enum (
    'footing',
    'wall',
    'slab',
    'pier',
    'grade_beam',
    'column',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.shape_type as enum (
    'straight',
    'stirrup',
    'dowel',
    'hook',
    'bend',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.takeoff_status as enum (
    'queued',
    'processing',
    'ready_for_review',
    'needs_attention',
    'approved',
    'superseded'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.warning_code as enum (
    'missing_sheet',
    'unclear_scale',
    'not_found_on_drawings',
    'low_confidence',
    'conflicting_revision',
    'missing_spec',
    'manual_override'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.approval_status as enum (
    'pending',
    'approved',
    'rejected',
    'changes_requested'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.export_format as enum (
    'xlsx',
    'pdf',
    'share_link'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type rebar.quote_status as enum (
    'draft',
    'approved_internal',
    'issued',
    'accepted',
    'declined',
    'expired'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists rebar.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists rebar.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references rebar.organizations(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'estimator',
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists rebar.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references rebar.organizations(id) on delete cascade,
  project_number text,
  project_name text not null,
  customer_name text,
  estimator_id uuid references rebar.users(id),
  location text,
  tender_due_at timestamptz,
  status rebar.project_status not null default 'intake',
  concrete_grade text,
  rebar_grade text,
  bid_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rebar_projects_org_status on rebar.projects (organization_id, status);

create table if not exists rebar.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references rebar.projects(id) on delete cascade,
  file_kind rebar.file_kind not null,
  storage_path text not null,
  original_filename text not null,
  revision_label text,
  checksum_sha256 text,
  uploaded_by uuid references rebar.users(id),
  page_count integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_rebar_project_files_project_kind on rebar.project_files (project_id, file_kind);

create table if not exists rebar.drawing_sheets (
  id uuid primary key default gen_random_uuid(),
  project_file_id uuid not null references rebar.project_files(id) on delete cascade,
  page_number integer not null,
  sheet_number text,
  sheet_name text,
  detected_category rebar.sheet_category not null default 'unknown',
  discipline text,
  revision_label text,
  scale_text text,
  scale_confidence numeric(5,4),
  notes_found boolean not null default false,
  ocr_text text,
  preview_image_path text,
  created_at timestamptz not null default now(),
  unique (project_file_id, page_number)
);

create index if not exists idx_rebar_drawing_sheets_file_category on rebar.drawing_sheets (project_file_id, detected_category);

create table if not exists rebar.drawing_detections (
  id uuid primary key default gen_random_uuid(),
  drawing_sheet_id uuid not null references rebar.drawing_sheets(id) on delete cascade,
  detection_type text not null,
  label text not null,
  value_text text,
  page_region jsonb,
  confidence numeric(5,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_rebar_drawing_detections_sheet_type on rebar.drawing_detections (drawing_sheet_id, detection_type);

create table if not exists rebar.rebar_weight_reference (
  bar_size text primary key,
  kg_per_m numeric(10,3) not null,
  is_locked boolean not null default true,
  created_at timestamptz not null default now(),
  check (bar_size in ('10M', '15M', '20M', '25M', '30M', '35M'))
);

insert into rebar.rebar_weight_reference (bar_size, kg_per_m)
values
  ('10M', 0.785),
  ('15M', 1.570),
  ('20M', 2.355),
  ('25M', 3.925),
  ('30M', 5.495),
  ('35M', 7.850)
on conflict (bar_size) do update
set kg_per_m = excluded.kg_per_m,
    is_locked = true;

create table if not exists rebar.takeoff_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references rebar.projects(id) on delete cascade,
  source_revision_label text,
  parser_provider text not null default 'gemini',
  ocr_provider text not null default 'google_vision',
  status rebar.takeoff_status not null default 'queued',
  overall_confidence numeric(5,4),
  missing_sheet_warning boolean not null default false,
  unclear_scale_warning boolean not null default false,
  not_found_warning boolean not null default false,
  requested_by uuid references rebar.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_rebar_takeoff_runs_project_status on rebar.takeoff_runs (project_id, status);

create table if not exists rebar.takeoff_items (
  id uuid primary key default gen_random_uuid(),
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete cascade,
  drawing_sheet_id uuid references rebar.drawing_sheets(id),
  element_type rebar.element_type not null,
  shape_type rebar.shape_type not null,
  bar_size text not null references rebar.rebar_weight_reference(bar_size),
  spacing_text text,
  quantity numeric(12,2) not null default 0,
  multiplier numeric(12,4) not null default 1.0000,
  cut_length_m numeric(12,3) not null default 0,
  total_length_m numeric(14,3) generated always as (quantity * multiplier * cut_length_m) stored,
  kg_per_m numeric(10,3) not null,
  total_weight_kg numeric(14,3) generated always as (quantity * multiplier * cut_length_m * kg_per_m) stored,
  drawing_reference text,
  confidence numeric(5,4),
  source_text text,
  extraction_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (bar_size in ('10M', '15M', '20M', '25M', '30M', '35M'))
);

create index if not exists idx_rebar_takeoff_items_run_bar on rebar.takeoff_items (takeoff_run_id, bar_size);
create index if not exists idx_rebar_takeoff_items_run_element on rebar.takeoff_items (takeoff_run_id, element_type);

create table if not exists rebar.takeoff_warnings (
  id uuid primary key default gen_random_uuid(),
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete cascade,
  takeoff_item_id uuid references rebar.takeoff_items(id) on delete cascade,
  warning_code rebar.warning_code not null,
  severity text not null default 'warning',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_rebar_takeoff_warnings_run on rebar.takeoff_warnings (takeoff_run_id);

create table if not exists rebar.takeoff_assumptions (
  id uuid primary key default gen_random_uuid(),
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete cascade,
  assumption_text text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists rebar.takeoff_exclusions (
  id uuid primary key default gen_random_uuid(),
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete cascade,
  exclusion_text text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists rebar.human_reviews (
  id uuid primary key default gen_random_uuid(),
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete cascade,
  reviewer_id uuid not null references rebar.users(id),
  approval_status rebar.approval_status not null default 'pending',
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  unique (takeoff_run_id, reviewer_id)
);

create table if not exists rebar.manual_adjustments (
  id uuid primary key default gen_random_uuid(),
  takeoff_item_id uuid not null references rebar.takeoff_items(id) on delete cascade,
  adjusted_by uuid not null references rebar.users(id),
  old_quantity numeric(12,2),
  new_quantity numeric(12,2),
  old_cut_length_m numeric(12,3),
  new_cut_length_m numeric(12,3),
  old_bar_size text,
  new_bar_size text,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists rebar.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references rebar.projects(id) on delete cascade,
  takeoff_run_id uuid not null references rebar.takeoff_runs(id) on delete restrict,
  version_number integer not null,
  quote_status rebar.quote_status not null default 'draft',
  quote_number text,
  prepared_by uuid references rebar.users(id),
  approved_by uuid references rebar.users(id),
  approved_at timestamptz,
  subtotal_weight_kg numeric(14,3) not null default 0,
  total_weight_kg numeric(14,3) not null default 0,
  total_weight_tonnes numeric(14,3) generated always as (total_weight_kg / 1000.0) stored,
  assumptions_snapshot jsonb not null default '[]'::jsonb,
  exclusions_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create index if not exists idx_rebar_estimate_versions_project on rebar.estimate_versions (project_id, version_number desc);

create table if not exists rebar.estimate_exports (
  id uuid primary key default gen_random_uuid(),
  estimate_version_id uuid not null references rebar.estimate_versions(id) on delete cascade,
  export_format rebar.export_format not null,
  storage_path text,
  share_token uuid default gen_random_uuid(),
  created_by uuid references rebar.users(id),
  created_at timestamptz not null default now()
);

create table if not exists rebar.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references rebar.projects(id) on delete cascade,
  takeoff_run_id uuid references rebar.takeoff_runs(id) on delete set null,
  assistant_name text not null default 'Gauge',
  created_by uuid references rebar.users(id),
  created_at timestamptz not null default now()
);

create table if not exists rebar.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references rebar.assistant_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  message_text text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function rebar.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function rebar.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = rebar, public
as $$
  select u.organization_id
  from rebar.users u
  where u.id = auth.uid()
  limit 1
$$;

create or replace function rebar.can_access_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = rebar, public
as $$
  select exists (
    select 1
    from rebar.projects p
    join rebar.users u on u.organization_id = p.organization_id
    where p.id = project_uuid
      and u.id = auth.uid()
  )
$$;

drop trigger if exists trg_rebar_projects_updated_at on rebar.projects;
create trigger trg_rebar_projects_updated_at
before update on rebar.projects
for each row execute function rebar.set_updated_at();

create or replace view rebar.v_takeoff_summary_by_bar_size as
select
  ti.takeoff_run_id,
  ti.bar_size,
  sum(ti.total_length_m) as total_length_m,
  sum(ti.total_weight_kg) as total_weight_kg
from rebar.takeoff_items ti
group by ti.takeoff_run_id, ti.bar_size;

create or replace view rebar.v_takeoff_summary_by_element as
select
  ti.takeoff_run_id,
  ti.element_type,
  sum(ti.total_length_m) as total_length_m,
  sum(ti.total_weight_kg) as total_weight_kg
from rebar.takeoff_items ti
group by ti.takeoff_run_id, ti.element_type;

create or replace view rebar.v_estimate_detail_export as
select
  ev.id as estimate_version_id,
  p.project_name,
  ti.element_type,
  ti.shape_type,
  ti.bar_size,
  ti.spacing_text,
  ti.quantity,
  ti.multiplier,
  ti.cut_length_m,
  ti.total_length_m,
  ti.kg_per_m,
  ti.total_weight_kg,
  ti.drawing_reference,
  ti.confidence
from rebar.estimate_versions ev
join rebar.projects p on p.id = ev.project_id
join rebar.takeoff_items ti on ti.takeoff_run_id = ev.takeoff_run_id;

grant select on rebar.v_takeoff_summary_by_bar_size to authenticated;
grant select on rebar.v_takeoff_summary_by_element to authenticated;
grant select on rebar.v_estimate_detail_export to authenticated;

alter table rebar.organizations enable row level security;
alter table rebar.users enable row level security;
alter table rebar.projects enable row level security;
alter table rebar.project_files enable row level security;
alter table rebar.drawing_sheets enable row level security;
alter table rebar.drawing_detections enable row level security;
alter table rebar.rebar_weight_reference enable row level security;
alter table rebar.takeoff_runs enable row level security;
alter table rebar.takeoff_items enable row level security;
alter table rebar.takeoff_warnings enable row level security;
alter table rebar.takeoff_assumptions enable row level security;
alter table rebar.takeoff_exclusions enable row level security;
alter table rebar.human_reviews enable row level security;
alter table rebar.manual_adjustments enable row level security;
alter table rebar.estimate_versions enable row level security;
alter table rebar.estimate_exports enable row level security;
alter table rebar.assistant_threads enable row level security;
alter table rebar.assistant_messages enable row level security;

drop policy if exists "rebar org members read organizations" on rebar.organizations;
create policy "rebar org members read organizations"
on rebar.organizations
for select
to authenticated
using (
  exists (
    select 1
    from rebar.users u
    where u.organization_id = organizations.id
      and u.id = auth.uid()
  )
);

drop policy if exists "rebar authenticated insert organizations" on rebar.organizations;
create policy "rebar authenticated insert organizations"
on rebar.organizations
for insert
to authenticated
with check (true);

drop policy if exists "rebar org members update organizations" on rebar.organizations;
create policy "rebar org members update organizations"
on rebar.organizations
for update
to authenticated
using (
  exists (
    select 1
    from rebar.users u
    where u.organization_id = organizations.id
      and u.id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from rebar.users u
    where u.organization_id = organizations.id
      and u.id = auth.uid()
  )
);

drop policy if exists "rebar same org read users" on rebar.users;
create policy "rebar same org read users"
on rebar.users
for select
to authenticated
using (
  organization_id = rebar.current_user_organization_id()
);

drop policy if exists "rebar self insert users" on rebar.users;
create policy "rebar self insert users"
on rebar.users
for insert
to authenticated
with check (
  id = auth.uid()
);

drop policy if exists "rebar self update users" on rebar.users;
create policy "rebar self update users"
on rebar.users
for update
to authenticated
using (
  id = auth.uid()
)
with check (
  id = auth.uid()
);

drop policy if exists "rebar same org manage projects" on rebar.projects;
create policy "rebar same org manage projects"
on rebar.projects
for all
to authenticated
using (
  organization_id = rebar.current_user_organization_id()
)
with check (
  organization_id = rebar.current_user_organization_id()
);

drop policy if exists "rebar read weight reference" on rebar.rebar_weight_reference;
create policy "rebar read weight reference"
on rebar.rebar_weight_reference
for select
to authenticated
using (true);

drop policy if exists "rebar same org manage project files" on rebar.project_files;
create policy "rebar same org manage project files"
on rebar.project_files
for all
to authenticated
using (rebar.can_access_project(project_id))
with check (rebar.can_access_project(project_id));

drop policy if exists "rebar same org manage drawing sheets" on rebar.drawing_sheets;
create policy "rebar same org manage drawing sheets"
on rebar.drawing_sheets
for all
to authenticated
using (
  exists (
    select 1
    from rebar.project_files pf
    where pf.id = drawing_sheets.project_file_id
      and rebar.can_access_project(pf.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.project_files pf
    where pf.id = drawing_sheets.project_file_id
      and rebar.can_access_project(pf.project_id)
  )
);

drop policy if exists "rebar same org manage drawing detections" on rebar.drawing_detections;
create policy "rebar same org manage drawing detections"
on rebar.drawing_detections
for all
to authenticated
using (
  exists (
    select 1
    from rebar.drawing_sheets ds
    join rebar.project_files pf on pf.id = ds.project_file_id
    where ds.id = drawing_detections.drawing_sheet_id
      and rebar.can_access_project(pf.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.drawing_sheets ds
    join rebar.project_files pf on pf.id = ds.project_file_id
    where ds.id = drawing_detections.drawing_sheet_id
      and rebar.can_access_project(pf.project_id)
  )
);

drop policy if exists "rebar same org manage takeoff runs" on rebar.takeoff_runs;
create policy "rebar same org manage takeoff runs"
on rebar.takeoff_runs
for all
to authenticated
using (rebar.can_access_project(project_id))
with check (rebar.can_access_project(project_id));

drop policy if exists "rebar same org manage takeoff items" on rebar.takeoff_items;
create policy "rebar same org manage takeoff items"
on rebar.takeoff_items
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_items.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_items.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage takeoff warnings" on rebar.takeoff_warnings;
create policy "rebar same org manage takeoff warnings"
on rebar.takeoff_warnings
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_warnings.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_warnings.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage takeoff assumptions" on rebar.takeoff_assumptions;
create policy "rebar same org manage takeoff assumptions"
on rebar.takeoff_assumptions
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_assumptions.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_assumptions.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage takeoff exclusions" on rebar.takeoff_exclusions;
create policy "rebar same org manage takeoff exclusions"
on rebar.takeoff_exclusions
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_exclusions.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = takeoff_exclusions.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage human reviews" on rebar.human_reviews;
create policy "rebar same org manage human reviews"
on rebar.human_reviews
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = human_reviews.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_runs tr
    where tr.id = human_reviews.takeoff_run_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage manual adjustments" on rebar.manual_adjustments;
create policy "rebar same org manage manual adjustments"
on rebar.manual_adjustments
for all
to authenticated
using (
  exists (
    select 1
    from rebar.takeoff_items ti
    join rebar.takeoff_runs tr on tr.id = ti.takeoff_run_id
    where ti.id = manual_adjustments.takeoff_item_id
      and rebar.can_access_project(tr.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.takeoff_items ti
    join rebar.takeoff_runs tr on tr.id = ti.takeoff_run_id
    where ti.id = manual_adjustments.takeoff_item_id
      and rebar.can_access_project(tr.project_id)
  )
);

drop policy if exists "rebar same org manage estimate versions" on rebar.estimate_versions;
create policy "rebar same org manage estimate versions"
on rebar.estimate_versions
for all
to authenticated
using (rebar.can_access_project(project_id))
with check (rebar.can_access_project(project_id));

drop policy if exists "rebar same org manage estimate exports" on rebar.estimate_exports;
create policy "rebar same org manage estimate exports"
on rebar.estimate_exports
for all
to authenticated
using (
  exists (
    select 1
    from rebar.estimate_versions ev
    where ev.id = estimate_exports.estimate_version_id
      and rebar.can_access_project(ev.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.estimate_versions ev
    where ev.id = estimate_exports.estimate_version_id
      and rebar.can_access_project(ev.project_id)
  )
);

drop policy if exists "rebar same org manage assistant threads" on rebar.assistant_threads;
create policy "rebar same org manage assistant threads"
on rebar.assistant_threads
for all
to authenticated
using (rebar.can_access_project(project_id))
with check (rebar.can_access_project(project_id));

drop policy if exists "rebar same org manage assistant messages" on rebar.assistant_messages;
create policy "rebar same org manage assistant messages"
on rebar.assistant_messages
for all
to authenticated
using (
  exists (
    select 1
    from rebar.assistant_threads at
    where at.id = assistant_messages.thread_id
      and rebar.can_access_project(at.project_id)
  )
)
with check (
  exists (
    select 1
    from rebar.assistant_threads at
    where at.id = assistant_messages.thread_id
      and rebar.can_access_project(at.project_id)
  )
);
