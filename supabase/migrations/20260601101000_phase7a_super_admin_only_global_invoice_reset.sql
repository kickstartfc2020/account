-- Phase 7a: Super-admin-only invoice reset, with optional global wipe.

create or replace function public.admin_reset_invoices(
  p_organization_id uuid default null
)
returns table(deleted_invoices integer, deleted_payments integer, deleted_items integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_organization_id uuid;
  v_deleted_invoices integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_items integer := 0;
begin
  v_role := public.current_role();
  if v_role <> 'super_admin' then
    raise exception 'Only super admins can reset invoices.';
  end if;

  v_organization_id := p_organization_id;

  perform set_config('app.allow_hard_delete', 'on', true);

  if v_organization_id is null then
    perform pg_advisory_xact_lock(hashtextextended('global:invoice_reset', 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':invoice_reset', 0));
  end if;

  update public.renewals
    set source_invoice_id = null,
        generated_invoice_id = null
  where (v_organization_id is null or organization_id = v_organization_id)
    and (source_invoice_id is not null or generated_invoice_id is not null);

  delete from public.invoice_write_requests
  where v_organization_id is null or organization_id = v_organization_id;

  delete from public.payments
  where v_organization_id is null or organization_id = v_organization_id;
  get diagnostics v_deleted_payments = row_count;

  delete from public.invoice_items
  where v_organization_id is null or organization_id = v_organization_id;
  get diagnostics v_deleted_items = row_count;

  delete from public.invoices
  where v_organization_id is null or organization_id = v_organization_id;
  get diagnostics v_deleted_invoices = row_count;

  delete from public.ref_counters
  where counter_key like 'invoice:%'
    and (
      v_organization_id is null
      or counter_key = 'invoice:' || v_organization_id::text
      or counter_key like 'invoice:' || v_organization_id::text || ':%'
    );

  return query select v_deleted_invoices, v_deleted_payments, v_deleted_items;
end;
$$;
