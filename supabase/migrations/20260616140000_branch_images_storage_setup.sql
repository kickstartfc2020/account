-- Reconstructs the branch-images storage bucket and its RLS policies, which
-- were configured directly against the project (via earlier, now-squashed
-- migrations) but never captured in 20260616000000_baseline.sql. Without
-- this, a fresh environment built from migrations alone would have no
-- bucket and no storage policies, breaking uploadBranchImage /
-- uploadOrganizationLogo / uploadOrganizationQrCode entirely.
--
-- Final state matches what was actually live: public bucket with public
-- read (images are shown on invoices/receipts without needing signed
-- URLs), tenant-scoped write access via can_manage_branch_image_object(),
-- plus a server-side size/type allow-list as defense in depth alongside
-- the client-side validation in src/lib/adminManagement.ts.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branch-images',
  'branch-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists branch_images_public_read on storage.objects;
create policy branch_images_public_read
on storage.objects
for select
using (bucket_id = 'branch-images');

drop policy if exists branch_images_admin_insert on storage.objects;
drop policy if exists branch_images_admin_update on storage.objects;
drop policy if exists branch_images_admin_delete on storage.objects;
drop policy if exists branch_images_manage_read on storage.objects;
drop policy if exists branch_images_manage_insert on storage.objects;
drop policy if exists branch_images_manage_update on storage.objects;
drop policy if exists branch_images_manage_delete on storage.objects;

create policy branch_images_manage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);

create policy branch_images_manage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
)
with check (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);

create policy branch_images_manage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);
