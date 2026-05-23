-- Phase 6ac: Club-wide fixed invoice numbering.
-- New visible format: INC-<ORG2>-NNN (shared sequence across all branches in one organization)

insert into public.ref_counters (counter_key, last_number)
select
  'invoice:' || inv.organization_id::text as counter_key,
  max(
    coalesce(
      nullif((regexp_match(inv.invoice_number, '([0-9]+)$'))[1], '')::integer,
      0
    )
  ) as max_seen_number
from public.invoices inv
group by inv.organization_id
on conflict (counter_key)
do update
  set last_number = greatest(public.ref_counters.last_number, excluded.last_number);

create or replace function public.generate_invoice_number(
  p_branch_id uuid,
  p_invoice_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_org_code text;
  v_org_code_compact text;
  v_org_code_two text;
  v_seq integer;
begin
  select b.organization_id
    into v_organization_id
  from public.branches b
  where b.id = p_branch_id;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization for branch % while generating invoice number.', p_branch_id;
  end if;

  select o.code
    into v_org_code
  from public.organizations o
  where o.id = v_organization_id;

  v_org_code_compact := upper(regexp_replace(coalesce(v_org_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_org_code_two := substr(v_org_code_compact, 1, 2);

  if char_length(v_org_code_two) < 2 then
    v_org_code_two := rpad(v_org_code_two, 2, 'X');
  end if;

  v_seq := public.next_ref_counter('invoice:' || v_organization_id::text);

  return format('INC-%s-%s', v_org_code_two, lpad(v_seq::text, 3, '0'));
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

  -- Remove both legacy year-scoped keys and new organization-scoped key.
  delete from public.ref_counters
  where counter_key = 'invoice:' || v_organization_id::text
     or counter_key like 'invoice:' || v_organization_id::text || ':%';

  return query select v_deleted_invoices, v_deleted_payments, v_deleted_items;
end;
$$;
