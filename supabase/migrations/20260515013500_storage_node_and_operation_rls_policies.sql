grant select, insert, update on table public.storage_nodes to anon, authenticated;
grant select, insert, update on table public.project_storage_operations to anon, authenticated;

alter table public.storage_nodes enable row level security;
alter table public.project_storage_operations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storage_nodes' and policyname = 'storage_nodes_select_anon_authenticated'
  ) then
    create policy storage_nodes_select_anon_authenticated
      on public.storage_nodes
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storage_nodes' and policyname = 'storage_nodes_insert_anon_authenticated'
  ) then
    create policy storage_nodes_insert_anon_authenticated
      on public.storage_nodes
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storage_nodes' and policyname = 'storage_nodes_update_anon_authenticated'
  ) then
    create policy storage_nodes_update_anon_authenticated
      on public.storage_nodes
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_storage_operations' and policyname = 'project_storage_operations_select_anon_authenticated'
  ) then
    create policy project_storage_operations_select_anon_authenticated
      on public.project_storage_operations
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_storage_operations' and policyname = 'project_storage_operations_insert_anon_authenticated'
  ) then
    create policy project_storage_operations_insert_anon_authenticated
      on public.project_storage_operations
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_storage_operations' and policyname = 'project_storage_operations_update_anon_authenticated'
  ) then
    create policy project_storage_operations_update_anon_authenticated
      on public.project_storage_operations
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end
$$;
