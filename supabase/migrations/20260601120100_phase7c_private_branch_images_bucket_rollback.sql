-- Phase 7c rollback: restore public branch-images reads and bucket visibility.

update storage.buckets
set public = true
where id = 'branch-images';

drop policy if exists branch_images_manage_read on storage.objects;

drop policy if exists branch_images_public_read on storage.objects;
create policy branch_images_public_read
on storage.objects
for select
using (bucket_id = 'branch-images');

-- Keep tenant-scoped write policies as-is.
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
