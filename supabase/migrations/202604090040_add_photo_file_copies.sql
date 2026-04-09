begin;

create table if not exists public.photo_file_copies (
  id uuid primary key default gen_random_uuid(),
  photo_file_id uuid not null references public.photo_files(id) on delete cascade,
  storage_provider text not null check (storage_provider in ('local', 'r2')),
  bucket_name text,
  storage_key text not null,
  status text not null default 'available' check (status in ('queued', 'copying', 'verifying', 'available', 'failed', 'deleting-source')),
  checksum_verified boolean not null default false,
  size_bytes bigint,
  size_verified boolean not null default false,
  is_primary_read_source boolean not null default false,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists photo_file_copies_photo_file_id_idx
  on public.photo_file_copies(photo_file_id);

create index if not exists photo_file_copies_provider_status_idx
  on public.photo_file_copies(storage_provider, status);

create unique index if not exists photo_file_copies_one_primary_per_file_idx
  on public.photo_file_copies(photo_file_id)
  where is_primary_read_source = true;

insert into public.photo_file_copies (
  photo_file_id,
  storage_provider,
  bucket_name,
  storage_key,
  status,
  checksum_verified,
  size_bytes,
  size_verified,
  is_primary_read_source,
  last_verified_at,
  created_at,
  updated_at
)
select
  pf.id,
  pf.storage_provider,
  pf.bucket_name,
  pf.object_key,
  'available',
  case when pf.checksum_sha256 is not null then true else false end,
  pf.file_size_bytes,
  case when pf.file_size_bytes is not null then true else false end,
  true,
  now(),
  coalesce(pf.created_at, now()),
  now()
from public.photo_files pf
where pf.storage_provider in ('local', 'r2')
  and pf.object_key is not null
  and not exists (
    select 1
    from public.photo_file_copies pfc
    where pfc.photo_file_id = pf.id
  );

commit;
