-- Phase 6v: Operational query index hardening for production read paths.

create index if not exists idx_branches_org_archived_name
  on public.branches(organization_id, archived_at, name);

create index if not exists idx_sports_org_archived_name
  on public.sports(organization_id, archived_at, name);

create index if not exists idx_packages_org_archived_name
  on public.packages(organization_id, archived_at, name);

create index if not exists idx_students_org_archived_name
  on public.students(organization_id, archived_at, name);

create index if not exists idx_students_org_branch_archived_name
  on public.students(organization_id, branch_id, archived_at, name);

create index if not exists idx_students_org_package
  on public.students(organization_id, current_package_id);

create index if not exists idx_invoices_org_archived_date_desc
  on public.invoices(organization_id, archived_at, invoice_date desc);

create index if not exists idx_invoices_org_branch_date_desc
  on public.invoices(organization_id, branch_id, invoice_date desc);

create index if not exists idx_invoices_student_date_desc
  on public.invoices(student_id, invoice_date desc);

create index if not exists idx_renewals_org_status_due_date
  on public.renewals(organization_id, status, due_date);

create index if not exists idx_renewals_student_due_date
  on public.renewals(student_id, due_date desc);

create index if not exists idx_payments_invoice_status
  on public.payments(invoice_id, status);

create index if not exists idx_payments_org_invoice_status
  on public.payments(organization_id, invoice_id, status);

create index if not exists idx_invoice_items_invoice_id
  on public.invoice_items(invoice_id);

create index if not exists idx_invoice_items_org_invoice
  on public.invoice_items(organization_id, invoice_id);
