-- Phase 6d: Allow super admins to clean up auth users created during failed onboarding.
create or replace function public.admin_delete_auth_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role public.app_role;
  v_deleted integer := 0;
begin
  v_role := public.current_role();
  if v_role is distinct from 'super_admin' then
    raise exception 'Only super_admin may delete auth users.';
  end if;

  delete from auth.users
  where id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.admin_delete_auth_user(uuid) from public;
grant execute on function public.admin_delete_auth_user(uuid) to authenticated;
