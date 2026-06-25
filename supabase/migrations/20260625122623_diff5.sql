drop view if exists "public"."accounting_invoice_totals";

alter table "public"."invoice_items" drop column "cgst_amount";

alter table "public"."invoice_items" drop column "sgst_amount";

alter table "public"."invoices" drop column "cgst_amount";

alter table "public"."invoices" drop column "sgst_amount";

set check_function_bodies = off;

create or replace view "public"."accounting_invoice_totals" as  SELECT organization_id,
    branch_id,
    count(*) AS invoice_count,
    (COALESCE(sum(total_amount), (0)::numeric))::numeric(12,2) AS total_billed,
    (COALESCE(sum(balance_amount), (0)::numeric))::numeric(12,2) AS total_pending,
    (COALESCE(sum((total_amount - balance_amount)), (0)::numeric))::numeric(12,2) AS total_collected
   FROM public.invoices
  WHERE (status <> 'cancelled'::public.invoice_status)
  GROUP BY organization_id, branch_id;


CREATE OR REPLACE FUNCTION public.complete_renewal_with_invoice(p_renewal_id uuid, p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_invoice_write(p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_invoice_number text DEFAULT NULL::text)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;


