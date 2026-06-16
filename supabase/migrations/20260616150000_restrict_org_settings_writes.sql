-- Restrict organization-wide settings and GST rate writes to
-- organization_admin and super_admin. The baseline policies allowed
-- branch_manager to write organizations/gst_rates rows too (org-wide
-- config such as GST number, UPI ID, logo, and GST rate tables affect
-- every branch, not just the caller's own branch). The frontend already
-- gates these screens to super_admin/organization_admin only
-- (src/pages/Settings.tsx), so branch_manager has no legitimate use of
-- this write access -- this closes an unused, over-broad RLS grant.

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
