-- F5: close the remaining direct-PostgREST write door on the core financial
-- tables (invoices, invoice_items, payments, renewals).
--
-- Verification performed before writing this migration (see chat/report for
-- full detail): grepped every src/**/*.ts(x) call site of
-- .from('invoices'|'invoice_items'|'payments'|'renewals') and confirmed each
-- one is either a .select() (read) or the single Phase 1 exception
-- (invoices.notes update in CreateInvoice.tsx via the "notes"-only column
-- grant). Then grepped every "insert into public.<table>" / "update public.
-- <table>" in supabase/migrations and confirmed each is inside a
-- CREATE FUNCTION ... SECURITY DEFINER body (add_student_enrollment_atomic,
-- generate_monthly_renewals, complete_renewal_with_invoice,
-- finalize_invoice_write / _v2, record_invoice_payment, cancel_invoice_safe,
-- sync_invoice_payment_status, update_invoice_date_audited). SECURITY
-- DEFINER functions execute with the privileges of their owner ("postgres"),
-- not the calling role, so none of them depend on authenticated holding
-- table-level INSERT/UPDATE -- revoking those grants does not affect any of
-- these RPCs. The same is true of the trigger functions that fire off these
-- writes (log_audit_event, set_updated_at, on_payment_change_sync_invoice,
-- enforce_payment_integrity, sync_invoice_after_invoice_update,
-- trg_set_payment_ref_id, trg_set_renewal_ref_id): they run as part of the
-- owning RPC's transaction, not as a separate authenticated-role statement.
--
-- No row in invoices/invoice_items/payments/renewals is touched by this
-- migration. It changes grants only.

-- invoices: INSERT was still open to authenticated (Phase 1 only closed
-- UPDATE, leaving the "notes" column open). Revoke INSERT; UPDATE is already
-- revoked from 20260915120000_phase1_security_hardening.sql, but the
-- REVOKE/GRANT pair is repeated here so this migration is self-contained and
-- idempotent regardless of apply order.
REVOKE INSERT, UPDATE ON TABLE "public"."invoices" FROM "authenticated";
GRANT UPDATE ("notes") ON TABLE "public"."invoices" TO "authenticated";

-- invoice_items: no direct client writes exist; all rows are written by
-- finalize_invoice_write* inside the invoice-creation RPC.
REVOKE INSERT, UPDATE ON TABLE "public"."invoice_items" FROM "authenticated";

-- payments: no direct client writes exist; all rows are written by
-- finalize_invoice_write* / record_invoice_payment / cancel_invoice_safe.
REVOKE INSERT, UPDATE ON TABLE "public"."payments" FROM "authenticated";

-- renewals: no direct client writes exist; all rows are written by
-- add_student_enrollment_atomic / generate_monthly_renewals /
-- complete_renewal_with_invoice.
REVOKE INSERT, UPDATE ON TABLE "public"."renewals" FROM "authenticated";

-- SELECT is untouched on all four tables (still governed by the existing
-- RLS select policies), and DELETE is untouched (out of scope for this
-- change; all four tables already have prevent_hard_delete triggers).
