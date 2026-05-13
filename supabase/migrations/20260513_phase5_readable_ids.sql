-- Phase 5: Human-readable reference IDs
-- UUIDs remain as internal PKs; ref_id columns carry the business-facing identifiers.

-- ── 1. Global sequences (monotonically increasing, concurrency-safe) ──────────

create sequence if not exists public.seq_org     increment 1 start 1;
create sequence if not exists public.seq_branch  increment 1 start 1;
create sequence if not exists public.seq_student increment 1 start 1;
create sequence if not exists public.seq_package increment 1 start 1;
create sequence if not exists public.seq_profile increment 1 start 1;

-- ── 2. Year-keyed counter table (for INV / PAY / REN) ─────────────────────────

create table if not exists public.ref_counters (
  counter_key text primary key,
  last_number integer not null default 0
);

-- Atomic increment helper
create or replace function public.next_ref_counter(p_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.ref_counters (counter_key, last_number)
  values (p_key, 1)
  on conflict (counter_key)
  do update set last_number = ref_counters.last_number + 1
  returning last_number into v_next;
  return v_next;
end;
$$;

-- ── 3. Add ref_id columns ──────────────────────────────────────────────────────

alter table public.organizations add column if not exists ref_id text unique;
alter table public.branches      add column if not exists ref_id text unique;
alter table public.students      add column if not exists ref_id text unique;
alter table public.packages      add column if not exists ref_id text unique;
alter table public.profiles      add column if not exists ref_id text unique;
alter table public.payments      add column if not exists ref_id text unique;
alter table public.renewals      add column if not exists ref_id text unique;
-- invoices already has invoice_number which IS its visible reference

-- ── 4. ID generation functions ────────────────────────────────────────────────

create or replace function public.generate_org_ref_id()
returns text language plpgsql security definer set search_path = public
as $$
begin
  return 'ORG-' || lpad(nextval('public.seq_org')::text, 4, '0');
end;
$$;

create or replace function public.generate_branch_ref_id()
returns text language plpgsql security definer set search_path = public
as $$
begin
  return 'BR-' || lpad(nextval('public.seq_branch')::text, 4, '0');
end;
$$;

create or replace function public.generate_student_ref_id()
returns text language plpgsql security definer set search_path = public
as $$
begin
  return 'STU-' || lpad(nextval('public.seq_student')::text, 6, '0');
end;
$$;

create or replace function public.generate_package_ref_id()
returns text language plpgsql security definer set search_path = public
as $$
begin
  return 'PKG-' || lpad(nextval('public.seq_package')::text, 4, '0');
end;
$$;

create or replace function public.generate_profile_ref_id()
returns text language plpgsql security definer set search_path = public
as $$
begin
  return 'USR-' || lpad(nextval('public.seq_profile')::text, 6, '0');
end;
$$;

create or replace function public.generate_invoice_number(
  p_branch_id  uuid,
  p_invoice_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_ref  text;
  v_branch_code text;
  v_year        integer;
  v_key         text;
  v_seq         integer;
begin
  select ref_id into v_branch_ref
  from public.branches
  where id = p_branch_id;

  -- Convert BR-0001 to BR0001 for compact use inside the invoice number
  v_branch_code := replace(coalesce(v_branch_ref, 'BR0000'), '-', '');
  v_year        := extract(year from p_invoice_date)::integer;
  v_key         := 'invoice:' || v_branch_code || ':' || v_year;
  v_seq         := public.next_ref_counter(v_key);

  return format('INV-%s-%s-%s', v_branch_code, v_year, lpad(v_seq::text, 6, '0'));
end;
$$;

create or replace function public.generate_payment_ref_id(
  p_date timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('payment:' || v_year);
  return format('PAY-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
end;
$$;

create or replace function public.generate_renewal_ref_id(
  p_date timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('renewal:' || v_year);
  return format('REN-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
end;
$$;

-- ── 5. Before-insert triggers ─────────────────────────────────────────────────

create or replace function public.trg_set_org_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_org_ref_id();
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_set_ref_id on public.organizations;
create trigger orgs_set_ref_id
  before insert on public.organizations
  for each row execute function public.trg_set_org_ref_id();

create or replace function public.trg_set_branch_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_branch_ref_id();
  end if;
  return new;
end;
$$;

drop trigger if exists branches_set_ref_id on public.branches;
create trigger branches_set_ref_id
  before insert on public.branches
  for each row execute function public.trg_set_branch_ref_id();

create or replace function public.trg_set_student_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_student_ref_id();
  end if;
  return new;
end;
$$;

drop trigger if exists students_set_ref_id on public.students;
create trigger students_set_ref_id
  before insert on public.students
  for each row execute function public.trg_set_student_ref_id();

create or replace function public.trg_set_package_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_package_ref_id();
  end if;
  return new;
end;
$$;

drop trigger if exists packages_set_ref_id on public.packages;
create trigger packages_set_ref_id
  before insert on public.packages
  for each row execute function public.trg_set_package_ref_id();

create or replace function public.trg_set_profile_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_profile_ref_id();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_ref_id on public.profiles;
create trigger profiles_set_ref_id
  before insert on public.profiles
  for each row execute function public.trg_set_profile_ref_id();

create or replace function public.trg_set_payment_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_payment_ref_id(new.payment_date);
  end if;
  return new;
end;
$$;

drop trigger if exists payments_set_ref_id on public.payments;
create trigger payments_set_ref_id
  before insert on public.payments
  for each row execute function public.trg_set_payment_ref_id();

create or replace function public.trg_set_renewal_ref_id()
returns trigger language plpgsql as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_renewal_ref_id(now());
  end if;
  return new;
end;
$$;

drop trigger if exists renewals_set_ref_id on public.renewals;
create trigger renewals_set_ref_id
  before insert on public.renewals
  for each row execute function public.trg_set_renewal_ref_id();

-- ── 6. Backfill existing rows (bulk UPDATE patterns) ─────────────────────────
-- Each entity uses a single UPDATE ... FROM subquery to avoid row-by-row lock
-- contention and excessive WAL growth in large databases.

-- Orgs
with ranked as (select id from public.organizations where ref_id is null)
update public.organizations o
set ref_id = 'ORG-' || lpad((nextval('public.seq_org'))::text, 4, '0')
from ranked where o.id = ranked.id;

-- Branches
with ranked as (select id from public.branches where ref_id is null)
update public.branches b
set ref_id = 'BR-' || lpad((nextval('public.seq_branch'))::text, 4, '0')
from ranked where b.id = ranked.id;

-- Students
with ranked as (select id from public.students where ref_id is null)
update public.students s
set ref_id = 'STU-' || lpad((nextval('public.seq_student'))::text, 6, '0')
from ranked where s.id = ranked.id;

-- Packages
with ranked as (select id from public.packages where ref_id is null)
update public.packages p
set ref_id = 'PKG-' || lpad((nextval('public.seq_package'))::text, 4, '0')
from ranked where p.id = ranked.id;

-- Profiles
with ranked as (select id from public.profiles where ref_id is null)
update public.profiles pr
set ref_id = 'USR-' || lpad((nextval('public.seq_profile'))::text, 6, '0')
from ranked where pr.id = ranked.id;

-- Payments: year is required per row; use subquery for a single bulk statement
update public.payments pay
set ref_id = sub.new_ref
from (
  select id, public.generate_payment_ref_id(payment_date) as new_ref
  from public.payments where ref_id is null
) sub
where pay.id = sub.id;

-- Renewals
update public.renewals ren
set ref_id = sub.new_ref
from (
  select id, public.generate_renewal_ref_id(created_at) as new_ref
  from public.renewals where ref_id is null
) sub
where ren.id = sub.id;

-- Invoices: reformat any legacy RN- or placeholder entries (bulk)
update public.invoices inv
set invoice_number = sub.new_num
from (
  select id, public.generate_invoice_number(branch_id, invoice_date) as new_num
  from public.invoices
  where invoice_number like 'RN-%' or invoice_number like 'INV-BR0000-%'
) sub
where inv.id = sub.id;

-- ── 7. RLS for ref_counters ────────────────────────────────────────────────────

alter table public.ref_counters enable row level security;

-- Only security-definer functions may read/write counters; no direct client access
create policy ref_counters_deny_all on public.ref_counters
  as restrictive
  for all
  using (false);
