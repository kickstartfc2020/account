-- Phase 6f: Storage bucket and policies for branch images.
insert into storage.buckets (id, name, public)
values ('branch-images', 'branch-images', true)
on conflict (id) do nothing;

drop policy if exists branch_images_public_read on storage.objects;
create policy branch_images_public_read
on storage.objects
for select
using (bucket_id = 'branch-images');

drop policy if exists branch_images_admin_insert on storage.objects;
create policy branch_images_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'branch-images'
  and public.current_role() = 'super_admin'
);

drop policy if exists branch_images_admin_update on storage.objects;
create policy branch_images_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'branch-images'
  and public.current_role() = 'super_admin'
)
with check (
  bucket_id = 'branch-images'
  and public.current_role() = 'super_admin'
);

drop policy if exists branch_images_admin_delete on storage.objects;
create policy branch_images_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'branch-images'
  and public.current_role() = 'super_admin'
);
