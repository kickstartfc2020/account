-- Packages ("Batches" in the UI) currently only support archiving
-- (archivePackage sets status='archived'). Add a real hard-delete path,
-- mirroring the existing delete_student_safe / admin_delete_branch pattern:
-- reject the delete with a clear, student-count-bearing message if any
-- student is currently enrolled in the batch (students.current_package_id
-- is ON DELETE RESTRICT), and fall back to a friendly message for any
-- other blocking reference (invoice_items.package_id and
-- renewals.package_id are also ON DELETE RESTRICT) instead of surfacing a
-- raw foreign-key-violation error to the client.
CREATE OR REPLACE FUNCTION public.delete_package_safe(p_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_package record;
  v_student_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select id, organization_id, branch_id
    into v_package
  from public.packages
  where id = p_package_id
  for update;

  if not found then
    raise exception 'Batch not found.';
  end if;

  -- Mirrors packages_write_policy exactly: super_admin, organization_admin
  -- scoped to their org, or branch_manager scoped to their own org+branch.
  if not (
    public.is_super_admin()
    or (public.current_role() = 'organization_admin' and v_package.organization_id = public.current_organization_id())
    or (public.current_role() = 'branch_manager' and v_package.organization_id = public.current_organization_id() and v_package.branch_id = public.current_branch_id())
  ) then
    raise exception 'You do not have access to delete this batch.';
  end if;

  select count(*)
    into v_student_count
  from public.students
  where current_package_id = p_package_id;

  if v_student_count > 0 then
    raise exception 'Cannot delete this batch: % student(s) are currently enrolled in it. Archive it instead, or move them to a different batch first.', v_student_count;
  end if;

  begin
    delete from public.packages where id = p_package_id;
  exception
    when foreign_key_violation then
      raise exception 'Cannot delete this batch: it still has related records (invoices or renewal history) referencing it. Archive it instead.';
  end;

  return true;
end;
$$;

ALTER FUNCTION public.delete_package_safe(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_package_safe(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_package_safe(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_package_safe(uuid) TO service_role;
