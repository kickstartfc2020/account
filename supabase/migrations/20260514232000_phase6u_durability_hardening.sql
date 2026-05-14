-- Phase 6u: Data durability hardening (soft-delete patterns and hard-delete prevention).

alter table public.gst_rates
  add column if not exists archived_at timestamptz;

alter table public.gst_rates
  drop constraint if exists gst_rates_organization_id_name_key;

create unique index if not exists uq_gst_rates_org_name_active
  on public.gst_rates(organization_id, name)
  where archived_at is null;

-- Prevent hard deletes on financial and audit-history tables.
drop trigger if exists renewals_prevent_delete on public.renewals;
create trigger renewals_prevent_delete
before delete on public.renewals
for each row execute function public.prevent_hard_delete();

drop trigger if exists invoice_items_prevent_delete on public.invoice_items;
create trigger invoice_items_prevent_delete
before delete on public.invoice_items
for each row execute function public.prevent_hard_delete();

drop trigger if exists audit_logs_prevent_delete on public.audit_logs;
create trigger audit_logs_prevent_delete
before delete on public.audit_logs
for each row execute function public.prevent_hard_delete();

drop trigger if exists gst_rates_prevent_delete on public.gst_rates;
create trigger gst_rates_prevent_delete
before delete on public.gst_rates
for each row execute function public.prevent_hard_delete();
