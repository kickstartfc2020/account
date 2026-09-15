-- F3: payment idempotency for record_invoice_payment.
--
-- Problem (see REMEDIATION_PLAN.md, item C1): record_invoice_payment had no
-- idempotency key. A network retry or a double-click of "Record Payment" in
-- StudentDetailSheet could insert two distinct payments rows for the same
-- logical payment, since nothing tied a retried request to the one already
-- processed. The only unique index on payments
-- (uq_payments_invoice_reference_no on (invoice_id, reference_no)) never
-- applies here because record_invoice_payment does not set reference_no.
--
-- Fix: the same request-key dedup pattern already used by
-- finalize_invoice_write (invoice_write_requests), applied to payments via a
-- new payment_write_requests table and an optional p_request_key parameter
-- on record_invoice_payment. All existing validation, locking (SELECT ...
-- FOR UPDATE on the invoice), and overpayment protection is unchanged; the
-- only new behavior is that a repeated call with the same
-- (organization_id, request_key) returns the invoice's current state instead
-- of inserting a second payment.
--
-- No existing row in payments/invoices is modified, deleted, or backfilled
-- by this migration.

-- ---------------------------------------------------------------------------
-- 1. payment_write_requests dedup table (RLS deny-all, mirrors
--    invoice_write_requests exactly)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."payment_write_requests" (
    "organization_id" "uuid" NOT NULL,
    "request_key" "text" NOT NULL,
    "payment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."payment_write_requests" OWNER TO "postgres";

ALTER TABLE ONLY "public"."payment_write_requests"
    ADD CONSTRAINT "payment_write_requests_pkey" PRIMARY KEY ("organization_id", "request_key");

ALTER TABLE ONLY "public"."payment_write_requests"
    ADD CONSTRAINT "payment_write_requests_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."payment_write_requests"
    ADD CONSTRAINT "payment_write_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE "public"."payment_write_requests" ENABLE ROW LEVEL SECURITY;

-- Deny-all: no permissive policy exists, so no row is selectable/writable by
-- anon or authenticated under any circumstance. The restrictive policy below
-- documents that intent explicitly (same construct used for
-- invoice_write_requests). The only writer is record_invoice_payment, a
-- SECURITY DEFINER function that runs as the table owner and therefore does
-- not need, and is not granted, any table-level privilege here.
CREATE POLICY "payment_write_requests_deny_all" ON "public"."payment_write_requests" AS RESTRICTIVE USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE "public"."payment_write_requests" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."payment_write_requests" TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. record_invoice_payment: add optional p_request_key, atomic dedup
-- ---------------------------------------------------------------------------
-- The 4-argument function is dropped and replaced by a single 5-argument
-- function (5th parameter defaulted to NULL) rather than left as a second
-- overload, so there is exactly one record_invoice_payment in the schema and
-- no ambiguity between an old 4-arg call and a new 5-arg call. Any existing
-- caller that does not pass p_request_key continues to hit this same
-- function with p_request_key = NULL, which reproduces the exact prior
-- behavior (no dedup, plain insert) -- fully backward compatible.

DROP FUNCTION IF EXISTS public.record_invoice_payment(uuid, numeric, public.payment_method, text);

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method public.payment_method,
  p_payment_mode_label text,
  p_request_key text DEFAULT NULL
)
 RETURNS TABLE(invoice_id uuid, balance_amount numeric, status public.invoice_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.app_role;
  v_invoice record;
  v_new_balance numeric(12,2);
  v_new_status public.invoice_status;
  v_request_key text;
  v_existing_payment_id uuid;
  v_payment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to record a payment.';
  end if;

  select invoices.id, invoices.organization_id, invoices.branch_id, invoices.balance_amount, invoices.status
    into v_invoice
  from public.invoices
  where invoices.id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.';
  end if;

  if not public.can_access_branch(v_invoice.branch_id) then
    raise exception 'You do not have access to this invoice.';
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Cannot record a payment for a cancelled invoice.';
  end if;

  -- Idempotency check happens BEFORE amount validation: on a retry, the
  -- invoice's balance already reflects the first successful payment, so
  -- validating p_amount against the now-smaller balance would incorrectly
  -- reject a legitimate retry of the original request. A recognized
  -- request_key short-circuits straight to returning the current invoice
  -- state, skipping validation and insertion entirely.
  if p_request_key is not null and btrim(p_request_key) <> '' then
    v_request_key := btrim(p_request_key);

    perform pg_advisory_xact_lock(hashtextextended(v_invoice.organization_id::text || ':' || v_request_key, 0));

    select pwr.payment_id
      into v_existing_payment_id
    from public.payment_write_requests pwr
    where pwr.organization_id = v_invoice.organization_id
      and pwr.request_key = v_request_key;

    if v_existing_payment_id is not null then
      select invoices.balance_amount, invoices.status
        into v_new_balance, v_new_status
      from public.invoices
      where invoices.id = p_invoice_id;

      invoice_id := p_invoice_id;
      balance_amount := v_new_balance;
      status := v_new_status;
      return next;
      return;
    end if;

    -- Reserve the key before doing the work, so a concurrent retry that
    -- arrives while this transaction is still in flight blocks on the
    -- advisory lock above instead of racing the INSERT below.
    insert into public.payment_write_requests (organization_id, request_key)
    values (v_invoice.organization_id, v_request_key)
    on conflict (organization_id, request_key) do nothing;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if p_amount > v_invoice.balance_amount then
    raise exception 'Payment amount cannot exceed the pending balance of %.', v_invoice.balance_amount;
  end if;

  insert into public.payments (
    organization_id,
    branch_id,
    invoice_id,
    amount,
    payment_date,
    method,
    status,
    notes
  ) values (
    v_invoice.organization_id,
    v_invoice.branch_id,
    p_invoice_id,
    p_amount,
    now(),
    p_payment_method,
    'completed',
    'Balance payment received via ' || p_payment_mode_label
  )
  returning id into v_payment_id;

  v_new_balance := round(v_invoice.balance_amount - p_amount, 2);
  v_new_status := case when v_new_balance <= 0 then 'completed' else 'partial' end;

  update public.invoices
  set
    balance_amount = v_new_balance,
    status = v_new_status,
    updated_at = now()
  where id = p_invoice_id;

  if v_new_balance <= 0 then
    update public.invoice_reminders
    set status = 'resolved', resolved_at = now(), updated_at = now()
    where public.invoice_reminders.invoice_id = p_invoice_id
      and public.invoice_reminders.status = 'pending';
  end if;

  if v_request_key is not null then
    update public.payment_write_requests
    set
      payment_id = v_payment_id,
      updated_at = now()
    where organization_id = v_invoice.organization_id
      and request_key = v_request_key;
  end if;

  invoice_id := p_invoice_id;
  balance_amount := v_new_balance;
  status := v_new_status;
  return next;
end;
$function$
;

ALTER FUNCTION "public"."record_invoice_payment"("p_invoice_id" "uuid", "p_amount" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_request_key" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text, text) FROM anon;
GRANT ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text, text) TO service_role;
