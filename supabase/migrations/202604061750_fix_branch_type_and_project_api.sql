begin;

alter table public.photo_files
  drop constraint if exists new_photo_files_branch_type_check;

alter table public.photo_files
  drop constraint if exists photo_files_branch_type_check;

alter table public.photo_files
  alter column branch_type type text
  using case trim(branch_type::text)
    when '1' then 'original'
    when '2' then 'raw'
    when '3' then 'thumb'
    when '4' then 'display'
    when 'original' then 'original'
    when 'raw' then 'raw'
    when 'thumb' then 'thumb'
    when 'display' then 'display'
    else trim(branch_type::text)
  end;

alter table public.photo_files
  add constraint photo_files_branch_type_check
  check (branch_type in ('original', 'raw', 'thumb', 'display', 'client_preview'));

commit;
