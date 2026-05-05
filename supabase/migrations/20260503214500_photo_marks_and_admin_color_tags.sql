create table if not exists public.photo_client_marks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  photo_id uuid not null references public.photos(global_photo_id) on delete cascade,
  viewer_session_id text not null,
  created_at timestamptz not null default now(),
  unique (project_id, photo_id, viewer_session_id)
);

create index if not exists photo_client_marks_project_photo_idx
  on public.photo_client_marks (project_id, photo_id);

create index if not exists photo_client_marks_viewer_session_idx
  on public.photo_client_marks (viewer_session_id);

create table if not exists public.photo_admin_color_tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  photo_id uuid not null references public.photos(global_photo_id) on delete cascade,
  color text not null check (color in ('red', 'green', 'blue', 'yellow', 'purple')),
  created_at timestamptz not null default now(),
  unique (project_id, photo_id, color)
);

create index if not exists photo_admin_color_tags_project_photo_idx
  on public.photo_admin_color_tags (project_id, photo_id);

create index if not exists photo_admin_color_tags_color_idx
  on public.photo_admin_color_tags (color);
