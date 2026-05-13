-- Phase 2 schema for multi-tenant student billing SaaS
-- Target: Supabase Postgres

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'super_admin',
  'organization_admin',
  'branch_manager'
);

create type public.record_status as enum (
  'active',
  'inactive',
  'archived'
);

create type public.package_billing_type as enum (
  'one_time',
  'recurring_monthly'
);

create type public.invoice_status as enum (
  'draft',
  'unpaid',
  'partial',
  'completed',
  'cancelled'
);

create type public.payment_status as enum (
  'pending',
  'completed',
  'failed',
  'cancelled',
  'refunded'
);

create type public.payment_method as enum (
  'cash',
  'card',
  'upi',
  'online',
  'bank_transfer'
);

create type public.renewal_status as enum (
  'pending',
  'completed',
  'cancelled',
  'overdue'
);

create type public.audit_action as enum (
  'insert',
  'update',
  'cancel',
  'archive',
  'status_change',
  'payment_change'
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  status public.record_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  address text,
  phone text,
  email text,
  status public.record_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  role public.app_role not null,
  full_name text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_scope_check check (
    (role = 'super_admin' and organization_id is null and branch_id is null)
    or (role = 'organization_admin' and organization_id is not null and branch_id is null)
    or (role = 'branch_manager' and organization_id is not null and branch_id is not null)
  )
);

create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  status public.record_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sport_id uuid not null references public.sports(id) on delete restrict,
  name text not null,
  billing_type public.package_billing_type not null,
  duration_months integer not null default 1 check (duration_months > 0),
  amount numeric(12,2) not null check (amount >= 0),
  gst_percent numeric(5,2) not null default 18 check (gst_percent >= 0),
  status public.record_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sport_id, name)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  current_package_id uuid references public.packages(id) on delete restrict,
  name text not null,
  phone text not null,
  email text,
  joined_at date not null default current_date,
  status public.record_status not null default 'active',
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  status public.invoice_status not null default 'draft',
  currency char(3) not null default 'INR' check (currency = 'INR'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  balance_amount numeric(12,2) not null default 0 check (balance_amount >= 0),
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  package_id uuid references public.packages(id) on delete restrict,
  sport_id uuid references public.sports(id) on delete restrict,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  gst_percent numeric(5,2) not null default 18 check (gst_percent >= 0),
  line_subtotal numeric(12,2) not null default 0 check (line_subtotal >= 0),
  line_tax numeric(12,2) not null default 0 check (line_tax >= 0),
  line_total numeric(12,2) not null default 0 check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  payment_date timestamptz not null default now(),
  method public.payment_method not null,
  status public.payment_status not null default 'completed',
  reference_no text,
  notes text,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.renewals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  package_id uuid not null references public.packages(id) on delete restrict,
  source_invoice_id uuid references public.invoices(id) on delete restrict,
  generated_invoice_id uuid references public.invoices(id) on delete restrict,
  cycle_start date not null,
  cycle_end date not null,
  due_date date not null,
  status public.renewal_status not null default 'pending',
  balance_amount numeric(12,2) not null default 0 check (balance_amount >= 0),
  generated_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, package_id, cycle_start, cycle_end)
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action public.audit_action not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is disabled for this table. Use status or archived fields instead.';
end;
$$;

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid() limit 1;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id from public.profiles p where p.id = auth.uid() limit 1;
$$;

create or replace function public.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.branch_id from public.profiles p where p.id = auth.uid() limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'super_admin', false);
$$;

create or replace function public.can_access_organization(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or (public.current_organization_id() is not null and public.current_organization_id() = target_org_id);
$$;

create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or (
      public.current_role() = 'organization_admin'
      and exists (
        select 1
        from public.branches b
        where b.id = target_branch_id
          and b.organization_id = public.current_organization_id()
      )
    )
    or (
      public.current_role() = 'branch_manager'
      and public.current_branch_id() = target_branch_id
    );
$$;

create or replace function public.audit_action_for_change(
  p_table_name text,
  p_old_status text,
  p_new_status text
)
returns public.audit_action
language plpgsql
stable
as $$
begin
  if p_table_name = 'invoices' and p_old_status is distinct from p_new_status and p_new_status = 'cancelled' then
    return 'cancel';
  elsif p_table_name = 'payments' then
    return 'payment_change';
  elsif p_old_status is distinct from p_new_status then
    return 'status_change';
  end if;

  return 'update';
end;
$$;

create or replace function public.insert_audit_log(
  p_table_name text,
  p_record_id uuid,
  p_org_id uuid,
  p_branch_id uuid,
  p_action public.audit_action,
  p_previous jsonb,
  p_next jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (
    organization_id,
    branch_id,
    actor_user_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    previous_value,
    new_value
  )
  values (
    p_org_id,
    p_branch_id,
    auth.uid(),
    auth.uid(),
    p_table_name,
    p_record_id,
    p_action,
    p_previous,
    p_next
  );
$$;

create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_branch_id uuid;
  v_record_id uuid;
  v_action public.audit_action;
begin
  if tg_op = 'INSERT' then
    v_org_id := (to_jsonb(new)->>'organization_id')::uuid;
    v_branch_id := nullif(to_jsonb(new)->>'branch_id', '')::uuid;
    v_record_id := (to_jsonb(new)->>'id')::uuid;

    perform public.insert_audit_log(
      tg_table_name,
      v_record_id,
      v_org_id,
      v_branch_id,
      'insert',
      null,
      to_jsonb(new)
    );

    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_org_id := coalesce((to_jsonb(new)->>'organization_id')::uuid, (to_jsonb(old)->>'organization_id')::uuid);
    v_branch_id := coalesce(nullif(to_jsonb(new)->>'branch_id', '')::uuid, nullif(to_jsonb(old)->>'branch_id', '')::uuid);
    v_record_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);

    v_action := public.audit_action_for_change(
      tg_table_name,
      to_jsonb(old)->>'status',
      to_jsonb(new)->>'status'
    );

    perform public.insert_audit_log(
      tg_table_name,
      v_record_id,
      v_org_id,
      v_branch_id,
      v_action,
      to_jsonb(old),
      to_jsonb(new)
    );

    return new;
  end if;

  return null;
end;
$$;

create or replace function public.sync_invoice_payment_status(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status public.invoice_status;
begin
  select total_amount into v_total
  from public.invoices
  where id = p_invoice_id;

  if v_total is null then
    return;
  end if;

  select coalesce(sum(amount), 0)
  into v_paid
  from public.payments
  where invoice_id = p_invoice_id
    and status = 'completed';

  v_new_balance := greatest(v_total - v_paid, 0);

  if exists (select 1 from public.invoices where id = p_invoice_id and status = 'cancelled') then
    return;
  end if;

  if v_new_balance = 0 then
    v_new_status := 'completed';
  elsif v_paid = 0 then
    v_new_status := 'unpaid';
  else
    v_new_status := 'partial';
  end if;

  update public.invoices
  set
    balance_amount = v_new_balance,
    status = v_new_status,
    updated_at = now()
  where id = p_invoice_id
    and (
      balance_amount is distinct from v_new_balance
      or status is distinct from v_new_status
    );
end;
$$;

create or replace function public.on_payment_change_sync_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_invoice_payment_status(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.generate_monthly_renewals(p_run_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_count integer := 0;
begin
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
    p.amount
  from public.students s
  join public.packages p
    on p.id = s.current_package_id
  where s.status = 'active'
    and p.status = 'active'
    and p.billing_type = 'recurring_monthly'
  on conflict (student_id, package_id, cycle_start, cycle_end) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace view public.accounting_invoice_totals as
select
  organization_id,
  branch_id,
  count(*) as invoice_count,
  coalesce(sum(total_amount), 0)::numeric(12,2) as total_billed,
  coalesce(sum(balance_amount), 0)::numeric(12,2) as total_pending,
  coalesce(sum(total_amount - balance_amount), 0)::numeric(12,2) as total_collected
from public.invoices
where status <> 'cancelled'
group by organization_id, branch_id;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger branches_set_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger sports_set_updated_at
before update on public.sports
for each row execute function public.set_updated_at();

create trigger packages_set_updated_at
before update on public.packages
for each row execute function public.set_updated_at();

create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

create trigger invoice_items_set_updated_at
before update on public.invoice_items
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create trigger renewals_set_updated_at
before update on public.renewals
for each row execute function public.set_updated_at();

create trigger students_prevent_delete
before delete on public.students
for each row execute function public.prevent_hard_delete();

create trigger invoices_prevent_delete
before delete on public.invoices
for each row execute function public.prevent_hard_delete();

create trigger payments_prevent_delete
before delete on public.payments
for each row execute function public.prevent_hard_delete();

create trigger invoices_audit_trigger
after insert or update on public.invoices
for each row execute function public.log_audit_event();

create trigger invoice_items_audit_trigger
after insert or update on public.invoice_items
for each row execute function public.log_audit_event();

create trigger payments_audit_trigger
after insert or update on public.payments
for each row execute function public.log_audit_event();

create trigger packages_audit_trigger
after insert or update on public.packages
for each row execute function public.log_audit_event();

create trigger users_audit_trigger
after update on public.profiles
for each row execute function public.log_audit_event();

create trigger payment_sync_invoice_trigger
after insert or update on public.payments
for each row execute function public.on_payment_change_sync_invoice();

alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.sports enable row level security;
alter table public.packages enable row level security;
alter table public.students enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.renewals enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select_policy
on public.organizations
for select
using (public.can_access_organization(id));

create policy organizations_write_policy
on public.organizations
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy branches_select_policy
on public.branches
for select
using (public.can_access_organization(organization_id));

create policy branches_insert_policy
on public.branches
for insert
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
);

create policy branches_update_policy
on public.branches
for update
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
)
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
);

create policy profiles_select_policy
on public.profiles
for select
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
);

create policy profiles_insert_policy
on public.profiles
for insert
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and role = 'branch_manager'
    and organization_id = public.current_organization_id()
  )
);

create policy profiles_update_policy
on public.profiles
for update
using (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
)
with check (
  id = auth.uid()
  or public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
);

create policy sports_select_policy
on public.sports
for select
using (public.can_access_organization(organization_id));

create policy sports_write_policy
on public.sports
for all
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1 from public.branches b
      where b.id = public.current_branch_id()
        and b.organization_id = sports.organization_id
    )
  )
)
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1 from public.branches b
      where b.id = public.current_branch_id()
        and b.organization_id = sports.organization_id
    )
  )
);

create policy packages_select_policy
on public.packages
for select
using (public.can_access_organization(organization_id));

create policy packages_write_policy
on public.packages
for all
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1 from public.branches b
      where b.id = public.current_branch_id()
        and b.organization_id = packages.organization_id
    )
  )
)
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1 from public.branches b
      where b.id = public.current_branch_id()
        and b.organization_id = packages.organization_id
    )
  )
);

create policy students_select_policy
on public.students
for select
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (public.current_role() = 'branch_manager' and branch_id = public.current_branch_id())
);

create policy students_insert_policy
on public.students
for insert
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
    and organization_id = public.current_organization_id()
  )
);

create policy students_update_policy
on public.students
for update
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
);

create policy invoices_select_policy
on public.invoices
for select
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (public.current_role() = 'branch_manager' and branch_id = public.current_branch_id())
);

create policy invoices_insert_policy
on public.invoices
for insert
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
    and organization_id = public.current_organization_id()
  )
);

create policy invoices_update_policy
on public.invoices
for update
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
);

create policy invoice_items_select_policy
on public.invoice_items
for select
using (public.can_access_organization(organization_id));

create policy invoice_items_write_policy
on public.invoice_items
for all
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_items.invoice_id
        and i.branch_id = public.current_branch_id()
    )
  )
)
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (
    public.current_role() = 'branch_manager'
    and exists (
      select 1
      from public.invoices i
      where i.id = invoice_items.invoice_id
        and i.branch_id = public.current_branch_id()
    )
  )
);

create policy payments_select_policy
on public.payments
for select
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (public.current_role() = 'branch_manager' and branch_id = public.current_branch_id())
);

create policy payments_insert_policy
on public.payments
for insert
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
    and organization_id = public.current_organization_id()
  )
);

create policy payments_update_policy
on public.payments
for update
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and branch_id = public.current_branch_id()
  )
);

create policy renewals_select_policy
on public.renewals
for select
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (public.current_role() = 'branch_manager' and branch_id = public.current_branch_id())
);

create policy renewals_write_policy
on public.renewals
for all
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
)
with check (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
);

create policy audit_logs_select_policy
on public.audit_logs
for select
using (
  public.is_super_admin()
  or (public.current_role() = 'organization_admin' and organization_id = public.current_organization_id())
  or (public.current_role() = 'branch_manager' and branch_id = public.current_branch_id())
);

create policy audit_logs_insert_policy
on public.audit_logs
for insert
with check (public.can_access_organization(organization_id));
