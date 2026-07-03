-- Re-create delete_student_safe. Remote's migration history already marks
-- 20260703000000_delete_student_safe as applied, but the function itself is
-- missing from the live remote schema (most likely dropped directly via the
-- SQL editor after the original migration ran, outside the migration
-- tracker). Since db push only applies migrations not yet recorded as
-- applied, a plain re-run of the original file would be a no-op on remote.
-- This migration carries a fresh version so it's picked up as pending and
-- restores the function. CREATE OR REPLACE makes it a safe no-op anywhere
-- the function already exists correctly (e.g. local).

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
