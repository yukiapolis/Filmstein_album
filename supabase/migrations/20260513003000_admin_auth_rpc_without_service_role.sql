create extension if not exists pgcrypto;

create or replace function public.authenticate_admin_user(input_username text, input_password text)
returns table (
  id uuid,
  short_id text,
  username text,
  password text,
  is_active boolean,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    au.id,
    au.short_id,
    au.username,
    au.password,
    au.is_active,
    au.role
  from public.admin_users au
  where lower(au.username) = lower(input_username)
    and au.is_active = true
    and au.password = md5(input_password)
  limit 1;
$$;

revoke all on function public.authenticate_admin_user(text, text) from public;
grant execute on function public.authenticate_admin_user(text, text) to anon, authenticated, service_role;

create or replace function public.get_admin_user_by_id(input_id uuid)
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    au.id,
    au.short_id,
    au.username,
    au.is_active,
    au.role
  from public.admin_users au
  where au.id = input_id
  limit 1;
$$;

revoke all on function public.get_admin_user_by_id(uuid) from public;
grant execute on function public.get_admin_user_by_id(uuid) to anon, authenticated, service_role;

create or replace function public.get_admin_user_by_short_id(input_short_id text)
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    au.id,
    au.short_id,
    au.username,
    au.is_active,
    au.role
  from public.admin_users au
  where au.short_id = upper(input_short_id)
  limit 1;
$$;

revoke all on function public.get_admin_user_by_short_id(text) from public;
grant execute on function public.get_admin_user_by_short_id(text) to anon, authenticated, service_role;

create or replace function public.list_admin_users_public()
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    au.id,
    au.short_id,
    au.username,
    au.is_active,
    au.role
  from public.admin_users au
  order by au.username asc;
$$;

revoke all on function public.list_admin_users_public() from public;
grant execute on function public.list_admin_users_public() to anon, authenticated, service_role;
