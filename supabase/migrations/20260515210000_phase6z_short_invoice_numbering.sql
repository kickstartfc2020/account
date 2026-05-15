-- Phase 6z: Short year-based invoice numbering.
-- Visible format: INV-2026-01

insert into public.ref_counters (counter_key, last_number)
select
  'invoice:' || inv.organization_id::text || ':' || extract(year from inv.invoice_date)::text as counter_key,
  max(
    coalesce(
      nullif((regexp_match(inv.invoice_number, '([0-9]+)$'))[1], '')::integer,
      0
    )
  ) as max_seen_number
from public.invoices inv
group by inv.organization_id, extract(year from inv.invoice_date)
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
  v_year integer;
  v_seq integer;
begin
  select b.organization_id
    into v_organization_id
  from public.branches b
  where b.id = p_branch_id;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization for branch % while generating invoice number.', p_branch_id;
  end if;

  v_year := extract(year from p_invoice_date)::integer;
  v_seq := public.next_ref_counter('invoice:' || v_organization_id::text || ':' || v_year::text);

  return format('INV-%s-%s', v_year, lpad(v_seq::text, 2, '0'));
end;
$$;