-- Allow super_admin to permanently delete a branch that has no students and no invoices.
CREATE OR REPLACE FUNCTION "public"."admin_delete_branch"("p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.app_role;
  v_branch_exists boolean;
  v_student_count integer;
  v_invoice_count integer;
  v_manager_count integer;
begin
  v_role := public.current_role();
  if v_role is distinct from 'super_admin' then
    raise exception 'Only super_admin may delete branches.';
  end if;

  select exists(select 1 from public.branches where id = p_branch_id) into v_branch_exists;
  if not v_branch_exists then
    raise exception 'Branch not found.';
  end if;

  select count(*) into v_student_count from public.students where branch_id = p_branch_id;
  if v_student_count > 0 then
    raise exception 'Cannot delete branch: % student(s) still exist. Remove or transfer them first.', v_student_count;
  end if;

  select count(*) into v_invoice_count from public.invoices where branch_id = p_branch_id;
  if v_invoice_count > 0 then
    raise exception 'Cannot delete branch: % invoice(s) still exist. Remove or transfer them first.', v_invoice_count;
  end if;

  select count(*) into v_manager_count from public.profiles where branch_id = p_branch_id;
  if v_manager_count > 0 then
    raise exception 'Cannot delete branch: % branch manager account(s) are still assigned. Remove them first.', v_manager_count;
  end if;

  begin
    delete from public.packages where branch_id = p_branch_id;
    delete from public.sports where branch_id = p_branch_id;
    delete from public.branches where id = p_branch_id;
  exception
    when foreign_key_violation then
      raise exception 'Cannot delete branch: it still has related records (payments, renewals, packages or sports) referencing it.';
  end;

  return true;
end;
$$;


ALTER FUNCTION "public"."admin_delete_branch"("p_branch_id" "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_delete_branch"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_branch"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_branch"("p_branch_id" "uuid") TO "service_role";
