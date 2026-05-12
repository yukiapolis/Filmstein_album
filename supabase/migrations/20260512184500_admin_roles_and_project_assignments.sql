alter table public.admin_users
  add column if not exists role text not null default 'admin';

alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('super_admin', 'admin'));

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

update public.admin_users
set role = 'super_admin'
where lower(username) = 'filmstein';
