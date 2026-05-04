-- Bridge current public-schema intake records to the rebar MVP schema.

create table if not exists public.rebar_project_links (
  legacy_project_id uuid primary key references public.projects(id) on delete cascade,
  rebar_project_id uuid not null unique references rebar.projects(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.rebar_project_file_links (
  legacy_file_id uuid primary key references public.project_files(id) on delete cascade,
  rebar_project_file_id uuid not null unique references rebar.project_files(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rebar_project_links enable row level security;
alter table public.rebar_project_file_links enable row level security;

drop policy if exists "owners manage rebar_project_links" on public.rebar_project_links;
create policy "owners manage rebar_project_links"
on public.rebar_project_links
for all
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = legacy_project_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects p
    where p.id = legacy_project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "owners manage rebar_project_file_links" on public.rebar_project_file_links;
create policy "owners manage rebar_project_file_links"
on public.rebar_project_file_links
for all
to authenticated
using (
  exists (
    select 1
    from public.project_files pf
    where pf.id = legacy_file_id
      and pf.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.project_files pf
    where pf.id = legacy_file_id
      and pf.user_id = auth.uid()
  )
);

create or replace function public.ensure_rebar_project_bridge(
  p_legacy_project_id uuid,
  p_project_name text,
  p_customer_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, rebar, auth
as $$
declare
  v_existing uuid;
  v_org_id uuid;
  v_display_name text;
  v_email text;
  v_slug text;
  v_project_name text;
  v_customer_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select rebar_project_id
  into v_existing
  from public.rebar_project_links
  where legacy_project_id = p_legacy_project_id;

  if v_existing is not null then
    return v_existing;
  end if;

  select p.name
  into v_project_name
  from public.projects p
  where p.id = p_legacy_project_id
    and p.user_id = auth.uid();

  if v_project_name is null then
    raise exception 'Legacy project not found or not owned by caller';
  end if;

  v_project_name := coalesce(nullif(trim(p_project_name), ''), v_project_name);
  v_customer_name := nullif(trim(coalesce(p_customer_name, '')), '');

  select ru.organization_id
  into v_org_id
  from rebar.users ru
  where ru.id = auth.uid();

  if v_org_id is null then
    select coalesce(pr.display_name, au.raw_user_meta_data ->> 'display_name', split_part(au.email, '@', 1)),
           au.email
    into v_display_name, v_email
    from auth.users au
    left join public.profiles pr on pr.user_id = au.id
    where au.id = auth.uid();

    v_display_name := coalesce(nullif(trim(v_display_name), ''), 'Estimator');
    v_email := coalesce(nullif(trim(v_email), ''), auth.uid()::text || '@local.invalid');
    v_slug := regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
    v_slug := left(coalesce(nullif(v_slug, ''), 'org'), 40) || '-' || substr(auth.uid()::text, 1, 8);

    insert into rebar.organizations (name, slug)
    values (v_display_name || ' Organization', v_slug)
    on conflict (slug) do update set name = excluded.name
    returning id into v_org_id;

    insert into rebar.users (id, organization_id, full_name, email, role)
    values (auth.uid(), v_org_id, v_display_name, v_email, 'estimator')
    on conflict (id) do update
      set organization_id = excluded.organization_id,
          full_name = excluded.full_name,
          email = excluded.email;
  end if;

  insert into rebar.projects (
    organization_id,
    project_name,
    customer_name,
    estimator_id,
    status
  )
  values (
    v_org_id,
    v_project_name,
    v_customer_name,
    auth.uid(),
    'intake'
  )
  returning id into v_existing;

  insert into public.rebar_project_links (legacy_project_id, rebar_project_id)
  values (p_legacy_project_id, v_existing)
  on conflict (legacy_project_id) do update
    set rebar_project_id = excluded.rebar_project_id;

  return v_existing;
end;
$$;

grant execute on function public.ensure_rebar_project_bridge(uuid, text, text) to authenticated;

create or replace function public.ensure_rebar_project_file_bridge(
  p_legacy_file_id uuid,
  p_legacy_project_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_file_kind text,
  p_revision_label text default null,
  p_checksum_sha256 text default null,
  p_page_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, rebar, auth
as $$
declare
  v_existing uuid;
  v_rebar_project_id uuid;
  v_project_name text;
  v_kind rebar.file_kind;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.project_files pf
  join public.projects p on p.id = pf.project_id
  where pf.id = p_legacy_file_id
    and pf.project_id = p_legacy_project_id
    and p.user_id = auth.uid();

  if not found then
    raise exception 'Legacy project file not found or not owned by caller';
  end if;

  select rebar_project_file_id
  into v_existing
  from public.rebar_project_file_links
  where legacy_file_id = p_legacy_file_id;

  begin
    v_kind := coalesce(nullif(trim(p_file_kind), ''), 'other')::rebar.file_kind;
  exception
    when others then
      v_kind := 'other'::rebar.file_kind;
  end;

  select l.rebar_project_id, p.name
  into v_rebar_project_id, v_project_name
  from public.projects p
  left join public.rebar_project_links l on l.legacy_project_id = p.id
  where p.id = p_legacy_project_id
    and p.user_id = auth.uid();

  if v_rebar_project_id is null then
    v_rebar_project_id := public.ensure_rebar_project_bridge(p_legacy_project_id, v_project_name, null);
  end if;

  if v_existing is not null then
    update rebar.project_files
    set storage_path = p_storage_path,
        original_filename = p_original_filename,
        file_kind = v_kind,
        revision_label = coalesce(p_revision_label, revision_label),
        checksum_sha256 = coalesce(p_checksum_sha256, checksum_sha256),
        page_count = coalesce(p_page_count, page_count)
    where id = v_existing;

    return v_existing;
  end if;

  insert into rebar.project_files (
    project_id,
    file_kind,
    storage_path,
    original_filename,
    revision_label,
    checksum_sha256,
    uploaded_by,
    page_count
  )
  values (
    v_rebar_project_id,
    v_kind,
    p_storage_path,
    p_original_filename,
    p_revision_label,
    p_checksum_sha256,
    auth.uid(),
    p_page_count
  )
  returning id into v_existing;

  insert into public.rebar_project_file_links (legacy_file_id, rebar_project_file_id)
  values (p_legacy_file_id, v_existing)
  on conflict (legacy_file_id) do update
    set rebar_project_file_id = excluded.rebar_project_file_id;

  return v_existing;
end;
$$;

grant execute on function public.ensure_rebar_project_file_bridge(uuid, uuid, text, text, text, text, text, integer) to authenticated;
