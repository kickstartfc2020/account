-- Switch invoice number format to INV-KS-### and normalize existing values.

-- 1) Generator used by finalize_invoice_write.
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

-- 2) Backfill all existing invoice numbers to the new format, scoped per organization.
with renumbered as (
  select
    inv.id,
    inv.organization_id,
    row_number() over (
      partition by inv.organization_id
      order by inv.invoice_date asc, inv.created_at asc, inv.id asc
    ) as seq
  from public.invoices inv
)
update public.invoices inv
set invoice_number = format('INV-KS-%s', lpad(r.seq::text, 3, '0'))
from renumbered r
where inv.id = r.id;

-- 3) Align counters with the highest new value so next invoice continues correctly.
insert into public.ref_counters (counter_key, last_number)
select
  'invoice:' || org.id::text as counter_key,
  coalesce(
    max(
      coalesce(
        nullif((regexp_match(inv.invoice_number, '^INV-KS-([0-9]+)$'))[1], '')::integer,
        0
      )
    ),
    0
  ) as last_number
from public.organizations org
left join public.invoices inv
  on inv.organization_id = org.id
group by org.id
on conflict (counter_key)
do update set
  last_number = excluded.last_number;
