# RLS Patterns

## Rules

1. **Roles in their own table** — never on `profiles` or `users`. Privilege escalation risk.
2. **`has_role()` is SECURITY DEFINER** — bypasses RLS to avoid recursive policy checks.
3. **Owner-by-default** — every domain table gets `user_id` and a `for all` policy keyed on `auth.uid() = user_id`.
4. **Storage paths encode owner** — `${userId}/${projectId}/...` so the bucket policy can use `storage.foldername(name)[1]`.
5. **Never trust client role claims** — always re-check via `has_role()` server-side (RLS or edge function).

## Snippet — admin-only table

```sql
create policy "admins manage rates" on public.rate_table
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
```

## Snippet — public read, owner write

```sql
create policy "public read" on public.shared_assets for select using (true);
create policy "owner write" on public.shared_assets
  for insert to authenticated with check (auth.uid() = user_id);
```