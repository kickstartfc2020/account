-- Phase 7h: Secure Financial Year Reset workflow with backup snapshots, audit logs,
-- strict super-admin authorization, typed confirmation, and transactional safety.

create table if not exists public.reset_backup_snapshots (
  id bigserial primary key,
  backup_timestamp timestamptz not null default now(),
  financial_year text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  invoices_count integer not null,
  invoice_items_count integer not null,
  payments_count integer not null,
  renewals_count integer not null,
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  initiated_by_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.reset_audit_logs (
  id bigserial primary key,
  performed_by_user_id uuid references auth.users(id) on delete set null,
  performed_by_email text,
  performed_at timestamptz not null default now(),
  invoices_deleted integer not null default 0,
  invoice_items_deleted integer not null default 0,
  payments_deleted integer not null default 0,
  renewals_deleted integer not null default 0,
  financial_year text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  ip_address text,
  backup_snapshot_id bigint references public.reset_backup_snapshots(id) on delete set null
);

alter table public.reset_backup_snapshots enable row level security;
alter table public.reset_audit_logs enable row level security;

drop policy if exists reset_backup_snapshots_select_policy on public.reset_backup_snapshots;
create policy reset_backup_snapshots_select_policy
on public.reset_backup_snapshots
for select
using (public.is_super_admin());

drop policy if exists reset_backup_snapshots_write_policy on public.reset_backup_snapshots;
create policy reset_backup_snapshots_write_policy
on public.reset_backup_snapshots
for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists reset_audit_logs_select_policy on public.reset_audit_logs;
create policy reset_audit_logs_select_policy
on public.reset_audit_logs
for select
using (public.is_super_admin());

drop policy if exists reset_audit_logs_write_policy on public.reset_audit_logs;
create policy reset_audit_logs_write_policy
on public.reset_audit_logs
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create or replace function public.get_financial_year_reset_preview(
  p_organization_id uuid default null
)
returns table(
  financial_year text,
  fy_start date,
  fy_end date,
  invoices_count integer,
  invoice_items_count integer,
  payments_count integer,
  renewals_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_fy_start date;
  v_fy_end date;
  v_fy_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role <> 'super_admin' then
    raise exception 'Only super admins can preview financial year reset.';
  end if;

  if p_organization_id is not null then
    perform 1 from public.organizations where id = p_organization_id;
    if not found then
      raise exception 'Organization not found.';
    end if;
  end if;

  v_fy_start := make_date(
    extract(year from current_date)::int - case when extract(month from current_date)::int < 4 then 1 else 0 end,
    4,
    1
  );
  v_fy_end := (v_fy_start + interval '1 year - 1 day')::date;
  v_fy_label := extract(year from v_fy_start)::int::text || '-' || extract(year from (v_fy_start + interval '1 year'))::int::text;

  return query
  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  ),
  target_renewals as (
    select r.id
    from public.renewals r
    where (p_organization_id is null or r.organization_id = p_organization_id)
      and (
        r.cycle_start between v_fy_start and v_fy_end
        or (r.generated_at is not null and (r.generated_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
        or (r.processed_at is not null and (r.processed_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
      )
  )
  select
    v_fy_label,
    v_fy_start,
    v_fy_end,
    (select count(*)::int from target_invoices),
    (select count(*)::int from public.invoice_items ii where ii.invoice_id in (select id from target_invoices)),
    (select count(*)::int from public.payments p where p.invoice_id in (select id from target_invoices)),
    (select count(*)::int from target_renewals);
end;
$$;

create or replace function public.admin_reset_financial_year(
  p_organization_id uuid default null,
  p_confirmation_text text default null,
  p_ip_address text default null
)
returns table(
  deleted_invoices integer,
  deleted_invoice_items integer,
  deleted_payments integer,
  deleted_renewals integer,
  financial_year text,
  backup_id bigint,
  audit_log_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_actor_user_id uuid;
  v_actor_email text;
  v_fy_start date;
  v_fy_end date;
  v_fy_label text;
  v_deleted_invoices integer := 0;
  v_deleted_invoice_items integer := 0;
  v_deleted_payments integer := 0;
  v_deleted_renewals integer := 0;
  v_backup_id bigint;
  v_audit_log_id bigint;
  v_lock_key text;
  v_lock_acquired boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role <> 'super_admin' then
    raise exception 'Only super admins can execute financial year reset.';
  end if;

  if coalesce(p_confirmation_text, '') <> 'RESET' then
    raise exception 'Confirmation text mismatch. Type RESET to proceed.';
  end if;

  if p_organization_id is not null then
    perform 1 from public.organizations where id = p_organization_id;
    if not found then
      raise exception 'Organization not found.';
    end if;
  end if;

  v_actor_user_id := auth.uid();
  select u.email into v_actor_email from auth.users u where u.id = v_actor_user_id;

  v_fy_start := make_date(
    extract(year from current_date)::int - case when extract(month from current_date)::int < 4 then 1 else 0 end,
    4,
    1
  );
  v_fy_end := (v_fy_start + interval '1 year - 1 day')::date;
  v_fy_label := extract(year from v_fy_start)::int::text || '-' || extract(year from (v_fy_start + interval '1 year'))::int::text;

  v_lock_key := coalesce(p_organization_id::text, 'global') || ':financial_year_reset:' || v_fy_label;
  v_lock_acquired := pg_try_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  if not v_lock_acquired then
    raise exception 'A financial year reset is already in progress. Please retry later.';
  end if;

  perform set_config('app.allow_hard_delete', 'on', true);

  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  ),
  target_renewals as (
    select r.id
    from public.renewals r
    where (p_organization_id is null or r.organization_id = p_organization_id)
      and (
        r.cycle_start between v_fy_start and v_fy_end
        or (r.generated_at is not null and (r.generated_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
        or (r.processed_at is not null and (r.processed_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
      )
  )
  select
    (select count(*)::int from target_invoices),
    (select count(*)::int from public.invoice_items ii where ii.invoice_id in (select id from target_invoices)),
    (select count(*)::int from public.payments p where p.invoice_id in (select id from target_invoices)),
    (select count(*)::int from target_renewals)
  into v_deleted_invoices, v_deleted_invoice_items, v_deleted_payments, v_deleted_renewals;

  insert into public.reset_backup_snapshots (
    backup_timestamp,
    financial_year,
    organization_id,
    invoices_count,
    invoice_items_count,
    payments_count,
    renewals_count,
    initiated_by_user_id,
    initiated_by_email
  )
  values (
    now(),
    v_fy_label,
    p_organization_id,
    v_deleted_invoices,
    v_deleted_invoice_items,
    v_deleted_payments,
    v_deleted_renewals,
    v_actor_user_id,
    v_actor_email
  )
  returning id into v_backup_id;

  if v_backup_id is null then
    raise exception 'Backup snapshot creation failed. Reset aborted.';
  end if;

  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  )
  update public.renewals r
  set source_invoice_id = null
  where r.source_invoice_id in (select id from target_invoices)
    and not (
      (p_organization_id is null or r.organization_id = p_organization_id)
      and (
        r.cycle_start between v_fy_start and v_fy_end
        or (r.generated_at is not null and (r.generated_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
        or (r.processed_at is not null and (r.processed_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
      )
    );

  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  )
  update public.renewals r
  set generated_invoice_id = null
  where r.generated_invoice_id in (select id from target_invoices)
    and not (
      (p_organization_id is null or r.organization_id = p_organization_id)
      and (
        r.cycle_start between v_fy_start and v_fy_end
        or (r.generated_at is not null and (r.generated_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
        or (r.processed_at is not null and (r.processed_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
      )
    );

  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  )
  delete from public.payments p
  where p.invoice_id in (select id from target_invoices);
  get diagnostics v_deleted_payments = row_count;

  with target_invoices as (
    select i.id
    from public.invoices i
    where i.invoice_date between v_fy_start and v_fy_end
      and (p_organization_id is null or i.organization_id = p_organization_id)
  )
  delete from public.invoice_items ii
  where ii.invoice_id in (select id from target_invoices);
  get diagnostics v_deleted_invoice_items = row_count;

  delete from public.renewals r
  where (p_organization_id is null or r.organization_id = p_organization_id)
    and (
      r.cycle_start between v_fy_start and v_fy_end
      or (r.generated_at is not null and (r.generated_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
      or (r.processed_at is not null and (r.processed_at at time zone 'UTC')::date between v_fy_start and v_fy_end)
    );
  get diagnostics v_deleted_renewals = row_count;

  delete from public.invoices i
  where i.invoice_date between v_fy_start and v_fy_end
    and (p_organization_id is null or i.organization_id = p_organization_id);
  get diagnostics v_deleted_invoices = row_count;

  insert into public.reset_audit_logs (
    performed_by_user_id,
    performed_by_email,
    performed_at,
    invoices_deleted,
    invoice_items_deleted,
    payments_deleted,
    renewals_deleted,
    financial_year,
    organization_id,
    ip_address,
    backup_snapshot_id
  )
  values (
    v_actor_user_id,
    v_actor_email,
    now(),
    v_deleted_invoices,
    v_deleted_invoice_items,
    v_deleted_payments,
    v_deleted_renewals,
    v_fy_label,
    p_organization_id,
    nullif(p_ip_address, ''),
    v_backup_id
  )
  returning id into v_audit_log_id;

  return query
  select
    v_deleted_invoices,
    v_deleted_invoice_items,
    v_deleted_payments,
    v_deleted_renewals,
    v_fy_label,
    v_backup_id,
    v_audit_log_id;
end;
$$;

revoke all on function public.get_financial_year_reset_preview(uuid) from public, anon;
grant execute on function public.get_financial_year_reset_preview(uuid) to authenticated;

revoke all on function public.admin_reset_financial_year(uuid, text, text) from public, anon;
grant execute on function public.admin_reset_financial_year(uuid, text, text) to authenticated;
