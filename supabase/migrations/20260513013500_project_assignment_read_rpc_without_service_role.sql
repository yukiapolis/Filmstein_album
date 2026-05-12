create or replace function public.is_project_admin_assigned(
  input_project_id uuid,
  input_admin_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_admin_assignments paa
    where paa.project_id = input_project_id
      and paa.admin_user_id = input_admin_user_id
  );
$$;

revoke all on function public.is_project_admin_assigned(uuid, uuid) from public;
grant execute on function public.is_project_admin_assigned(uuid, uuid) to anon, authenticated, service_role;

create or replace function public.list_assigned_project_ids_for_admin(
  input_admin_user_id uuid
)
returns table (
  project_id uuid
)
language sql
security definer
set search_path = public
as $$
  select paa.project_id
  from public.project_admin_assignments paa
  where paa.admin_user_id = input_admin_user_id;
$$;

revoke all on function public.list_assigned_project_ids_for_admin(uuid) from public;
grant execute on function public.list_assigned_project_ids_for_admin(uuid) to anon, authenticated, service_role;

create or replace function public.list_project_admin_assignments_rpc(
  input_project_id uuid
)
returns table (
  admin_user_id uuid,
  assigned_by uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    paa.admin_user_id,
    paa.assigned_by,
    paa.created_at
  from public.project_admin_assignments paa
  where paa.project_id = input_project_id
  order by paa.created_at asc;
$$;

revoke all on function public.list_project_admin_assignments_rpc(uuid) from public;
grant execute on function public.list_project_admin_assignments_rpc(uuid) to anon, authenticated, service_role;
