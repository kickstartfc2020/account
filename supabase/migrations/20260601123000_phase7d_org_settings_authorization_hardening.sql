-- Phase 7d: Restrict organization settings writes to organization_admin and super_admin.

-- Organizations: branch_manager can still read via existing select policy,
-- but cannot write organization-wide settings.
drop policy if exists organizations_write_policy on public.organizations;
create policy organizations_write_policy
on public.organizations
for all
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and id = public.current_organization_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and id = public.current_organization_id()
  )
);

-- GST rates: keep read access for branch_manager, restrict writes to org_admin/super_admin.
drop policy if exists gst_rates_write_policy on public.gst_rates;
create policy gst_rates_write_policy
on public.gst_rates
for all
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
);
