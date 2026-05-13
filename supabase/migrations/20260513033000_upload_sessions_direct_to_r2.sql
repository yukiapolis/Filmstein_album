create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid null references public.project_folders(id) on delete set null,
  target_photo_id text null,
  file_name text not null,
  mime_type text null,
  file_size_bytes bigint not null,
  checksum_sha256 text not null,
  display_preset text not null default '4000',
  upload_category text null,
  upload_decision text null,
  classification text not null default 'unknown',
  matched_photo_id text null,
  matched_version_no integer null,
  next_version_no integer null,
  normalized_base_name text null,
  reason text null,
  source_bucket_name text null,
  source_object_key text null,
  source_public_url text null,
  status text not null default 'initiated',
  processing_error text null,
  result_photo_id text null,
  result_original_file_id uuid null references public.photo_files(id) on delete set null,
  result_thumb_file_id uuid null references public.photo_files(id) on delete set null,
  result_display_file_id uuid null references public.photo_files(id) on delete set null,
  result_client_preview_file_id uuid null references public.photo_files(id) on delete set null,
  warnings jsonb not null default '[]'::jsonb,
  created_by_admin_user_id uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint upload_sessions_status_check check (status in ('initiated', 'uploaded', 'processing', 'completed', 'failed')),
  constraint upload_sessions_display_preset_check check (display_preset in ('original', '6000', '4000')),
  constraint upload_sessions_classification_check check (classification in ('duplicate_original', 'retouch_upload', 'new_original', 'unknown', 'invalid_retouch_reference'))
);

create index if not exists upload_sessions_project_id_idx on public.upload_sessions(project_id, created_at desc);
create index if not exists upload_sessions_status_idx on public.upload_sessions(status, created_at desc);
create index if not exists upload_sessions_result_photo_id_idx on public.upload_sessions(result_photo_id);

create or replace function public.set_upload_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_upload_sessions_updated_at on public.upload_sessions;
create trigger trg_upload_sessions_updated_at
before update on public.upload_sessions
for each row execute function public.set_upload_sessions_updated_at();
