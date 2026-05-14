create table if not exists public.gst_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_gst_rates_organization_id on public.gst_rates(organization_id);

alter table public.gst_rates enable row level security;

drop policy if exists gst_rates_select_policy on public.gst_rates;
create policy gst_rates_select_policy
on public.gst_rates
for select
using (
  public.is_super_admin()
  or organization_id = public.current_organization_id()
);

drop policy if exists gst_rates_write_policy on public.gst_rates;
create policy gst_rates_write_policy
on public.gst_rates
for all
using (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and organization_id = public.current_organization_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() in ('organization_admin', 'branch_manager')
    and organization_id = public.current_organization_id()
  )
);

drop trigger if exists gst_rates_set_updated_at on public.gst_rates;
create trigger gst_rates_set_updated_at
before update on public.gst_rates
for each row execute function public.set_updated_at();
