drop policy if exists renewals_write_policy on public.renewals;

create policy renewals_write_policy
on public.renewals
for all
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and organization_id = public.current_organization_id()
    and branch_id = public.current_branch_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and organization_id = public.current_organization_id()
    and branch_id = public.current_branch_id()
  )
);
