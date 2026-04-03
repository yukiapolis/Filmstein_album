begin;

alter table public.photos
  add column if not exists is_published boolean not null default false;

create index if not exists photos_is_published_idx
  on public.photos(is_published);

commit;
