create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists admin_users_username_lower_idx
  on public.admin_users (lower(username));
