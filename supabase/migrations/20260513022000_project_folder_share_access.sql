alter table public.project_folders
  add column if not exists access_mode text not null default 'public',
  add column if not exists password_hash text null;

update public.project_folders
set access_mode = 'public'
where access_mode is null or access_mode not in ('public', 'hidden', 'password_protected');

alter table public.project_folders
  drop constraint if exists project_folders_access_mode_check;

alter table public.project_folders
  add constraint project_folders_access_mode_check
  check (access_mode in ('public', 'hidden', 'password_protected'));
