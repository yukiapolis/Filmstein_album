begin;

alter table public.photo_file_copies
  drop constraint if exists photo_file_copies_storage_provider_check;

alter table public.photo_file_copies
  add constraint photo_file_copies_storage_provider_check
  check (storage_provider in ('local', 'r2', 'backup_remote'));

create table if not exists public.project_storage_migrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  source_provider text not null check (source_provider in ('r2')),
  target_provider text not null check (target_provider in ('backup_remote')),
  branch_types text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  current_phase text not null default 'planning' check (current_phase in ('planning', 'copying', 'verifying', 'completed', 'failed')),
  total_files integer not null default 0 check (total_files >= 0),
  done_files integer not null default 0 check (done_files >= 0),
  success_files integer not null default 0 check (success_files >= 0),
  failed_files integer not null default 0 check (failed_files >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  transferred_bytes bigint not null default 0 check (transferred_bytes >= 0),
  bytes_per_second numeric(20,2) not null default 0 check (bytes_per_second >= 0),
  eta_seconds integer,
  last_error_summary text,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint project_storage_migrations_branch_types_check check (
    branch_types <@ array['thumb', 'display', 'original']::text[]
  )
);

create index if not exists project_storage_migrations_project_idx
  on public.project_storage_migrations(project_id, created_at desc);

create index if not exists project_storage_migrations_status_idx
  on public.project_storage_migrations(status, created_at desc);

create table if not exists public.project_storage_migration_items (
  id uuid primary key default gen_random_uuid(),
  migration_id uuid not null references public.project_storage_migrations(id) on delete cascade,
  photo_file_id uuid not null references public.photo_files(id) on delete cascade,
  branch_type text not null check (branch_type in ('thumb', 'display', 'original')),
  source_copy_id uuid null references public.photo_file_copies(id) on delete set null,
  target_copy_id uuid null references public.photo_file_copies(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'copying', 'verifying', 'available', 'failed', 'skipped')),
  bytes_total bigint not null default 0 check (bytes_total >= 0),
  bytes_done bigint not null default 0 check (bytes_done >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint project_storage_migration_items_unique_file unique (migration_id, photo_file_id)
);

create index if not exists project_storage_migration_items_migration_idx
  on public.project_storage_migration_items(migration_id, status, created_at asc);

create index if not exists project_storage_migration_items_photo_file_idx
  on public.project_storage_migration_items(photo_file_id);

create or replace function public.set_project_storage_migrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_project_storage_migrations_updated_at on public.project_storage_migrations;
create trigger trg_project_storage_migrations_updated_at
before update on public.project_storage_migrations
for each row execute function public.set_project_storage_migrations_updated_at();

drop trigger if exists trg_project_storage_migration_items_updated_at on public.project_storage_migration_items;
create trigger trg_project_storage_migration_items_updated_at
before update on public.project_storage_migration_items
for each row execute function public.set_project_storage_migrations_updated_at();

commit;
