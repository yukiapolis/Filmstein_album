create extension if not exists pgcrypto;

create or replace function public.register_admin_user(input_username text, input_password text, input_invite_code text)
returns table (
  id uuid,
  short_id text,
  username text,
  is_active boolean,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text := btrim(input_username);
  normalized_invite_code text := btrim(input_invite_code);
  inserted_user public.admin_users%rowtype;
begin
  if normalized_username = '' or coalesce(input_password, '') = '' or normalized_invite_code = '' then
    raise exception 'FIELDS_REQUIRED';
  end if;

  if normalized_invite_code <> 'SF-26-VAULT-9XK7Q2' then
    raise exception 'INVITE_CODE_INVALID';
  end if;

  if exists (
    select 1
    from public.admin_users au
    where lower(au.username) = lower(normalized_username)
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  insert into public.admin_users (username, password, role, is_active)
  values (normalized_username, md5(input_password), 'admin', true)
  returning * into inserted_user;

  return query
  select
    inserted_user.id,
    inserted_user.short_id,
    inserted_user.username,
    inserted_user.is_active,
    inserted_user.role;
end;
$$;

revoke all on function public.register_admin_user(text, text, text) from public;
grant execute on function public.register_admin_user(text, text, text) to anon, authenticated, service_role;
