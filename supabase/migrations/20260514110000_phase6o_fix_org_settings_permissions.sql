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

drop policy if exists branch_images_admin_insert on storage.objects;
drop policy if exists branch_images_admin_update on storage.objects;
drop policy if exists branch_images_admin_delete on storage.objects;

create policy branch_images_manage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'branch-images'
  and public.current_role() in ('super_admin', 'organization_admin', 'branch_manager')
);

create policy branch_images_manage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'branch-images'
  and public.current_role() in ('super_admin', 'organization_admin', 'branch_manager')
)
with check (
  bucket_id = 'branch-images'
  and public.current_role() in ('super_admin', 'organization_admin', 'branch_manager')
);

create policy branch_images_manage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'branch-images'
  and public.current_role() in ('super_admin', 'organization_admin', 'branch_manager')
);
