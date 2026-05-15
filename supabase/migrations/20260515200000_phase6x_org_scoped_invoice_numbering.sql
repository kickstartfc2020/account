-- Phase 6x: Organization-scoped invoice numbering
-- Goal: all branches under the same organization share one monotonic invoice sequence.

create table if not exists public.organization_invoice_counters (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.next_org_invoice_counter(p_organization_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
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

-- Seed counters from historical data so numbering continues safely.
insert into public.organization_invoice_counters (organization_id, last_number, updated_at)
select
  inv.organization_id,
  max(
    coalesce(
      nullif((regexp_match(inv.invoice_number, '([0-9]+)$'))[1], '')::bigint,
      0
    )
  ) as max_seen_number,
  now()
from public.invoices inv
group by inv.organization_id
on conflict (organization_id)
do update
  set last_number = greatest(public.organization_invoice_counters.last_number, excluded.last_number),
      updated_at = now();

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
  v_seq bigint;
begin
  -- p_invoice_date remains for backward compatibility with existing callers.
  select b.organization_id
    into v_organization_id
  from public.branches b
  where b.id = p_branch_id;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization for branch % while generating invoice number.', p_branch_id;
  end if;

  v_seq := public.next_org_invoice_counter(v_organization_id);

  return format('INV-%s', lpad(v_seq::text, 4, '0'));
end;
$$;

alter table public.organization_invoice_counters enable row level security;

drop policy if exists organization_invoice_counters_deny_all on public.organization_invoice_counters;
create policy organization_invoice_counters_deny_all
on public.organization_invoice_counters
for all
using (false)
with check (false);

revoke all on table public.organization_invoice_counters from public, authenticated, anon;
revoke execute on function public.next_org_invoice_counter(uuid) from public, authenticated, anon;
