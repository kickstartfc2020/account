-- Phase 7d rollback: Restore branch_manager write capability on org settings and GST rates.

drop policy if exists organizations_write_policy on public.organizations;
create policy organizations_write_policy
on public.organizations
for all
using (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and id = public.current_organization_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and id = public.current_organization_id()
  )
);

drop policy if exists gst_rates_write_policy on public.gst_rates;
create policy gst_rates_write_policy
on public.gst_rates
for all
using (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and organization_id = public.current_organization_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and organization_id = public.current_organization_id()
  )
);
