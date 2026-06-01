-- Phase 7c: Make branch-images private and enforce tenant-scoped read/write policies.

-- 1) Bucket must be private.
update storage.buckets
set public = false
where id = 'branch-images';

-- 2) Remove legacy public-read access.
drop policy if exists branch_images_public_read on storage.objects;

-- 3) Enforce tenant-scoped read access.
drop policy if exists branch_images_manage_read on storage.objects;
create policy branch_images_manage_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);

-- 4) Ensure write policies remain tenant-scoped.
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

-- 5) Data migration: convert legacy public URLs to storage object paths
-- so frontend can issue signed URLs after bucket privatization.

update public.branches
set image = regexp_replace(
  regexp_replace(image, '^https?://[^/]+/storage/v1/object/public/branch-images/', ''),
  '\\?.*$',
  ''
)
where image ~ '^https?://[^/]+/storage/v1/object/public/branch-images/';

update public.organizations
set logo_url = regexp_replace(
  regexp_replace(logo_url, '^https?://[^/]+/storage/v1/object/public/branch-images/', ''),
  '\\?.*$',
  ''
)
where logo_url ~ '^https?://[^/]+/storage/v1/object/public/branch-images/';

update public.organizations
set upi_qr_url = regexp_replace(
  regexp_replace(upi_qr_url, '^https?://[^/]+/storage/v1/object/public/branch-images/', ''),
  '\\?.*$',
  ''
)
where upi_qr_url ~ '^https?://[^/]+/storage/v1/object/public/branch-images/';
