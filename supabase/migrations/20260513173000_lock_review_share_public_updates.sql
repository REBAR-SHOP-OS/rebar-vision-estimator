drop policy if exists "Anon can update status" on public.review_shares;
drop policy if exists "Anon update by token header" on public.review_shares;
drop policy if exists "Anon update unexpired share by token header" on public.review_shares;

create or replace function public.update_review_share_status(
  p_share_token text,
  p_next_status text
) returns public.review_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.review_shares;
begin
  if p_share_token is null or btrim(p_share_token) = '' then
    raise exception 'share token is required';
  end if;

  if p_next_status not in ('viewed', 'commented') then
    raise exception 'invalid review share status';
  end if;

  update public.review_shares
  set status = case
    when p_next_status = 'commented' then 'commented'
    when status = 'pending' and p_next_status = 'viewed' then 'viewed'
    else status
  end
  where share_token = p_share_token
    and (expires_at is null or expires_at > now())
    and (
      (p_next_status = 'viewed' and status = 'pending')
      or (p_next_status = 'commented' and status in ('pending', 'viewed', 'commented'))
    )
  returning * into v_share;

  if v_share.id is null then
    select *
    into v_share
    from public.review_shares
    where share_token = p_share_token
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_share.id is null then
      raise exception 'review share not found or expired';
    end if;
  end if;

  return v_share;
end;
$$;

revoke all on function public.update_review_share_status(text, text) from public;
grant execute on function public.update_review_share_status(text, text) to anon;
grant execute on function public.update_review_share_status(text, text) to authenticated;
