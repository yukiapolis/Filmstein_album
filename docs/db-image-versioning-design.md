# 图片主表 + 文件表重构方案

## 1. 对当前错误设计的简洁判断

当前库里的 `photos` 混合了两层语义：

- 逻辑图片层：项目、文件夹、收藏/状态/标签
- 文件层：文件名、URL、原图信息

后面又补了 `photo_versions`，导致结构开始朝“版本表”走。但按照现在确认下来的业务语义：

- `photos` 只保留逻辑图片字段
- `photo_files` 只表示存储池中的真实文件资产
- 文件与逻辑图片的关系只需要表达“属于哪张逻辑图片”，不需要在文件表内部维护父子派生链

所以这次重构的核心不是继续堆 `photo_versions`，而是把**文件级信息彻底下沉到 `photo_files`**，并去掉不必要的文件自引用字段，让 `photos` 变成干净的逻辑主表。

## 2. 最终目标表结构

保留：

- `projects`（不动）
- `project_folders`（不动）

最终业务表：

- `photos`
- `photo_files`

废弃：

- `photo_versions`
- `photo_events`
- `photo_ingest_logs`
- `photos` 中所有文件级字段和冗余状态字段

## 3. 每张表字段清单

### photos

逻辑图片主表，只保留图片层字段。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| global_photo_id | text | PK | 逻辑图片主键 |
| project_id | uuid | NOT NULL, FK -> projects(id) | 所属项目 |
| folder_id | uuid | NULL, FK -> project_folders(id) | 所属文件夹 |
| current_file_id | uuid | NULL | 当前默认显示文件 |
| star_rating | smallint | NOT NULL DEFAULT 0 | 0~5 星 |
| status | smallint | NOT NULL DEFAULT 1 | 1 draft / 2 published / 3 hidden / 4 removed |
| color_label | text | NULL | 颜色标签 |
| metadata | jsonb | NOT NULL DEFAULT '{}'::jsonb | 扩展元数据 |
| updated_at | timestamptz | NOT NULL DEFAULT now() | 更新时间 |

约束：

- `star_rating between 0 and 5`
- `status in (1,2,3,4)`

### photo_files

所有真实文件统一表。当前方案里，`branch_type` 不再表示 origin/manual/ai 一类“处理分支”，而是直接表示文件类型。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | PK | 文件记录主键 |
| photo_id | text | NOT NULL, FK -> photos(global_photo_id) | 所属逻辑图片 |
| branch_type | text | NOT NULL | original / raw / thumb / display |
| version_no | int | NOT NULL DEFAULT 1 | 版本号（当前第一阶段通常固定为 1） |
| variant_type | smallint | NOT NULL DEFAULT 1 | 预留字段，当前第一阶段可固定为 1 |
| file_name | text | NULL | 当前文件名 |
| original_file_name | text | NULL | 原始文件名 |
| storage_provider | text | NOT NULL | 存储提供方 |
| bucket_name | text | NOT NULL | 存储桶 |
| object_key | text | NOT NULL | 对象路径 |
| mime_type | text | NULL | MIME |
| file_size_bytes | bigint | NULL | 文件大小 |
| width | int | NULL | 宽 |
| height | int | NULL | 高 |
| checksum_sha256 | text | NULL | 内容哈希 |
| exif | jsonb | NOT NULL DEFAULT '{}'::jsonb | EXIF |
| processing_meta | jsonb | NOT NULL DEFAULT '{}'::jsonb | 处理元数据 |
| created_by | text | NULL | 创建者 |
| created_at | timestamptz | NOT NULL DEFAULT now() | 创建时间 |
| updated_at | timestamptz | NOT NULL DEFAULT now() | 更新时间 |

建议约束：

- `branch_type in ('original','raw','thumb','display')`
- `variant_type in (1,2,3,4)`
- `version_no >= 1`
- `(width is null or width > 0)`
- `(height is null or height > 0)`
- `(file_size_bytes is null or file_size_bytes >= 0)`
- `unique(photo_id, branch_type, version_no, variant_type)`
- `unique(storage_provider, bucket_name, object_key)`

说明：

- 这里不用把 `object_key` 单独做唯一主键，因为未来可能多存储源共存；所以用 `(storage_provider, bucket_name, object_key)` 更稳。
- `unique(photo_id, branch_type, version_no, variant_type)` 可以保证“同一逻辑图、同一文件类型、同一版本、同一种变体”只有一条记录，足够简洁。
- 文件之间不维护父子派生链；当前业务语义是“存储池中的独立文件资产 + 逻辑图片对这些资产的版本归属关系”。

## 4. 完整迁移 SQL

```sql
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

-- 可选：如果存在也备份，但最终不会保留
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
  branch_type text not null,
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
  constraint new_photo_files_branch_type_check check (branch_type in ('original','raw','thumb','display')),
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
-- 3. 迁移原始文件 -> new_photo_files
-- ====================
-- 规则：旧 photos 里仅有单一文件信息时，视为 original/v1
-- bucket_name 若旧数据没有，先统一写 filmstein；object_key 优先取 file_url，后退到 file_name

insert into public.new_photo_files (
  id,
  photo_id,
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
  'original',
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
-- 4. 迁移 photo_versions -> new_photo_files
-- ====================
-- 规则：
-- 旧表迁移阶段应映射到新的字符串语义：
--   original / raw / thumb / display
-- variant_type 当前保留为兼容字段，后续可进一步收敛
-- 文件表内部不维护派生链，因为当前业务不要求文件之间的父子依赖关系

insert into public.new_photo_files (
  id,
  photo_id,
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
  case pv.branch_type
    when 'origin' then 'original'
    when 'manual' then 'display'
    when 'ai' then 'display'
    else 'original'
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
-- 优先规则：
-- 1) 如果旧 current_version_id 能映射到新文件，优先用它
-- 2) 否则取该 photo 最早的 master 文件

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
           case when nf.branch_type = 'original' then 0 else 1 end,
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

-- 旧事件/日志表按要求不再保留业务角色，保留旧表供兜底
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
```

## 5. 数据校验 SQL

```sql
-- 1. photos 数量
select count(*) as photos_count from public.photos;

-- 2. 每个 photo 至少有一个 photo_files
select p.global_photo_id
from public.photos p
left join public.photo_files pf on pf.photo_id = p.global_photo_id
group by p.global_photo_id
having count(pf.id) = 0;

-- 3. current_file_id 必须能关联到 photo_files.id
select p.global_photo_id, p.current_file_id
from public.photos p
left join public.photo_files pf on pf.id = p.current_file_id
where p.current_file_id is not null
  and pf.id is null;

-- 4. photo_files 不能成为孤儿
select pf.id, pf.photo_id
from public.photo_files pf
left join public.photos p on p.global_photo_id = pf.photo_id
where p.global_photo_id is null;

-- 5. current_file_id 必须属于同一张 photo
select p.global_photo_id, p.current_file_id, pf.photo_id as file_owner_photo_id
from public.photos p
join public.photo_files pf on pf.id = p.current_file_id
where pf.photo_id <> p.global_photo_id;

-- 6. 每张图至少应有一个 master 文件
select p.global_photo_id
from public.photos p
left join public.photo_files pf
  on pf.photo_id = p.global_photo_id
 and pf.variant_type = 1
group by p.global_photo_id
having count(pf.id) = 0;
```

## 6. 回滚方案

如果迁移后要回滚：

```sql
begin;

alter table if exists public.photos rename to new_photos_failed;
alter table if exists public.photo_files rename to new_photo_files_failed;

alter table if exists public.photos_old rename to photos;
alter table if exists public.photo_versions_old rename to photo_versions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_events_old'
  ) THEN
    EXECUTE 'alter table public.photo_events_old rename to photo_events';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'photo_ingest_logs_old'
  ) THEN
    EXECUTE 'alter table public.photo_ingest_logs_old rename to photo_ingest_logs';
  END IF;
END $$;

commit;
```

回滚前建议先跑：

```sql
select count(*) from public.photos_old;
select count(*) from public.photo_versions_old;
```

确认旧表仍在。
