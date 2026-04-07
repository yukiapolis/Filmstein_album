create table if not exists public.ftp_ingest_import_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  buffer_job_id text not null,
  status text not null default 'claimed' check (status in ('claimed', 'imported', 'failed', 'confirm_failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, buffer_job_id)
);
