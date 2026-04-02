create extension if not exists pgcrypto;

begin;

-- ====================
-- 0. 备份旧表
-- ====================

drop table if exists public.photos_backup_202604020138;
create table public.photos_backup_202604020138 as
select * from public.photos;

drop table if exists public.photo_versions_backup_202604020138;
create table public.photo_versions_backup_202604020138 as
select * from public.photo_versions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_events'
  ) THEN
    EXECUTE 'drop table if exists public.photo_events_backup_202604020138';
    EXECUTE 'create table public.photo_events_backup_202604020138 as select * from public.photo_events';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_ingest_logs'
  ) THEN
    EXECUTE 'drop table if exists public.photo_ingest_logs_backup_202604020138';
    EXECUTE 'create table public.photo_ingest_logs_backup_202604020138 as select * from public.photo_ingest_logs';
  END IF;
END $$;

-- ====================
-- 1. 新建目标表
-- ====================

drop table if exists public.new_photo_files cascade;
drop table if exists public.new_photos cascade;

create table public.new_photos (
  global_photo_id text primary key,
  project_id uuid not null references public.projects(id),
  folder_id uuid null references public.project_folders(id),
  current_file_id uuid null,
  star_rating smallint not null default 0,
  status smallint not null default 1,
  color_label text null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint new_photos_star_rating_check check (star_rating between 0 and 5),
  constraint new_photos_status_check check (status in (1,2,3,4))
);

create table public.new_photo_files (
  id uuid primary key default gen_random_uuid(),
  photo_id text not null references public.new_photos(global_photo_id) on delete cascade,
  source_file_id uuid null references public.new_photo_files(id) on delete set null,
  branch_type smallint not null,
  version_no int not null default 1,
  variant_type smallint not null default 1,
  file_name text null,
  original_file_name text null,
  storage_provider text not null,
  bucket_name text not null,
  object_key text not null,
  mime_type text null,
  file_size_bytes bigint null,
  width int null,
  height int null,
  checksum_sha256 text null,
  exif jsonb not null default '{}'::jsonb,
  processing_meta jsonb not null default '{}'::jsonb,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint new_photo_files_branch_type_check check (branch_type in (1,2,3)),
  constraint new_photo_files_variant_type_check check (variant_type in (1,2,3,4)),
  constraint new_photo_files_version_no_check check (version_no >= 1),
  constraint new_photo_files_width_check check (width is null or width > 0),
  constraint new_photo_files_height_check check (height is null or height > 0),
  constraint new_photo_files_file_size_check check (file_size_bytes is null or file_size_bytes >= 0),
  constraint new_photo_files_unique_variant unique (photo_id, branch_type, version_no, variant_type),
  constraint new_photo_files_unique_object unique (storage_provider, bucket_name, object_key)
);

create index new_photos_project_id_idx on public.new_photos(project_id);
create index new_photos_folder_id_idx on public.new_photos(folder_id);
create index new_photos_current_file_id_idx on public.new_photos(current_file_id);
create index new_photo_files_photo_id_idx on public.new_photo_files(photo_id);
create index new_photo_files_source_file_id_idx on public.new_photo_files(source_file_id);
create index new_photo_files_branch_version_idx on public.new_photo_files(photo_id, branch_type, version_no);
create index new_photo_files_variant_idx on public.new_photo_files(photo_id, variant_type);

-- ====================
-- 2. 迁移 photos 逻辑层
-- ====================

insert into public.new_photos (
  global_photo_id,
  project_id,
  folder_id,
  star_rating,
  status,
  color_label,
  metadata,
  updated_at
)
select
  p.global_photo_id,
  p.project_id,
  coalesce(p.folder_id, pf.id) as folder_id,
  case
    when coalesce(p.starred, false) = true or coalesce(p.is_favorite, false) = true then 1
    else 0
  end as star_rating,
  case
    when coalesce(p.is_removed, false) = true then 4
    when coalesce(p.is_hidden, false) = true then 3
    when coalesce(p.is_published, false) = true then 2
    else 1
  end as status,
  p.color_label,
  coalesce(p.metadata, '{}'::jsonb) as metadata,
  coalesce(p.updated_at, p.created_at::timestamptz, now()) as updated_at
from public.photos p
left join public.project_folders pf
  on p.folder_id = pf.id;

-- ====================
-- 3. 迁移旧 photos 文件 -> new_photo_files
-- ====================

insert into public.new_photo_files (
  id,
  photo_id,
  source_file_id,
  branch_type,
  version_no,
  variant_type,
  file_name,
  original_file_name,
  storage_provider,
  bucket_name,
  object_key,
  mime_type,
  file_size_bytes,
  width,
  height,
  checksum_sha256,
  exif,
  processing_meta,
  created_by,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  p.global_photo_id,
  null,
  1,
  1,
  1,
  p.file_name,
  p.file_name,
  'r2',
  'filmstein',
  coalesce(nullif(p.file_url, ''), p.file_name, p.global_photo_id),
  null,
  null,
  null,
  null,
  null,
  '{}'::jsonb,
  '{}'::jsonb,
  null,
  coalesce(p.created_at::timestamptz, now()),
  coalesce(p.updated_at, p.created_at::timestamptz, now())
from public.photos p;

-- ====================
-- 4. 迁移旧 photo_versions -> new_photo_files
-- ====================

insert into public.new_photo_files (
  id,
  photo_id,
  source_file_id,
  branch_type,
  version_no,
  variant_type,
  file_name,
  original_file_name,
  storage_provider,
  bucket_name,
  object_key,
  mime_type,
  file_size_bytes,
  width,
  height,
  checksum_sha256,
  exif,
  processing_meta,
  created_by,
  created_at,
  updated_at
)
select
  pv.id,
  p.global_photo_id,
  null,
  case pv.branch_type
    when 'origin' then 1
    when 'manual' then 2
    when 'ai' then 3
    else 1
  end,
  coalesce(pv.version_no, 1),
  case
    when lower(coalesce(pv.processing_meta->>'variant_type', '')) = 'preview' then 2
    when lower(coalesce(pv.processing_meta->>'variant_type', '')) = 'thumbnail' then 3
    when lower(coalesce(pv.processing_meta->>'variant_type', '')) = 'compressed' then 4
    else 1
  end,
  pv.file_name,
  pv.original_file_name,
  coalesce(nullif(pv.storage_provider, ''), 'r2'),
  coalesce(nullif(pv.bucket_name, ''), 'filmstein'),
  pv.object_key,
  pv.mime_type,
  pv.file_size_bytes,
  pv.width,
  pv.height,
  pv.checksum_sha256,
  coalesce(pv.exif, '{}'::jsonb),
  coalesce(pv.processing_meta, '{}'::jsonb),
  pv.created_by,
  coalesce(pv.created_at, now()),
  coalesce(pv.updated_at, pv.created_at, now())
from public.photo_versions pv
join public.photos p
  on p.id = pv.photo_id
where not exists (
  select 1
  from public.new_photo_files nf
  where nf.id = pv.id
);

-- ====================
-- 5. 重建 current_file_id
-- ====================

update public.new_photos np
set current_file_id = x.file_id
from (
  select p.global_photo_id, pv.id as file_id
  from public.photos p
  join public.photo_versions pv on pv.id = p.current_version_id
) x
where np.global_photo_id = x.global_photo_id;

update public.new_photos np
set current_file_id = x.file_id
from (
  select distinct on (nf.photo_id)
    nf.photo_id,
    nf.id as file_id
  from public.new_photo_files nf
  where nf.variant_type = 1
  order by nf.photo_id,
           case when nf.branch_type = 1 then 0 else 1 end,
           nf.version_no asc,
           nf.created_at asc,
           nf.id asc
) x
where np.global_photo_id = x.photo_id
  and np.current_file_id is null;

alter table public.new_photos
  add constraint new_photos_current_file_fk
  foreign key (current_file_id) references public.new_photo_files(id) on delete set null;

-- ====================
-- 6. 切表
-- ====================

alter table public.photos rename to photos_old;
alter table public.new_photos rename to photos;

alter table public.photo_versions rename to photo_versions_old;
alter table public.new_photo_files rename to photo_files;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_events'
  ) THEN
    EXECUTE 'alter table public.photo_events rename to photo_events_old';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_ingest_logs'
  ) THEN
    EXECUTE 'alter table public.photo_ingest_logs rename to photo_ingest_logs_old';
  END IF;
END $$;

commit;
