-- Rollback for phase 7h financial year reset workflow.

drop function if exists public.admin_reset_financial_year(uuid, text, text);
drop function if exists public.get_financial_year_reset_preview(uuid);

drop policy if exists reset_audit_logs_write_policy on public.reset_audit_logs;
drop policy if exists reset_audit_logs_select_policy on public.reset_audit_logs;
drop policy if exists reset_backup_snapshots_write_policy on public.reset_backup_snapshots;
drop policy if exists reset_backup_snapshots_select_policy on public.reset_backup_snapshots;

drop table if exists public.reset_audit_logs;
drop table if exists public.reset_backup_snapshots;
