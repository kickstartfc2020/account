-- F2: renewal pricing source of truth.
--
-- Business rule: the package determines the renewal amount at the moment
-- the renewal is created (enrollment or monthly generation). That amount is
-- stored on renewals.balance_amount. Once a renewal row exists, its
-- balance_amount is the authoritative pending amount -- a later change to
-- packages.amount must never change what an already-generated pending
-- renewal bills, and completing the renewal must invoice exactly that
-- stored amount, not whatever the client happens to submit.
--
-- Three call sites touched, no schema change (renewals.balance_amount
-- already exists and already means "amount owed for this renewal" -- no new
-- column is needed):
--
--   1. complete_renewal_with_invoice: now reads renewals.balance_amount as
--      the authoritative base amount, recomputes GST/tax/total server-side
--      from the package's current gst_percent (mirroring the same formula
--      used elsewhere in this schema -- see finalize_invoice_write_v2 /
--      src/lib/billingMath.ts), and rejects the call outright if the
--      client-supplied p_package_id does not match the package already
--      recorded on the renewal (no silent package switch during renewal
--      completion). Client-supplied p_subtotal/p_taxable_amount/p_tax_total/
--      p_total_amount/p_gst_percent are accepted for signature
--      compatibility but are no longer trusted or written anywhere.
--      renewals.balance_amount/status are then set from the invoice that
--      was actually created (invoices.balance_amount/status) instead of
--      being hardcoded to 0/'completed'.
--   2. generate_monthly_renewals: uses
--      COALESCE(students.enrolled_price, packages.amount) instead of always
--      the live package price, so a student with a locked-in enrolled price
--      keeps that price on every renewal generated for them.
--   3. add_student_enrollment_atomic: same COALESCE, applied to the
--      brand-new renewal created at enrollment time, so the enrollment-time
--      renewal is consistent with (2) from day one.
--
-- Explicitly out of scope: renewal_status has no 'partial' value, and adding
-- one is a larger enum/schema change than this fix calls for. A renewal
-- whose invoice ends up with a nonzero balance (a future partial-payment
-- path) still gets status = 'completed' (the renewal cycle has been
-- processed/invoiced) but a true, non-zero balance_amount reflecting what's
-- actually still owed -- today, renewal completion never accepts a partial
-- payment amount, so this is a no-behavior-change today and only matters if
-- that capability is added later.
--
-- Existing pending renewals with balance_amount = 0 (created before this
-- fix, or during a gap where the price snapshot never ran) are NOT
-- backfilled or recalculated by this migration -- see the migration header
-- comment in the accompanying remediation notes for the reporting query and
-- recommended manual remediation path. complete_renewal_with_invoice now
-- explicitly refuses to complete such a renewal (raises an exception)
-- rather than silently generating a zero-value invoice.

-- ---------------------------------------------------------------------------
-- 1. complete_renewal_with_invoice
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_renewal_with_invoice(p_renewal_id uuid, p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_renewal record;
  v_package record;
  v_cycle_end date;
  v_base_amount numeric(12,2);
  v_taxable_amount numeric(12,2);
  v_tax_total numeric(12,2);
  v_total_amount numeric(12,2);
  v_invoice_balance numeric(12,2);
  v_invoice_status public.invoice_status;
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

  -- The package locked in when this renewal was generated is authoritative.
  -- Completing a renewal cannot be used to silently move the student onto a
  -- different package/price; that is a separate enrollment change.
  if p_package_id is distinct from v_renewal.package_id then
    raise exception 'Selected batch does not match the batch on this renewal. Change the batch via the student''s enrollment, not renewal completion.';
  end if;

  select id, duration_months, gst_percent, status
    into v_package
  from public.packages
  where id = v_renewal.package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  -- Authoritative amount: renewals.balance_amount, fixed at renewal
  -- generation time. Client-supplied p_subtotal/p_taxable_amount/
  -- p_tax_total/p_total_amount/p_gst_percent are intentionally ignored.
  v_base_amount := round(coalesce(v_renewal.balance_amount, 0), 2);

  if v_base_amount <= 0 then
    raise exception 'This renewal has no billable amount on record (balance_amount = 0). It cannot be completed automatically -- have an administrator verify and correct the renewal amount first.';
  end if;

  v_taxable_amount := v_base_amount;
  v_tax_total := round(v_taxable_amount * greatest(coalesce(v_package.gst_percent, 0), 0) / 100, 2);
  v_total_amount := round(v_taxable_amount + v_tax_total, 2);

  v_cycle_end := (p_start_date + make_interval(months => coalesce(v_package.duration_months, 1)) - interval '1 day')::date;

  select fi.invoice_id, fi.invoice_number
    into invoice_id, invoice_number
  from public.finalize_invoice_write(
    p_student_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    p_sport_name,
    v_base_amount,
    0,
    v_taxable_amount,
    v_tax_total,
    v_total_amount,
    coalesce(v_package.gst_percent, 0),
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_start_date,
    'renewal:' || p_renewal_id::text
  ) fi;

  select inv.balance_amount, inv.status
    into v_invoice_balance, v_invoice_status
  from public.invoices inv
  where inv.id = invoice_id;

  update public.renewals
  set
    generated_invoice_id = invoice_id,
    cycle_start = p_start_date,
    cycle_end = v_cycle_end,
    due_date = v_cycle_end,
    balance_amount = coalesce(v_invoice_balance, 0),
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
$function$
;

-- ---------------------------------------------------------------------------
-- 2. generate_monthly_renewals: enrollment-time price, not live package price
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_monthly_renewals(p_run_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_count integer := 0;
begin
  -- Authorization is enforced at the grant level (EXECUTE revoked from
  -- anon/authenticated, granted only to service_role) -- unchanged from the
  -- phase-1 security hardening migration.

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
    coalesce(s.enrolled_price, p.amount)
  from public.students s
  join public.packages p
    on p.id = s.current_package_id
  where s.status = 'active'
    and p.status = 'active'
    and p.billing_type = 'recurring_monthly'
  on conflict (student_id, package_id, cycle_start, cycle_end) do nothing;

  get diagnostics v_count = row_count;

  insert into public.rpc_audit_log (action, actor_id, organization_id, details)
  values (
    'generate_monthly_renewals',
    auth.uid(),
    null,
    jsonb_build_object('run_date', p_run_date, 'cycle_start', v_cycle_start, 'cycle_end', v_cycle_end, 'rows_inserted', v_count)
  );

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. add_student_enrollment_atomic: same COALESCE for the enrollment-time
--    renewal, consistent with (2).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_student_enrollment_atomic(p_student_id uuid, p_package_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT CURRENT_DATE) RETURNS TABLE(package_id uuid, renewal_id uuid, cycle_start date, cycle_end date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

  select id, organization_id, branch_id, enrolled_price
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
    coalesce(v_student.enrolled_price, v_package.amount, 0)
  )
  returning id into v_new_renewal_id;

  package_id := p_package_id;
  renewal_id := v_new_renewal_id;
  cycle_start := v_start_date;
  cycle_end := v_cycle_end_date;
  return next;
end;
$$;
