create or replace function public.assign_project_admin_user(
  input_project_id uuid,
  input_admin_user_id uuid,
  input_assigned_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_admin_assignments (project_id, admin_user_id, assigned_by)
  values (input_project_id, input_admin_user_id, input_assigned_by)
  on conflict (project_id, admin_user_id)
  do update set assigned_by = excluded.assigned_by;
end;
$$;

revoke all on function public.assign_project_admin_user(uuid, uuid, uuid) from public;
grant execute on function public.assign_project_admin_user(uuid, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.remove_project_admin_user(
  input_project_id uuid,
  input_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.project_admin_assignments
  where project_id = input_project_id
    and admin_user_id = input_admin_user_id;
end;
$$;

revoke all on function public.remove_project_admin_user(uuid, uuid) from public;
grant execute on function public.remove_project_admin_user(uuid, uuid) to anon, authenticated, service_role;
