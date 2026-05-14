-- Phase 6s: Accounting integrity hardening for invoice lifecycle, payments,
-- cancellations, and renewal transaction safety.

-- Prevent duplicate payment reference submissions per invoice when reference is provided.
create unique index if not exists uq_payments_invoice_reference_no
  on public.payments(invoice_id, reference_no)
  where reference_no is not null and status = 'completed';

create or replace function public.enforce_invoice_update_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists invoices_enforce_update_integrity on public.invoices;
create trigger invoices_enforce_update_integrity
before update on public.invoices
for each row execute function public.enforce_invoice_update_integrity();

create or replace function public.sync_invoice_after_invoice_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists invoices_sync_after_update_trigger on public.invoices;
create trigger invoices_sync_after_update_trigger
after update on public.invoices
for each row execute function public.sync_invoice_after_invoice_update();

create or replace function public.cancel_invoice_safe(p_invoice_number text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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

revoke all on function public.cancel_invoice_safe(text) from public;
revoke execute on function public.cancel_invoice_safe(text) from anon;
grant execute on function public.cancel_invoice_safe(text) to authenticated;

create or replace function public.complete_renewal_with_invoice(
  p_renewal_id uuid,
  p_student_id uuid,
  p_package_id uuid,
  p_sport_id uuid,
  p_package_name text,
  p_sport_name text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_taxable_amount numeric,
  p_tax_total numeric,
  p_total_amount numeric,
  p_gst_percent numeric,
  p_payment_method public.payment_method,
  p_payment_mode_label text,
  p_preferred_branch_id uuid default null,
  p_start_date date default current_date
)
returns table(invoice_id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
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
    null
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

revoke all on function public.complete_renewal_with_invoice(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  uuid,
  date
) from public;
revoke execute on function public.complete_renewal_with_invoice(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  uuid,
  date
) from anon;
grant execute on function public.complete_renewal_with_invoice(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  uuid,
  date
) to authenticated;
