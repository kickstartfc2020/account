-- Phase 7b rollback: Restore prior profiles policy behavior and remove privileged-field trigger.

drop trigger if exists profiles_block_privileged_updates_trigger on public.profiles;
drop function if exists public.profiles_block_privileged_updates();

drop policy if exists profiles_insert_policy on public.profiles;
create policy profiles_insert_policy
on public.profiles
for insert
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and role = 'branch_manager'
    and organization_id = public.current_organization_id()
  )
);

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
)
with check (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
);
