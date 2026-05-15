create table if not exists public.project_storage_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  operation_type text not null,
  status text not null,
  requested_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  node_id uuid null references public.storage_nodes(id) on delete set null,
  node_key text null,
  node_name text null,
  requested_branch_types text[] not null default '{}',
  total_files integer not null default 0,
  done_files integer not null default 0,
  failed_files integer not null default 0,
  total_bytes bigint not null default 0,
  transferred_bytes bigint not null default 0,
  current_phase text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint project_storage_operations_type_check check (operation_type in ('pull_to_current_node')),
  constraint project_storage_operations_status_check check (status in ('queued', 'preparing', 'copying', 'verifying', 'switching_project_state', 'completed', 'failed')),
  constraint project_storage_operations_counts_check check (
    total_files >= 0 and done_files >= 0 and failed_files >= 0 and total_bytes >= 0 and transferred_bytes >= 0
  )
);

create index if not exists project_storage_operations_project_idx
  on public.project_storage_operations(project_id, created_at desc);

create index if not exists project_storage_operations_status_idx
  on public.project_storage_operations(status, created_at desc);

create or replace function public.set_project_storage_operations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_project_storage_operations_updated_at on public.project_storage_operations;
create trigger trg_project_storage_operations_updated_at
before update on public.project_storage_operations
for each row execute function public.set_project_storage_operations_updated_at();
