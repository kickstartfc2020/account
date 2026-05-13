-- Phase 6h: Tighten execute grants for admin auth-management RPCs.
revoke execute on function public.admin_delete_auth_user(uuid) from anon;
revoke execute on function public.admin_delete_auth_user(uuid) from authenticated;

revoke execute on function public.admin_create_branch_manager(text, text, text, uuid) from anon;
grant execute on function public.admin_create_branch_manager(text, text, text, uuid) to authenticated;
