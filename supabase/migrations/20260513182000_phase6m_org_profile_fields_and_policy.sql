alter table public.organizations
  add column if not exists gst_number text,
  add column if not exists pan_number text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text;

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
