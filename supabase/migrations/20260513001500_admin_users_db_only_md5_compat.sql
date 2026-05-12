create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists admin_users_username_lower_idx
  on public.admin_users (lower(username));

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
  add column if not exists password text,
  add column if not exists short_id text,
  add column if not exists role text,
  add column if not exists is_active boolean not null default true;

update public.admin_users
set password = coalesce(nullif(password, ''), nullif(password_hash, ''))
where coalesce(nullif(password, ''), '') = '';

update public.admin_users
set short_id = public.generate_admin_user_short_id()
where short_id is null or length(trim(short_id)) = 0;

update public.admin_users
set role = coalesce(nullif(role, ''), 'admin')
where role is null or length(trim(role)) = 0;

alter table public.admin_users
  alter column password_hash drop not null,
  alter column password set not null,
  alter column short_id set not null,
  alter column short_id set default public.generate_admin_user_short_id(),
  alter column role set not null,
  alter column role set default 'admin';

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('super_admin', 'admin'));

create unique index if not exists admin_users_short_id_idx
  on public.admin_users (short_id);

alter table public.projects
  add column if not exists created_by_admin_user_id uuid references public.admin_users(id);

create index if not exists projects_created_by_admin_user_id_idx
  on public.projects (created_by_admin_user_id);

create table if not exists public.project_admin_assignments (
  project_id uuid not null references public.projects(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  assigned_by uuid references public.admin_users(id),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (project_id, admin_user_id)
);

create index if not exists project_admin_assignments_admin_user_id_idx
  on public.project_admin_assignments (admin_user_id);
