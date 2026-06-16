


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'super_admin',
    'organization_admin',
    'branch_manager'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."audit_action" AS ENUM (
    'insert',
    'update',
    'cancel',
    'archive',
    'status_change',
    'payment_change'
);


ALTER TYPE "public"."audit_action" OWNER TO "postgres";


CREATE TYPE "public"."invoice_status" AS ENUM (
    'draft',
    'unpaid',
    'partial',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."package_billing_type" AS ENUM (
    'one_time',
    'recurring_monthly'
);


ALTER TYPE "public"."package_billing_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'cash',
    'card',
    'upi',
    'online',
    'bank_transfer'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'completed',
    'failed',
    'cancelled',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."record_status" AS ENUM (
    'active',
    'inactive',
    'archived'
);


ALTER TYPE "public"."record_status" OWNER TO "postgres";


CREATE TYPE "public"."renewal_status" AS ENUM (
    'pending',
    'completed',
    'cancelled',
    'overdue'
);


ALTER TYPE "public"."renewal_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_student_enrollment_atomic"("p_student_id" "uuid", "p_package_id" "uuid", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_start_date" "date" DEFAULT CURRENT_DATE) RETURNS TABLE("package_id" "uuid", "renewal_id" "uuid", "cycle_start" "date", "cycle_end" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.app_role;
  v_current_org uuid;
  v_current_branch uuid;
  v_student record;
  v_package record;
  v_target_branch uuid;
  v_start_date date;
  v_cycle_end_date date;
  v_new_renewal_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'Role context is missing for current user.';
  end if;

  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to add student enrollment.';
  end if;

  v_current_org := public.current_organization_id();
  v_current_branch := public.current_branch_id();

  select id, organization_id, branch_id
    into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found then
    raise exception 'Student not found.';
  end if;

  if not public.is_super_admin() then
    if v_current_org is null or v_student.organization_id <> v_current_org then
      raise exception 'You can only manage students in your active organization.';
    end if;
  end if;

  if v_role = 'organization_admin' then
    if v_current_org is null or v_student.organization_id <> v_current_org then
      raise exception 'You can only manage students in your active organization.';
    end if;
  elsif v_role = 'branch_manager' then
    if v_current_org is null or v_current_branch is null then
      raise exception 'Unable to resolve branch manager context.';
    end if;

    if v_student.organization_id <> v_current_org or v_student.branch_id <> v_current_branch then
      raise exception 'Branch managers can only enroll students in their own branch.';
    end if;
  end if;

  select id, organization_id, branch_id, duration_months, amount, status
    into v_package
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  if v_package.organization_id <> v_student.organization_id then
    raise exception 'Package and student must belong to the same organization.';
  end if;

  v_target_branch := coalesce(p_branch_id, v_student.branch_id);
  if v_target_branch is null then
    raise exception 'Unable to resolve enrollment branch.';
  end if;

  perform 1
  from public.branches b
  where b.id = v_target_branch
    and b.organization_id = v_student.organization_id;

  if not found then
    raise exception 'Selected branch does not belong to student organization.';
  end if;

  if v_role = 'branch_manager' and v_target_branch <> v_current_branch then
    raise exception 'Branch managers cannot assign enrollments to a different branch.';
  end if;

  if v_package.branch_id is not null and v_package.branch_id <> v_target_branch then
    raise exception 'Package does not belong to the selected branch.';
  end if;

  v_start_date := coalesce(p_start_date, current_date);
  v_cycle_end_date := (
    v_start_date
    + make_interval(months => greatest(coalesce(v_package.duration_months, 1), 1))
    - interval '1 day'
  )::date;

  update public.students
  set
    current_package_id = p_package_id,
    updated_at = now()
  where id = p_student_id
    and organization_id = v_student.organization_id;

  insert into public.renewals (
    organization_id,
    branch_id,
    student_id,
    package_id,
    cycle_start,
    cycle_end,
    due_date,
    status,
    balance_amount
  )
  values (
    v_student.organization_id,
    v_target_branch,
    p_student_id,
    p_package_id,
    v_start_date,
    v_cycle_end_date,
    v_cycle_end_date,
    'pending',
    coalesce(v_package.amount, 0)
  )
  returning id into v_new_renewal_id;

  package_id := p_package_id;
  renewal_id := v_new_renewal_id;
  cycle_start := v_start_date;
  cycle_end := v_cycle_end_date;
  return next;
end;
$$;


ALTER FUNCTION "public"."add_student_enrollment_atomic"("p_student_id" "uuid", "p_package_id" "uuid", "p_branch_id" "uuid", "p_start_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_role public.app_role;
  v_deleted integer := 0;
begin
  v_role := public.current_role();
  if v_role is distinct from 'super_admin' then
    raise exception 'Only super_admin may delete auth users.';
  end if;

  delete from auth.users
  where id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;


ALTER FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reset_invoices"("p_organization_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("deleted_invoices" integer, "deleted_payments" integer, "deleted_items" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.app_role;
  v_organization_id uuid;
  v_deleted_invoices integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_items integer := 0;
begin
  v_role := public.current_role();
  if v_role not in ('super_admin', 'organization_admin') then
    raise exception 'Only organization administrators can reset invoices.';
  end if;

  v_organization_id := coalesce(p_organization_id, public.current_organization_id());
  if v_organization_id is null then
    raise exception 'Organization context is required for invoice reset.';
  end if;

  if v_role = 'organization_admin' and public.current_organization_id() is distinct from v_organization_id then
    raise exception 'You can only reset invoices for your active organization.';
  end if;

  perform set_config('app.allow_hard_delete', 'on', true);
  perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':invoice_reset', 0));

  update public.renewals
    set source_invoice_id = null,
        generated_invoice_id = null
  where organization_id = v_organization_id
    and (source_invoice_id is not null or generated_invoice_id is not null);

  delete from public.invoice_write_requests
  where organization_id = v_organization_id;

  delete from public.payments
  where organization_id = v_organization_id;
  get diagnostics v_deleted_payments = row_count;

  delete from public.invoice_items
  where organization_id = v_organization_id;
  get diagnostics v_deleted_items = row_count;

  delete from public.invoices
  where organization_id = v_organization_id;
  get diagnostics v_deleted_invoices = row_count;

  -- Remove both legacy year-scoped keys and new organization-scoped key.
  delete from public.ref_counters
  where counter_key = 'invoice:' || v_organization_id::text
     or counter_key like 'invoice:' || v_organization_id::text || ':%';

  return query select v_deleted_invoices, v_deleted_payments, v_deleted_items;
end;
$$;


ALTER FUNCTION "public"."admin_reset_invoices"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_action_for_change"("p_table_name" "text", "p_old_status" "text", "p_new_status" "text") RETURNS "public"."audit_action"
    LANGUAGE "plpgsql" STABLE
    AS $$
begin
  if p_table_name = 'invoices' and p_old_status is distinct from p_new_status and p_new_status = 'cancelled' then
    return 'cancel';
  elsif p_table_name = 'payments' then
    return 'payment_change';
  elsif p_old_status is distinct from p_new_status then
    return 'status_change';
  end if;

  return 'update';
end;
$$;


ALTER FUNCTION "public"."audit_action_for_change"("p_table_name" "text", "p_old_status" "text", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_branch"("target_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    public.is_super_admin()
    or (
      public.current_role() = 'organization_admin'
      and exists (
        select 1
        from public.branches b
        where b.id = target_branch_id
          and b.organization_id = public.current_organization_id()
      )
    )
    or (
      public.current_role() = 'branch_manager'
      and public.current_branch_id() = target_branch_id
    );
$$;


ALTER FUNCTION "public"."can_access_branch"("target_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_organization"("target_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    public.is_super_admin()
    or (public.current_organization_id() is not null and public.current_organization_id() = target_org_id);
$$;


ALTER FUNCTION "public"."can_access_organization"("target_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_manage_branch_image_object"("p_object_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.app_role;
  v_org_id uuid;
  v_branch_id uuid;
begin
  v_role := public.current_role();

  if v_role = 'super_admin' then
    return true;
  end if;

  v_org_id := public.current_organization_id();
  v_branch_id := public.current_branch_id();

  if v_role = 'organization_admin' and v_org_id is not null then
    if p_object_name like ('organization/' || v_org_id::text || '/%') then
      return true;
    end if;

    if exists (
      select 1
      from public.branches b
      where b.organization_id = v_org_id
        and p_object_name like (b.id::text || '/%')
    ) then
      return true;
    end if;
  end if;

  if v_role = 'branch_manager' and v_branch_id is not null then
    return p_object_name like (v_branch_id::text || '/%');
  end if;

  return false;
end;
$$;


ALTER FUNCTION "public"."can_manage_branch_image_object"("p_object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invoice_id uuid;
  v_org_id uuid;
  v_branch_id uuid;
begin
  select id, organization_id, branch_id
    into v_invoice_id, v_org_id, v_branch_id
  from public.invoices
  where invoice_number = p_invoice_number
  for update;

  if not found then
    raise exception 'Invoice not found.';
  end if;

  if not public.can_access_organization(v_org_id) then
    raise exception 'You do not have access to this invoice.';
  end if;

  if public.current_role() = 'branch_manager' and v_branch_id <> public.current_branch_id() then
    raise exception 'Branch managers can only cancel invoices in their own branch.';
  end if;

  update public.invoices
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    balance_amount = 0,
    updated_at = now()
  where id = v_invoice_id
    and status <> 'cancelled';

  update public.payments
  set
    status = 'cancelled',
    updated_at = now(),
    notes = trim(both from concat(coalesce(notes, ''), ' [Auto-cancelled due to invoice cancellation]'))
  where invoice_id = v_invoice_id
    and status in ('completed', 'pending');

  return true;
end;
$$;


ALTER FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_renewal_with_invoice"("p_renewal_id" "uuid", "p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid" DEFAULT NULL::"uuid", "p_start_date" "date" DEFAULT CURRENT_DATE) RETURNS TABLE("invoice_id" "uuid", "invoice_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_renewal record;
  v_package_duration integer := 1;
  v_cycle_end date;
begin
  select *
    into v_renewal
  from public.renewals
  where id = p_renewal_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'Renewal record not found.';
  end if;

  if v_renewal.status = 'completed' then
    raise exception 'Renewal is already completed.';
  end if;

  if not public.can_access_organization(v_renewal.organization_id) then
    raise exception 'You do not have access to this renewal.';
  end if;

  select duration_months into v_package_duration
  from public.packages
  where id = p_package_id;

  v_cycle_end := (p_start_date + make_interval(months => coalesce(v_package_duration, 1)) - interval '1 day')::date;

  select fi.invoice_id, fi.invoice_number
    into invoice_id, invoice_number
  from public.finalize_invoice_write(
    p_student_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    p_sport_name,
    p_subtotal,
    p_discount_total,
    p_taxable_amount,
    p_tax_total,
    p_total_amount,
    p_gst_percent,
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_start_date,
    'renewal:' || p_renewal_id::text
  ) fi;

  update public.renewals
  set
    package_id = p_package_id,
    generated_invoice_id = invoice_id,
    cycle_start = p_start_date,
    cycle_end = v_cycle_end,
    due_date = v_cycle_end,
    balance_amount = 0,
    status = 'completed',
    processed_at = now(),
    updated_at = now()
  where id = p_renewal_id;

  update public.students
  set
    current_package_id = p_package_id,
    updated_at = now()
  where id = p_student_id;

  return next;
end;
$$;


ALTER FUNCTION "public"."complete_renewal_with_invoice"("p_renewal_id" "uuid", "p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_start_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_branch_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.branch_id from public.profiles p where p.id = auth.uid() limit 1;
$$;


ALTER FUNCTION "public"."current_branch_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.organization_id from public.profiles p where p.id = auth.uid() limit 1;
$$;


ALTER FUNCTION "public"."current_organization_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role"() RETURNS "public"."app_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.role from public.profiles p where p.id = auth.uid() limit 1;
$$;


ALTER FUNCTION "public"."current_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_invoice_update_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_paid numeric(12,2);
begin
  -- Cancelled invoices are immutable from a financial perspective.
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Cancelled invoices cannot be reactivated.';
  end if;

  if old.status = 'cancelled' and (
    new.total_amount is distinct from old.total_amount
    or new.subtotal is distinct from old.subtotal
    or new.tax_total is distinct from old.tax_total
    or new.discount_total is distinct from old.discount_total
    or new.balance_amount is distinct from old.balance_amount
  ) then
    raise exception 'Cancelled invoice totals are immutable.';
  end if;

  if new.status <> 'cancelled' then
    select coalesce(sum(amount), 0)::numeric(12,2)
      into v_paid
    from public.payments
    where invoice_id = old.id
      and status = 'completed';

    if new.total_amount < v_paid then
      raise exception 'Invoice total cannot be less than completed payments (%).', v_paid;
    end if;
  end if;

  if coalesce(new.balance_amount, 0) < 0 then
    raise exception 'Invoice balance cannot be negative.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_invoice_update_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_payment_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invoice record;
  v_paid numeric(12,2);
  v_existing_payment_id uuid;
begin
  if tg_op = 'UPDATE' and old.id is not null then
    v_existing_payment_id := old.id;
  else
    v_existing_payment_id := null;
  end if;

  if coalesce(new.amount, 0) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select id, organization_id, branch_id, total_amount, status
    into v_invoice
  from public.invoices
  where id = new.invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found for this payment.';
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Cannot record or update payments for cancelled invoices.';
  end if;

  if new.organization_id <> v_invoice.organization_id then
    raise exception 'Payment organization must match invoice organization.';
  end if;

  if new.branch_id <> v_invoice.branch_id then
    raise exception 'Payment branch must match invoice branch.';
  end if;

  if new.status = 'completed' then
    select coalesce(sum(amount), 0)::numeric(12,2)
      into v_paid
    from public.payments
    where invoice_id = new.invoice_id
      and status = 'completed'
      and (v_existing_payment_id is null or id <> v_existing_payment_id);

    if v_paid + new.amount > v_invoice.total_amount then
      raise exception 'Payment exceeds outstanding invoice amount.';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_payment_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_invoice_write"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid" DEFAULT NULL::"uuid", "p_invoice_date" "date" DEFAULT CURRENT_DATE, "p_invoice_number" "text" DEFAULT NULL::"text") RETURNS TABLE("invoice_id" "uuid", "invoice_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student record;
  v_organization_id uuid;
  v_branch_id uuid;
  v_invoice_number text;
  v_role public.app_role;
  v_caller_branch uuid;
  v_package record;
  v_sport record;
  v_request_key text;
  v_existing_invoice_id uuid;
  v_created_invoice_id uuid;
  v_created_invoice_number text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'Unable to resolve role context.';
  end if;

  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to finalize invoice write.';
  end if;

  select organization_id, branch_id
    into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    v_organization_id := v_student.organization_id;
  elsif v_organization_id <> v_student.organization_id then
    raise exception 'Student does not belong to the active organization.';
  end if;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization context.';
  end if;

  v_caller_branch := public.current_branch_id();

  if v_role = 'branch_manager' then
    if v_caller_branch is null then
      raise exception 'Unable to resolve branch manager branch context.';
    end if;

    if v_student.branch_id is distinct from v_caller_branch then
      raise exception 'Branch managers can only invoice students in their own branch.';
    end if;
  end if;

  v_branch_id := coalesce(p_preferred_branch_id, v_caller_branch, v_student.branch_id);
  if v_branch_id is null then
    raise exception 'Unable to resolve branch context.';
  end if;

  if v_role = 'branch_manager' and v_branch_id is distinct from v_caller_branch then
    raise exception 'Branch managers cannot write invoices for a different branch.';
  end if;

  perform 1
  from public.branches
  where id = v_branch_id
    and organization_id = v_organization_id;

  if not found then
    raise exception 'Branch does not belong to the active organization.';
  end if;

  select organization_id, branch_id, sport_id, status
    into v_package
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  if v_package.organization_id <> v_organization_id then
    raise exception 'Package does not belong to the active organization.';
  end if;

  if v_package.branch_id is not null and v_package.branch_id <> v_branch_id then
    raise exception 'Package does not belong to the selected branch.';
  end if;

  if v_package.sport_id <> p_sport_id then
    raise exception 'Package and sport mismatch.';
  end if;

  select organization_id, branch_id, status
    into v_sport
  from public.sports
  where id = p_sport_id;

  if not found then
    raise exception 'Sport not found.';
  end if;

  if v_sport.status <> 'active' then
    raise exception 'Sport is not active.';
  end if;

  if v_sport.organization_id <> v_organization_id then
    raise exception 'Sport does not belong to the active organization.';
  end if;

  if v_sport.branch_id is not null and v_sport.branch_id <> v_branch_id then
    raise exception 'Sport does not belong to the selected branch.';
  end if;

  if p_invoice_number is not null and btrim(p_invoice_number) <> '' then
    v_request_key := btrim(p_invoice_number);

    perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':' || v_request_key, 0));

    select iwr.invoice_id
      into v_existing_invoice_id
    from public.invoice_write_requests iwr
    where iwr.organization_id = v_organization_id
      and iwr.request_key = v_request_key;

    if v_existing_invoice_id is not null then
      select inv.id, inv.invoice_number
        into v_created_invoice_id, v_created_invoice_number
      from public.invoices inv
      where inv.id = v_existing_invoice_id;

      if v_created_invoice_id is not null then
        invoice_id := v_created_invoice_id;
        invoice_number := v_created_invoice_number;
        return next;
      end if;
    end if;

    insert into public.invoice_write_requests (organization_id, request_key)
    values (v_organization_id, v_request_key)
    on conflict (organization_id, request_key) do nothing;
  end if;

  v_invoice_number := public.generate_invoice_number(v_branch_id, p_invoice_date);

  insert into public.invoices (
    organization_id,
    branch_id,
    student_id,
    invoice_number,
    invoice_date,
    status,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    balance_amount,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    p_student_id,
    v_invoice_number,
    p_invoice_date,
    'completed',
    p_subtotal,
    p_tax_total,
    p_discount_total,
    p_total_amount,
    0,
    p_sport_name || ' fee invoice'
  )
  returning id, invoices.invoice_number into v_created_invoice_id, v_created_invoice_number;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    package_id,
    sport_id,
    description,
    quantity,
    unit_price,
    gst_percent,
    line_subtotal,
    line_tax,
    line_total
  ) values (
    v_organization_id,
    v_created_invoice_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    1,
    p_subtotal,
    p_gst_percent,
    p_taxable_amount,
    p_tax_total,
    p_total_amount
  );

  insert into public.payments (
    organization_id,
    branch_id,
    invoice_id,
    amount,
    payment_date,
    method,
    status,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    v_created_invoice_id,
    p_total_amount,
    now(),
    p_payment_method,
    'completed',
    'Payment received via ' || p_payment_mode_label
  );

  if v_request_key is not null then
    update public.invoice_write_requests
    set
      invoice_id = v_created_invoice_id,
      updated_at = now()
    where organization_id = v_organization_id
      and request_key = v_request_key;
  end if;

  invoice_id := v_created_invoice_id;
  invoice_number := v_created_invoice_number;
  return next;
end;
$$;


ALTER FUNCTION "public"."finalize_invoice_write"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb" DEFAULT NULL::"jsonb", "p_preferred_branch_id" "uuid" DEFAULT NULL::"uuid", "p_invoice_date" "date" DEFAULT CURRENT_DATE, "p_invoice_number" "text" DEFAULT NULL::"text") RETURNS TABLE("invoice_id" "uuid", "invoice_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_result record;
  v_item jsonb;
  v_default_item_id uuid;
  v_default_item_updated boolean := false;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_has_manual_items boolean := false;
begin
  select *
    into v_result
  from public.finalize_invoice_write(
    p_student_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    p_sport_name,
    p_subtotal,
    p_discount_total,
    p_taxable_amount,
    p_tax_total,
    p_total_amount,
    p_gst_percent,
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_invoice_date,
    p_invoice_number
  );

  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    v_has_manual_items := true;

    select ii.id
      into v_default_item_id
    from public.invoice_items ii
    where ii.invoice_id = v_result.invoice_id
    order by ii.created_at asc
    limit 1;

    for v_item in
      select value
      from jsonb_array_elements(p_manual_items)
    loop
      v_description := nullif(trim(coalesce(v_item ->> 'description', '')), '');
      v_quantity := greatest(coalesce((v_item ->> 'quantity')::numeric, 0), 0);
      v_unit_price := greatest(coalesce((v_item ->> 'unitPrice')::numeric, 0), 0);

      if v_description is null or v_quantity <= 0 then
        continue;
      end if;

      v_line_subtotal := round(v_quantity * v_unit_price, 2);
      v_line_tax := round(v_line_subtotal * greatest(p_gst_percent, 0) / 100, 2);
      v_line_total := round(v_line_subtotal + v_line_tax, 2);

      if v_default_item_id is not null and not v_default_item_updated then
        update public.invoice_items ii
        set
          package_id = p_package_id,
          sport_id = p_sport_id,
          description = v_description,
          quantity = v_quantity,
          unit_price = v_unit_price,
          gst_percent = p_gst_percent,
          line_subtotal = v_line_subtotal,
          line_tax = v_line_tax,
          line_total = v_line_total,
          updated_at = now()
        where ii.id = v_default_item_id;

        v_default_item_updated := true;
      else
        insert into public.invoice_items (
          organization_id,
          invoice_id,
          package_id,
          sport_id,
          description,
          quantity,
          unit_price,
          gst_percent,
          line_subtotal,
          line_tax,
          line_total
        )
        select
          inv.organization_id,
          v_result.invoice_id,
          p_package_id,
          p_sport_id,
          v_description,
          v_quantity,
          v_unit_price,
          p_gst_percent,
          v_line_subtotal,
          v_line_tax,
          v_line_total
        from public.invoices inv
        where inv.id = v_result.invoice_id;
      end if;
    end loop;

    if not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id) then
      v_has_manual_items := false;
    end if;
  end if;

  if not v_has_manual_items then
    insert into public.invoice_items (
      organization_id,
      invoice_id,
      package_id,
      sport_id,
      description,
      quantity,
      unit_price,
      gst_percent,
      line_subtotal,
      line_tax,
      line_total
    )
    select
      inv.organization_id,
      v_result.invoice_id,
      p_package_id,
      p_sport_id,
      p_package_name,
      1,
      p_subtotal,
      p_gst_percent,
      p_taxable_amount,
      p_tax_total,
      p_total_amount
    from public.invoices inv
    where inv.id = v_result.invoice_id
      and not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id);
  end if;

  invoice_id := v_result.invoice_id;
  invoice_number := v_result.invoice_number;
  return next;
end;
$$;


ALTER FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_branch_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return 'BR-' || lpad(nextval('public.seq_branch')::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_branch_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date" DEFAULT CURRENT_DATE) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_organization_id uuid;
  v_seq integer;
begin
  select b.organization_id
    into v_organization_id
  from public.branches b
  where b.id = p_branch_id;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization for branch % while generating invoice number.', p_branch_id;
  end if;

  v_seq := public.next_ref_counter('invoice:' || v_organization_id::text);

  return format('INV-KS-%s', lpad(v_seq::text, 3, '0'));
end;
$$;


ALTER FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_count integer := 0;
begin
  v_cycle_start := date_trunc('month', p_run_date)::date;
  v_cycle_end := (date_trunc('month', p_run_date) + interval '1 month - 1 day')::date;

  insert into public.renewals (
    organization_id,
    branch_id,
    student_id,
    package_id,
    cycle_start,
    cycle_end,
    due_date,
    status,
    balance_amount
  )
  select
    s.organization_id,
    s.branch_id,
    s.id,
    p.id,
    v_cycle_start,
    v_cycle_end,
    v_cycle_end,
    'pending',
    p.amount
  from public.students s
  join public.packages p
    on p.id = s.current_package_id
  where s.status = 'active'
    and p.status = 'active'
    and p.billing_type = 'recurring_monthly'
  on conflict (student_id, package_id, cycle_start, cycle_end) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_org_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return 'ORG-' || lpad(nextval('public.seq_org')::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_org_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_package_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return 'PKG-' || lpad(nextval('public.seq_package')::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."generate_package_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('payment:' || v_year);
  return format('PAY-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
end;
$$;


ALTER FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_profile_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return 'USR-' || lpad(nextval('public.seq_profile')::text, 6, '0');
end;
$$;


ALTER FUNCTION "public"."generate_profile_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('renewal:' || v_year);
  return format('REN-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
end;
$$;


ALTER FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_student_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return 'STU-' || lpad(nextval('public.seq_student')::text, 6, '0');
end;
$$;


ALTER FUNCTION "public"."generate_student_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_name text;
  v_prefix text;
  v_seq integer;
begin
  select name
    into v_branch_name
  from public.branches
  where id = p_branch_id;

  v_prefix := substring(regexp_replace(upper(coalesce(v_branch_name, 'BRN')), '[^A-Z]', '', 'g') from 1 for 3);
  v_prefix := rpad(coalesce(nullif(v_prefix, ''), 'BRN'), 3, 'X');

  -- Counter is shared by prefix so IDs remain unique even if branch names are similar.
  v_seq := public.next_ref_counter('student:' || v_prefix);

  return v_prefix || lpad(v_seq::text, 2, '0');
end;
$$;


ALTER FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  insert into public.audit_logs (
    organization_id,
    branch_id,
    actor_user_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    previous_value,
    new_value
  )
  values (
    p_org_id,
    p_branch_id,
    auth.uid(),
    auth.uid(),
    p_table_name,
    p_record_id,
    p_action,
    p_previous,
    p_next
  );
$$;


ALTER FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.current_role() = 'super_admin', false);
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
  v_branch_id uuid;
  v_record_id uuid;
  v_action public.audit_action;
begin
  if tg_op = 'INSERT' then
    v_org_id := (to_jsonb(new)->>'organization_id')::uuid;
    v_branch_id := nullif(to_jsonb(new)->>'branch_id', '')::uuid;
    v_record_id := (to_jsonb(new)->>'id')::uuid;

    perform public.insert_audit_log(
      tg_table_name,
      v_record_id,
      v_org_id,
      v_branch_id,
      'insert',
      null,
      to_jsonb(new)
    );

    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_org_id := coalesce((to_jsonb(new)->>'organization_id')::uuid, (to_jsonb(old)->>'organization_id')::uuid);
    v_branch_id := coalesce(nullif(to_jsonb(new)->>'branch_id', '')::uuid, nullif(to_jsonb(old)->>'branch_id', '')::uuid);
    v_record_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);

    v_action := public.audit_action_for_change(
      tg_table_name,
      to_jsonb(old)->>'status',
      to_jsonb(new)->>'status'
    );

    perform public.insert_audit_log(
      tg_table_name,
      v_record_id,
      v_org_id,
      v_branch_id,
      v_action,
      to_jsonb(old),
      to_jsonb(new)
    );

    return new;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."log_audit_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_org_invoice_counter"("p_organization_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_next bigint;
begin
  if p_organization_id is null then
    raise exception 'Organization context is required for invoice numbering.';
  end if;

  insert into public.organization_invoice_counters (organization_id, last_number, updated_at)
  values (p_organization_id, 1, now())
  on conflict (organization_id)
  do update
    set last_number = public.organization_invoice_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;

  return v_next;
end;
$$;


ALTER FUNCTION "public"."next_org_invoice_counter"("p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_ref_counter"("p_key" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_next integer;
begin
  insert into public.ref_counters (counter_key, last_number)
  values (p_key, 1)
  on conflict (counter_key)
  do update set last_number = ref_counters.last_number + 1
  returning last_number into v_next;
  return v_next;
end;
$$;


ALTER FUNCTION "public"."next_ref_counter"("p_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_payment_change_sync_invoice"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.sync_invoice_payment_status(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."on_payment_change_sync_invoice"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if coalesce(current_setting('app.allow_hard_delete', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'Hard delete is disabled for this table. Use status or archived fields instead.';
end;
$$;


ALTER FUNCTION "public"."prevent_hard_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_admin_profile_for_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if lower(coalesce(new.email, '')) = 'admin@kickstartaccounts.com' then
    insert into public.profiles (
      id,
      organization_id,
      branch_id,
      role,
      full_name,
      status
    ) values (
      new.id,
      null,
      null,
      'super_admin',
      coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), 'Admin'),
      'active'
    )
    on conflict (id) do update
      set organization_id = null,
          branch_id = null,
          role = 'super_admin',
          full_name = excluded.full_name,
          status = 'active',
          updated_at = now();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_admin_profile_for_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_invoice_after_invoice_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status <> 'cancelled' and (
    new.total_amount is distinct from old.total_amount
    or new.subtotal is distinct from old.subtotal
    or new.tax_total is distinct from old.tax_total
    or new.discount_total is distinct from old.discount_total
  ) then
    perform public.sync_invoice_payment_status(new.id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_invoice_after_invoice_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status public.invoice_status;
begin
  select total_amount into v_total
  from public.invoices
  where id = p_invoice_id;

  if v_total is null then
    return;
  end if;

  select coalesce(sum(amount), 0)
  into v_paid
  from public.payments
  where invoice_id = p_invoice_id
    and status = 'completed';

  v_new_balance := greatest(v_total - v_paid, 0);

  if exists (select 1 from public.invoices where id = p_invoice_id and status = 'cancelled') then
    return;
  end if;

  if v_new_balance = 0 then
    v_new_status := 'completed';
  elsif v_paid = 0 then
    v_new_status := 'unpaid';
  else
    v_new_status := 'partial';
  end if;

  update public.invoices
  set
    balance_amount = v_new_balance,
    status = v_new_status,
    updated_at = now()
  where id = p_invoice_id
    and (
      balance_amount is distinct from v_new_balance
      or status is distinct from v_new_status
    );
end;
$$;


ALTER FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_branch_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_branch_ref_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_branch_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_org_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_org_ref_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_org_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_package_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_package_ref_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_package_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_payment_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_payment_ref_id(new.payment_date);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_payment_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_profile_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_profile_ref_id();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_profile_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_renewal_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_renewal_ref_id(now());
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_renewal_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_student_ref_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_student_ref_id(new.branch_id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."trg_set_student_ref_id"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date",
    "status" "public"."invoice_status" DEFAULT 'draft'::"public"."invoice_status" NOT NULL,
    "currency" character(3) DEFAULT 'INR'::"bpchar" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "balance_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "archived_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_balance_amount_check" CHECK (("balance_amount" >= (0)::numeric)),
    CONSTRAINT "invoices_currency_check" CHECK (("currency" = 'INR'::"bpchar")),
    CONSTRAINT "invoices_discount_total_check" CHECK (("discount_total" >= (0)::numeric)),
    CONSTRAINT "invoices_subtotal_check" CHECK (("subtotal" >= (0)::numeric)),
    CONSTRAINT "invoices_tax_total_check" CHECK (("tax_total" >= (0)::numeric)),
    CONSTRAINT "invoices_total_amount_check" CHECK (("total_amount" >= (0)::numeric))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."accounting_invoice_totals" WITH ("security_invoker"='on') AS
 SELECT "organization_id",
    "branch_id",
    "count"(*) AS "invoice_count",
    (COALESCE("sum"("total_amount"), (0)::numeric))::numeric(12,2) AS "total_billed",
    (COALESCE("sum"("balance_amount"), (0)::numeric))::numeric(12,2) AS "total_pending",
    (COALESCE("sum"(("total_amount" - "balance_amount")), (0)::numeric))::numeric(12,2) AS "total_collected"
   FROM "public"."invoices"
  WHERE ("status" <> 'cancelled'::"public"."invoice_status")
  GROUP BY "organization_id", "branch_id";


ALTER VIEW "public"."accounting_invoice_totals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" bigint NOT NULL,
    "organization_id" "uuid",
    "branch_id" "uuid",
    "actor_user_id" "uuid",
    "actor_profile_id" "uuid",
    "table_name" "text" NOT NULL,
    "record_id" "uuid",
    "action" "public"."audit_action" NOT NULL,
    "previous_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_logs_id_seq" OWNED BY "public"."audit_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "email" "text",
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    "image" "text"
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gst_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "percentage" numeric(5,2) NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "gst_rates_percentage_check" CHECK ((("percentage" >= (0)::numeric) AND ("percentage" <= (100)::numeric)))
);


ALTER TABLE "public"."gst_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "package_id" "uuid",
    "sport_id" "uuid",
    "description" "text" NOT NULL,
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "gst_percent" numeric(5,2) DEFAULT 18 NOT NULL,
    "line_subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoice_items_gst_percent_check" CHECK (("gst_percent" >= (0)::numeric)),
    CONSTRAINT "invoice_items_line_subtotal_check" CHECK (("line_subtotal" >= (0)::numeric)),
    CONSTRAINT "invoice_items_line_tax_check" CHECK (("line_tax" >= (0)::numeric)),
    CONSTRAINT "invoice_items_line_total_check" CHECK (("line_total" >= (0)::numeric)),
    CONSTRAINT "invoice_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "invoice_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_write_requests" (
    "organization_id" "uuid" NOT NULL,
    "request_key" "text" NOT NULL,
    "invoice_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_write_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_invoice_counters" (
    "organization_id" "uuid" NOT NULL,
    "last_number" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_invoice_counters_last_number_check" CHECK (("last_number" >= 0))
);


ALTER TABLE "public"."organization_invoice_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    "gst_number" "text",
    "pan_number" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "logo_url" "text",
    "upi_id" "text",
    "upi_qr_url" "text"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "sport_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "billing_type" "public"."package_billing_type" NOT NULL,
    "duration_months" integer DEFAULT 1 NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "gst_percent" numeric(5,2) DEFAULT 18 NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    "branch_id" "uuid",
    CONSTRAINT "packages_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "packages_duration_months_check" CHECK (("duration_months" > 0)),
    CONSTRAINT "packages_gst_percent_check" CHECK (("gst_percent" >= (0)::numeric))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "payment_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "method" "public"."payment_method" NOT NULL,
    "status" "public"."payment_status" DEFAULT 'completed'::"public"."payment_status" NOT NULL,
    "reference_no" "text",
    "notes" "text",
    "archived_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    CONSTRAINT "payments_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "branch_id" "uuid",
    "role" "public"."app_role" NOT NULL,
    "full_name" "text",
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    CONSTRAINT "profiles_role_scope_check" CHECK (((("role" = 'super_admin'::"public"."app_role") AND ("organization_id" IS NULL) AND ("branch_id" IS NULL)) OR (("role" = 'organization_admin'::"public"."app_role") AND ("organization_id" IS NOT NULL) AND ("branch_id" IS NULL)) OR (("role" = 'branch_manager'::"public"."app_role") AND ("organization_id" IS NOT NULL) AND ("branch_id" IS NOT NULL))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ref_counters" (
    "counter_key" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ref_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."renewals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "package_id" "uuid" NOT NULL,
    "source_invoice_id" "uuid",
    "generated_invoice_id" "uuid",
    "cycle_start" "date" NOT NULL,
    "cycle_end" "date" NOT NULL,
    "due_date" "date" NOT NULL,
    "status" "public"."renewal_status" DEFAULT 'pending'::"public"."renewal_status" NOT NULL,
    "balance_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text",
    CONSTRAINT "renewals_balance_amount_check" CHECK (("balance_amount" >= (0)::numeric))
);


ALTER TABLE "public"."renewals" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_branch"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_branch" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_org"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_org" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_package"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_package" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_profile"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_profile" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seq_student"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seq_student" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch_id" "uuid"
);


ALTER TABLE "public"."sports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "current_package_id" "uuid",
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "email" "text",
    "joined_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "status" "public"."record_status" DEFAULT 'active'::"public"."record_status" NOT NULL,
    "archived_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ref_id" "text"
);


ALTER TABLE "public"."students" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_organization_id_name_key" UNIQUE ("organization_id", "name");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."gst_rates"
    ADD CONSTRAINT "gst_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_write_requests"
    ADD CONSTRAINT "invoice_write_requests_pkey" PRIMARY KEY ("organization_id", "request_key");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_id_invoice_number_key" UNIQUE ("organization_id", "invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invoice_counters"
    ADD CONSTRAINT "organization_invoice_counters_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_organization_id_sport_id_name_key" UNIQUE ("organization_id", "sport_id", "name");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."ref_counters"
    ADD CONSTRAINT "ref_counters_pkey" PRIMARY KEY ("counter_key");



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_ref_id_key" UNIQUE ("ref_id");



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_student_id_package_id_cycle_start_cycle_end_key" UNIQUE ("student_id", "package_id", "cycle_start", "cycle_end");



ALTER TABLE ONLY "public"."sports"
    ADD CONSTRAINT "sports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_organization_id_phone_key" UNIQUE ("organization_id", "phone");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_ref_id_key" UNIQUE ("ref_id");



CREATE INDEX "idx_branches_org_archived_name" ON "public"."branches" USING "btree" ("organization_id", "archived_at", "name");



CREATE INDEX "idx_gst_rates_organization_id" ON "public"."gst_rates" USING "btree" ("organization_id");



CREATE INDEX "idx_invoice_items_invoice_id" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_items_org_invoice" ON "public"."invoice_items" USING "btree" ("organization_id", "invoice_id");



CREATE INDEX "idx_invoice_write_requests_invoice_id" ON "public"."invoice_write_requests" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoices_org_archived_date_desc" ON "public"."invoices" USING "btree" ("organization_id", "archived_at", "invoice_date" DESC);



CREATE INDEX "idx_invoices_org_branch_date_desc" ON "public"."invoices" USING "btree" ("organization_id", "branch_id", "invoice_date" DESC);



CREATE INDEX "idx_invoices_student_date_desc" ON "public"."invoices" USING "btree" ("student_id", "invoice_date" DESC);



CREATE INDEX "idx_packages_branch_id" ON "public"."packages" USING "btree" ("branch_id");



CREATE INDEX "idx_packages_org_archived_name" ON "public"."packages" USING "btree" ("organization_id", "archived_at", "name");



CREATE INDEX "idx_payments_invoice_status" ON "public"."payments" USING "btree" ("invoice_id", "status");



CREATE INDEX "idx_payments_org_invoice_status" ON "public"."payments" USING "btree" ("organization_id", "invoice_id", "status");



CREATE INDEX "idx_renewals_org_status_due_date" ON "public"."renewals" USING "btree" ("organization_id", "status", "due_date");



CREATE INDEX "idx_renewals_student_due_date" ON "public"."renewals" USING "btree" ("student_id", "due_date" DESC);



CREATE INDEX "idx_sports_branch_id" ON "public"."sports" USING "btree" ("branch_id");



CREATE INDEX "idx_sports_org_archived_name" ON "public"."sports" USING "btree" ("organization_id", "archived_at", "name");



CREATE INDEX "idx_students_org_archived_name" ON "public"."students" USING "btree" ("organization_id", "archived_at", "name");



CREATE INDEX "idx_students_org_branch_archived_name" ON "public"."students" USING "btree" ("organization_id", "branch_id", "archived_at", "name");



CREATE INDEX "idx_students_org_package" ON "public"."students" USING "btree" ("organization_id", "current_package_id");



CREATE UNIQUE INDEX "uq_gst_rates_org_name_active" ON "public"."gst_rates" USING "btree" ("organization_id", "name") WHERE ("archived_at" IS NULL);



CREATE UNIQUE INDEX "uq_payments_invoice_reference_no" ON "public"."payments" USING "btree" ("invoice_id", "reference_no") WHERE (("reference_no" IS NOT NULL) AND ("status" = 'completed'::"public"."payment_status"));



CREATE UNIQUE INDEX "uq_sports_org_branch_name" ON "public"."sports" USING "btree" ("organization_id", "branch_id", "name") WHERE ("branch_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_sports_org_name_global" ON "public"."sports" USING "btree" ("organization_id", "name") WHERE ("branch_id" IS NULL);



CREATE OR REPLACE TRIGGER "audit_logs_prevent_delete" BEFORE DELETE ON "public"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "branches_set_ref_id" BEFORE INSERT ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_branch_ref_id"();



CREATE OR REPLACE TRIGGER "branches_set_updated_at" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "gst_rates_prevent_delete" BEFORE DELETE ON "public"."gst_rates" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "gst_rates_set_updated_at" BEFORE UPDATE ON "public"."gst_rates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoice_items_audit_trigger" AFTER INSERT OR UPDATE ON "public"."invoice_items" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "invoice_items_prevent_delete" BEFORE DELETE ON "public"."invoice_items" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "invoice_items_set_updated_at" BEFORE UPDATE ON "public"."invoice_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoice_write_requests_set_updated_at" BEFORE UPDATE ON "public"."invoice_write_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoices_audit_trigger" AFTER INSERT OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "invoices_enforce_update_integrity" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_invoice_update_integrity"();



CREATE OR REPLACE TRIGGER "invoices_prevent_delete" BEFORE DELETE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "invoices_set_updated_at" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "invoices_sync_after_update_trigger" AFTER UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."sync_invoice_after_invoice_update"();



CREATE OR REPLACE TRIGGER "organizations_set_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "orgs_set_ref_id" BEFORE INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_org_ref_id"();



CREATE OR REPLACE TRIGGER "packages_audit_trigger" AFTER INSERT OR UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "packages_set_ref_id" BEFORE INSERT ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_package_ref_id"();



CREATE OR REPLACE TRIGGER "packages_set_updated_at" BEFORE UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "payment_sync_invoice_trigger" AFTER INSERT OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."on_payment_change_sync_invoice"();



CREATE OR REPLACE TRIGGER "payments_audit_trigger" AFTER INSERT OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



CREATE OR REPLACE TRIGGER "payments_enforce_integrity" BEFORE INSERT OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_payment_integrity"();



CREATE OR REPLACE TRIGGER "payments_prevent_delete" BEFORE DELETE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "payments_set_ref_id" BEFORE INSERT ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_payment_ref_id"();



CREATE OR REPLACE TRIGGER "payments_set_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_set_ref_id" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_profile_ref_id"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "renewals_prevent_delete" BEFORE DELETE ON "public"."renewals" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "renewals_set_ref_id" BEFORE INSERT ON "public"."renewals" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_renewal_ref_id"();



CREATE OR REPLACE TRIGGER "renewals_set_updated_at" BEFORE UPDATE ON "public"."renewals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sports_set_updated_at" BEFORE UPDATE ON "public"."sports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "students_prevent_delete" BEFORE DELETE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_hard_delete"();



CREATE OR REPLACE TRIGGER "students_set_ref_id" BEFORE INSERT ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_student_ref_id"();



CREATE OR REPLACE TRIGGER "students_set_updated_at" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "users_audit_trigger" AFTER UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit_event"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."gst_rates"
    ADD CONSTRAINT "gst_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_write_requests"
    ADD CONSTRAINT "invoice_write_requests_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_write_requests"
    ADD CONSTRAINT "invoice_write_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."organization_invoice_counters"
    ADD CONSTRAINT "organization_invoice_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_generated_invoice_id_fkey" FOREIGN KEY ("generated_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."renewals"
    ADD CONSTRAINT "renewals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sports"
    ADD CONSTRAINT "sports_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sports"
    ADD CONSTRAINT "sports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_current_package_id_fkey" FOREIGN KEY ("current_package_id") REFERENCES "public"."packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_policy" ON "public"."audit_logs" FOR INSERT WITH CHECK ("public"."can_access_organization"("organization_id"));



CREATE POLICY "audit_logs_select_policy" ON "public"."audit_logs" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "branches_insert_policy" ON "public"."branches" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()))));



CREATE POLICY "branches_select_policy" ON "public"."branches" FOR SELECT USING ("public"."can_access_organization"("organization_id"));



CREATE POLICY "branches_update_policy" ON "public"."branches" FOR UPDATE USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()))));



ALTER TABLE "public"."gst_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gst_rates_select_policy" ON "public"."gst_rates" FOR SELECT USING (("public"."is_super_admin"() OR ("organization_id" = "public"."current_organization_id"())));



CREATE POLICY "gst_rates_write_policy" ON "public"."gst_rates" USING (("public"."is_super_admin"() OR (("public"."current_role"() = ANY (ARRAY['organization_admin'::"public"."app_role", 'branch_manager'::"public"."app_role"])) AND ("organization_id" = "public"."current_organization_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = ANY (ARRAY['organization_admin'::"public"."app_role", 'branch_manager'::"public"."app_role"])) AND ("organization_id" = "public"."current_organization_id"()))));



ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_items_select_policy" ON "public"."invoice_items" FOR SELECT USING ("public"."can_access_organization"("organization_id"));



CREATE POLICY "invoice_items_write_policy" ON "public"."invoice_items" USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_items"."invoice_id") AND ("i"."branch_id" = "public"."current_branch_id"()))))))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_items"."invoice_id") AND ("i"."branch_id" = "public"."current_branch_id"())))))));



ALTER TABLE "public"."invoice_write_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_write_requests_deny_all" ON "public"."invoice_write_requests" AS RESTRICTIVE USING (false) WITH CHECK (false);



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_insert_policy" ON "public"."invoices" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()) AND ("organization_id" = "public"."current_organization_id"()))));



CREATE POLICY "invoices_select_policy" ON "public"."invoices" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "invoices_update_policy" ON "public"."invoices" FOR UPDATE USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."organization_invoice_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_invoice_counters_deny_all" ON "public"."organization_invoice_counters" USING (false) WITH CHECK (false);



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_select_policy" ON "public"."organizations" FOR SELECT USING ("public"."can_access_organization"("id"));



CREATE POLICY "organizations_write_policy" ON "public"."organizations" USING (("public"."is_super_admin"() OR (("public"."current_role"() = ANY (ARRAY['organization_admin'::"public"."app_role", 'branch_manager'::"public"."app_role"])) AND ("id" = "public"."current_organization_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = ANY (ARRAY['organization_admin'::"public"."app_role", 'branch_manager'::"public"."app_role"])) AND ("id" = "public"."current_organization_id"()))));



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages_select_policy" ON "public"."packages" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "packages_write_policy" ON "public"."packages" USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_insert_policy" ON "public"."payments" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()) AND ("organization_id" = "public"."current_organization_id"()))));



CREATE POLICY "payments_select_policy" ON "public"."payments" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "payments_update_policy" ON "public"."payments" FOR UPDATE USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_policy" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()))));



CREATE POLICY "profiles_update_policy" ON "public"."profiles" FOR UPDATE USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())))) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()))));



ALTER TABLE "public"."ref_counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ref_counters_deny_all" ON "public"."ref_counters" AS RESTRICTIVE USING (false);



ALTER TABLE "public"."renewals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "renewals_select_policy" ON "public"."renewals" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "renewals_write_policy" ON "public"."renewals" USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."sports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sports_select_policy" ON "public"."sports" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "sports_write_policy" ON "public"."sports" USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students_insert_policy" ON "public"."students" FOR INSERT WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()) AND ("organization_id" = "public"."current_organization_id"()))));



CREATE POLICY "students_select_policy" ON "public"."students" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



CREATE POLICY "students_update_policy" ON "public"."students" FOR UPDATE USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_student_enrollment_atomic"("p_student_id" "uuid", "p_package_id" "uuid", "p_branch_id" "uuid", "p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_student_enrollment_atomic"("p_student_id" "uuid", "p_package_id" "uuid", "p_branch_id" "uuid", "p_start_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_student_enrollment_atomic"("p_student_id" "uuid", "p_package_id" "uuid", "p_branch_id" "uuid", "p_start_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reset_invoices"("p_organization_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reset_invoices"("p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reset_invoices"("p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_action_for_change"("p_table_name" "text", "p_old_status" "text", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."audit_action_for_change"("p_table_name" "text", "p_old_status" "text", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_action_for_change"("p_table_name" "text", "p_old_status" "text", "p_new_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_branch"("target_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_branch"("target_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_branch"("target_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_access_organization"("target_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_organization"("target_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_organization"("target_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_manage_branch_image_object"("p_object_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can_manage_branch_image_object"("p_object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_manage_branch_image_object"("p_object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_renewal_with_invoice"("p_renewal_id" "uuid", "p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_start_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_renewal_with_invoice"("p_renewal_id" "uuid", "p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_start_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_renewal_with_invoice"("p_renewal_id" "uuid", "p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_start_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_branch_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_branch_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_branch_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_organization_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_organization_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_invoice_update_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_invoice_update_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_invoice_update_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_payment_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_payment_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_payment_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_invoice_write"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_invoice_write"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_invoice_write"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb", "p_preferred_branch_id" "uuid", "p_invoice_date" "date", "p_invoice_number" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_branch_ref_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_branch_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_branch_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_branch_ref_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_org_ref_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_org_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_org_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_org_ref_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_package_ref_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_package_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_package_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_package_ref_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_profile_ref_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_profile_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_profile_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_profile_ref_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_student_ref_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_audit_log"("p_table_name" "text", "p_record_id" "uuid", "p_org_id" "uuid", "p_branch_id" "uuid", "p_action" "public"."audit_action", "p_previous" "jsonb", "p_next" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_org_invoice_counter"("p_organization_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_org_invoice_counter"("p_organization_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_ref_counter"("p_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_ref_counter"("p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."next_ref_counter"("p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_ref_counter"("p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."on_payment_change_sync_invoice"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_payment_change_sync_invoice"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_payment_change_sync_invoice"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_hard_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_admin_profile_for_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_admin_profile_for_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_admin_profile_for_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_invoice_after_invoice_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_invoice_after_invoice_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_invoice_after_invoice_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_invoice_payment_status"("p_invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_branch_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_branch_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_branch_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_org_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_org_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_org_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_package_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_package_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_package_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_payment_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_payment_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_payment_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_profile_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_profile_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_profile_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_renewal_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_renewal_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_renewal_ref_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_student_ref_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_student_ref_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_student_ref_id"() TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_invoice_totals" TO "anon";
GRANT ALL ON TABLE "public"."accounting_invoice_totals" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_invoice_totals" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."gst_rates" TO "anon";
GRANT ALL ON TABLE "public"."gst_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."gst_rates" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_write_requests" TO "anon";
GRANT ALL ON TABLE "public"."invoice_write_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_write_requests" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invoice_counters" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."packages" TO "anon";
GRANT ALL ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."ref_counters" TO "anon";
GRANT ALL ON TABLE "public"."ref_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."ref_counters" TO "service_role";



GRANT ALL ON TABLE "public"."renewals" TO "anon";
GRANT ALL ON TABLE "public"."renewals" TO "authenticated";
GRANT ALL ON TABLE "public"."renewals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_branch" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_branch" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_branch" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_org" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_org" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_org" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_package" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_package" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_package" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_profile" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_profile" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_profile" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seq_student" TO "anon";
GRANT ALL ON SEQUENCE "public"."seq_student" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seq_student" TO "service_role";



GRANT ALL ON TABLE "public"."sports" TO "anon";
GRANT ALL ON TABLE "public"."sports" TO "authenticated";
GRANT ALL ON TABLE "public"."sports" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







