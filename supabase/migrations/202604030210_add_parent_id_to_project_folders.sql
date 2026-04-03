begin;

alter table public.project_folders
  add column if not exists parent_id uuid null references public.project_folders(id) on delete set null;

create index if not exists project_folders_parent_id_idx
  on public.project_folders(parent_id);

commit;
