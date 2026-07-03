-- Allow branch managers (and org/super admins, via can_access_branch) to
-- permanently delete a student, but only when the student has zero invoice
-- history. Any invoice — even a cancelled one — blocks deletion, since
-- invoices.student_id is ON DELETE RESTRICT and cancelled invoices must be
-- retained as audit/GST records rather than purged. Archive the student
-- instead when invoice history exists.
--
-- Pending renewal rows (created at enrollment, before any invoice exists)
-- are cleaned up as part of the same delete, since renewals.student_id is
-- also ON DELETE RESTRICT.

CREATE OR REPLACE FUNCTION public.delete_student_safe(p_student_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_branch_id uuid;
  v_invoice_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select branch_id
    into v_branch_id
  from public.students
  where id = p_student_id
  for update;

  if not found then
    raise exception 'Student not found.';
  end if;

  if not public.can_access_branch(v_branch_id) then
    raise exception 'You do not have access to delete this student.';
  end if;

  select count(*)
    into v_invoice_count
  from public.invoices
  where student_id = p_student_id;

  if v_invoice_count > 0 then
    raise exception 'Cannot delete a student with invoice history. Archive the student instead.';
  end if;

  perform set_config('app.allow_hard_delete', 'on', true);

  delete from public.renewals where student_id = p_student_id;
  delete from public.students where id = p_student_id;

  return true;
end;
$$;

ALTER FUNCTION public.delete_student_safe(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_student_safe(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_student_safe(uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_student_safe(uuid) TO service_role;
