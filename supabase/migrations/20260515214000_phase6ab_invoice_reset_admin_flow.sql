create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_hard_delete', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'Hard delete is disabled for this table. Use status or archived fields instead.';
end;
$$;

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

  delete from public.ref_counters
  where counter_key like 'invoice:' || v_organization_id::text || ':%';

  return query select v_deleted_invoices, v_deleted_payments, v_deleted_items;
end;
$$;

revoke all on function public.admin_reset_invoices(uuid) from public, anon;
grant execute on function public.admin_reset_invoices(uuid) to authenticated;
