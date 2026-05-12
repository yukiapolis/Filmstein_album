create extension if not exists pgcrypto;

create or replace function public.generate_admin_user_short_id()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '/+=', 'XYZ'), 1, 8));
    exit when candidate !~ '[^A-Z0-9]' and not exists (
      select 1 from public.admin_users where short_id = candidate
    );
  end loop;

  return candidate;
end;
$$;

alter table public.admin_users
  add column if not exists short_id text;

update public.admin_users
set short_id = public.generate_admin_user_short_id()
where short_id is null or length(trim(short_id)) = 0;

alter table public.admin_users
  alter column short_id set default public.generate_admin_user_short_id();

alter table public.admin_users
  alter column short_id set not null;

create unique index if not exists admin_users_short_id_idx
  on public.admin_users (short_id);
