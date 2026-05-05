begin;

alter table public.photo_files
  drop constraint if exists photo_files_branch_type_check;

alter table public.photo_files
  add constraint photo_files_branch_type_check
  check (branch_type in ('original', 'raw', 'thumb', 'display', 'client_preview'));

commit;
