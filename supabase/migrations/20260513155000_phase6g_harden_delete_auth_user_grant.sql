-- Phase 6g: Harden grant surface for admin_delete_auth_user.
revoke execute on function public.admin_delete_auth_user(uuid) from authenticated;
