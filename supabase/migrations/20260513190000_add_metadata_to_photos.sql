alter table public.photos
  add column if not exists metadata jsonb not null default '{}'::jsonb;
