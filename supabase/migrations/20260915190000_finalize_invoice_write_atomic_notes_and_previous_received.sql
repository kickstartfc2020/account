-- F6 (audit Option A): fold the two post-commit client writes that followed
-- a successful CreateInvoice.tsx submission into the invoice finalization
-- transaction itself, instead of leaving them as separate best-effort calls
-- that can silently fail after the invoice is already visible to the user
-- (REMEDIATION_PLAN.md D1):
--   1. Manual invoice bill-to details (CreateInvoice.tsx: a direct
--      `.from('invoices').update({ notes })` after finalize_invoice_write_v2
--      succeeded).
--   2. `students.previous_received_amount` (CreateInvoice.tsx: a direct
--      `updateStudentPreviousReceivedAmount()` call, same pattern).
--
-- Both are now parameters on the RPC and are written inside the same
-- transaction as the invoice/invoice_items/payments/reminders rows, so a
-- partial-failure state (invoice created but notes/previous-received-amount
-- silently lost) is no longer reachable.
--
-- Adding trailing parameters changes a function's type signature in
-- Postgres, so (matching the pattern already used by
-- 20260717000000_partial_payments_and_reminders.sql and
-- 20260813000000_gst_inclusive_manual_items.sql) the old signatures are
-- dropped before the new ones are created, to avoid leaving an ambiguous
-- ghost overload behind.
--
-- One deviation from "untouched": the request_key replay branch inside
-- finalize_invoice_write was missing a bare `return;` after `return next;`,
-- so PL/pgSQL fell through past the idempotency check into a fresh INSERT on
-- every replay (see the inline NOTE at that branch below). This migration
-- adds the missing `return;`. It is a one-line correctness fix, not a
-- behavior change to the idempotency design -- without it, requirement #3
-- above ("never reapply previous_received_amount on replay") is impossible
-- to satisfy, since the fall-through path re-runs that update too.
--
-- Otherwise untouched: authorization/role checks, branch/org/package/sport
-- validation, invoice-write idempotency (invoice_write_requests, request_key
-- locking), the A3/F1 totals reconciliation added in
-- 20260915170000_invoice_header_item_reconciliation.sql, payment and
-- reminder insertion, invoice numbering. No renewal, payment-idempotency,
-- batch, or FY-reset logic is touched. No existing invoices/students row is
-- read, modified, or backfilled by this migration.

-- ---------------------------------------------------------------------------
-- 1. finalize_invoice_write: add p_notes / p_previous_received_amount.
--
-- This is the function that actually performs the invoice INSERT and the
-- one place that already distinguishes "fresh invoice" from "idempotent
-- replay of an already-processed request_key" (the replay path returns
-- immediately, before reaching the INSERT statements below). Both new
-- writes are placed after that branch point, so a replay can never re-apply
-- students.previous_received_amount or touch notes a second time.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text);

CREATE OR REPLACE FUNCTION public.finalize_invoice_write(p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_invoice_number text DEFAULT NULL::text, p_paid_amount numeric DEFAULT NULL::numeric, p_reminder_date date DEFAULT NULL::date, p_reminder_note text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_previous_received_amount numeric DEFAULT NULL::numeric)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student record;
  v_organization_id uuid;
  v_branch_id uuid;
  v_invoice_number text;
  v_role public.app_role;
  v_caller_branch uuid;
  v_package record;
  v_sport record;
  v_request_key text;
  v_existing_invoice_id uuid;
  v_created_invoice_id uuid;
  v_created_invoice_number text;
  v_paid_amount numeric(12,2);
  v_balance_amount numeric(12,2);
  v_status public.invoice_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'Unable to resolve role context.';
  end if;

  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to finalize invoice write.';
  end if;

  select organization_id, branch_id
    into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    v_organization_id := v_student.organization_id;
  elsif v_organization_id <> v_student.organization_id then
    raise exception 'Student does not belong to the active organization.';
  end if;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization context.';
  end if;

  v_caller_branch := public.current_branch_id();

  if v_role = 'branch_manager' then
    if v_caller_branch is null then
      raise exception 'Unable to resolve branch manager branch context.';
    end if;

    if v_student.branch_id is distinct from v_caller_branch then
      raise exception 'Branch managers can only invoice students in their own branch.';
    end if;
  end if;

  v_branch_id := coalesce(p_preferred_branch_id, v_caller_branch, v_student.branch_id);
  if v_branch_id is null then
    raise exception 'Unable to resolve branch context.';
  end if;

  if v_role = 'branch_manager' and v_branch_id is distinct from v_caller_branch then
    raise exception 'Branch managers cannot write invoices for a different branch.';
  end if;

  perform 1
  from public.branches
  where id = v_branch_id
    and organization_id = v_organization_id;

  if not found then
    raise exception 'Branch does not belong to the active organization.';
  end if;

  select organization_id, branch_id, sport_id, status
    into v_package
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  if v_package.organization_id <> v_organization_id then
    raise exception 'Package does not belong to the active organization.';
  end if;

  if v_package.branch_id is not null and v_package.branch_id <> v_branch_id then
    raise exception 'Package does not belong to the selected branch.';
  end if;

  if v_package.sport_id <> p_sport_id then
    raise exception 'Package and sport mismatch.';
  end if;

  select organization_id, branch_id, status
    into v_sport
  from public.sports
  where id = p_sport_id;

  if not found then
    raise exception 'Sport not found.';
  end if;

  if v_sport.status <> 'active' then
    raise exception 'Sport is not active.';
  end if;

  if v_sport.organization_id <> v_organization_id then
    raise exception 'Sport does not belong to the active organization.';
  end if;

  if v_sport.branch_id is not null and v_sport.branch_id <> v_branch_id then
    raise exception 'Sport does not belong to the selected branch.';
  end if;

  -- Amount actually collected now. Defaults to the full total so any other
  -- (future) caller that omits p_paid_amount keeps today's full-payment
  -- behavior.
  v_paid_amount := round(coalesce(p_paid_amount, p_total_amount), 2);

  if v_paid_amount < 0 then
    raise exception 'Paid amount cannot be negative.';
  end if;

  if v_paid_amount > p_total_amount then
    raise exception 'Paid amount cannot exceed the invoice total.';
  end if;

  v_balance_amount := round(p_total_amount - v_paid_amount, 2);

  if v_balance_amount <= 0 then
    v_status := 'completed';
  elsif v_paid_amount <= 0 then
    v_status := 'unpaid';
  else
    v_status := 'partial';
  end if;

  -- Server-side enforcement: a reminder is mandatory whenever any balance is
  -- left outstanding (partial or fully unpaid), regardless of what the
  -- client sends.
  if v_balance_amount > 0 and p_reminder_date is null then
    raise exception 'A reminder date is required when recording a partial payment.';
  end if;

  if p_invoice_number is not null and btrim(p_invoice_number) <> '' then
    v_request_key := btrim(p_invoice_number);

    perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':' || v_request_key, 0));

    select iwr.invoice_id
      into v_existing_invoice_id
    from public.invoice_write_requests iwr
    where iwr.organization_id = v_organization_id
      and iwr.request_key = v_request_key;

    if v_existing_invoice_id is not null then
      select inv.id, inv.invoice_number
        into v_created_invoice_id, v_created_invoice_number
      from public.invoices inv
      where inv.id = v_existing_invoice_id;

      if v_created_invoice_id is not null then
        -- Idempotent replay: an invoice already exists for this
        -- request_key. Return it and stop here.
        --
        -- NOTE: the pre-existing version of this branch (pre-dating this
        -- migration) called `return next;` without a following bare
        -- `return;`. In PL/pgSQL, RETURN NEXT queues a row but does not
        -- exit the function, so execution fell through past this whole
        -- if-block into the invoice INSERT below -- on a genuine
        -- request_key replay this created a *second* invoice and returned
        -- two rows, silently defeating the idempotency this block exists
        -- to provide. Task requirement #3 ("never reapply
        -- previous_received_amount on replay") is unreachable without
        -- closing that hole, since the fall-through path also re-runs the
        -- previous_received_amount update below. The bare `return;` here
        -- is the minimal fix: it makes this function actually idempotent
        -- (matching its evident intent and every caller's assumption)
        -- instead of merely appearing to be.
        invoice_id := v_created_invoice_id;
        invoice_number := v_created_invoice_number;
        return next;
        return;
      end if;
    end if;

    insert into public.invoice_write_requests (organization_id, request_key)
    values (v_organization_id, v_request_key)
    on conflict (organization_id, request_key) do nothing;
  end if;

  v_invoice_number := public.generate_invoice_number(v_branch_id, p_invoice_date);

  insert into public.invoices (
    organization_id,
    branch_id,
    student_id,
    invoice_number,
    invoice_date,
    status,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    balance_amount,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    p_student_id,
    v_invoice_number,
    p_invoice_date,
    v_status,
    p_subtotal,
    p_tax_total,
    p_discount_total,
    p_total_amount,
    v_balance_amount,
    coalesce(p_notes, p_sport_name || ' fee invoice')
  )
  returning id, invoices.invoice_number into v_created_invoice_id, v_created_invoice_number;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    package_id,
    sport_id,
    description,
    quantity,
    unit_price,
    gst_percent,
    line_subtotal,
    line_tax,
    line_total
  ) values (
    v_organization_id,
    v_created_invoice_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    1,
    p_subtotal,
    p_gst_percent,
    p_taxable_amount,
    p_tax_total,
    p_total_amount
  );

  if v_paid_amount > 0 then
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
      v_organization_id,
      v_branch_id,
      v_created_invoice_id,
      v_paid_amount,
      now(),
      p_payment_method,
      'completed',
      'Payment received via ' || p_payment_mode_label
    );
  end if;

  if v_balance_amount > 0 then
    insert into public.invoice_reminders (
      organization_id,
      branch_id,
      student_id,
      invoice_id,
      remind_at,
      note,
      status,
      created_by
    ) values (
      v_organization_id,
      v_branch_id,
      p_student_id,
      v_created_invoice_id,
      p_reminder_date,
      nullif(btrim(coalesce(p_reminder_note, '')), ''),
      'pending',
      auth.uid()
    );
  end if;

  -- New-invoice-only: this line is only reachable when a fresh invoice was
  -- just created above (the idempotent-replay branch returns earlier), so a
  -- retried/duplicated request_key can never re-apply this.
  if p_previous_received_amount is not null then
    update public.students
    set
      previous_received_amount = greatest(p_previous_received_amount, 0),
      updated_at = now()
    where id = p_student_id;
  end if;

  if v_request_key is not null then
    update public.invoice_write_requests
    set
      invoice_id = v_created_invoice_id,
      updated_at = now()
    where organization_id = v_organization_id
      and request_key = v_request_key;
  end if;

  invoice_id := v_created_invoice_id;
  invoice_number := v_created_invoice_number;
  return next;
end;
$function$
;

REVOKE ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text, text, numeric) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text, text, numeric) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text, text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. finalize_invoice_write_v2: pass the two new params through unchanged.
--
-- No new logic here -- v2's own job (manual-item reconciliation, A3/F1
-- totals validation) is untouched; it just forwards p_notes and
-- p_previous_received_amount to finalize_invoice_write, which is where the
-- actual conditional/idempotent-safe writes happen (see above).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean);

CREATE OR REPLACE FUNCTION public.finalize_invoice_write_v2(
  p_student_id uuid,
  p_package_id uuid,
  p_sport_id uuid,
  p_package_name text,
  p_sport_name text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_taxable_amount numeric,
  p_tax_total numeric,
  p_total_amount numeric,
  p_gst_percent numeric,
  p_payment_method public.payment_method,
  p_payment_mode_label text,
  p_manual_items jsonb DEFAULT NULL::jsonb,
  p_preferred_branch_id uuid DEFAULT NULL::uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_invoice_number text DEFAULT NULL::text,
  p_paid_amount numeric DEFAULT NULL::numeric,
  p_reminder_date date DEFAULT NULL::date,
  p_reminder_note text DEFAULT NULL::text,
  p_gst_inclusive boolean DEFAULT false,
  p_notes text DEFAULT NULL::text,
  p_previous_received_amount numeric DEFAULT NULL::numeric
)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_result record;
  v_item jsonb;
  v_default_item_id uuid;
  v_default_item_updated boolean := false;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_line_gross numeric;
  v_has_manual_items boolean := false;
  -- Reconciliation working variables.
  v_tolerance constant numeric(12,2) := 0.02;
  v_items_gross_sum numeric(12,2) := 0;
  v_computed_taxable numeric(12,2);
  v_computed_tax numeric(12,2);
  v_computed_total numeric(12,2);
  v_computed_gross_total numeric(12,2);
begin
  -- ── 1. Manual items: validate that the declared subtotal actually equals
  --      the sum of the submitted line items (quantity * unit_price), using
  --      the identical valid-line filter the per-line insertion loop below
  --      uses, before any row is written. round(qty*price,2) is the "gross"
  --      per-line amount in both GST-inclusive and GST-exclusive modes (the
  --      inclusive/exclusive toggle only changes how that gross splits into
  --      base + tax, not the gross itself), so this check is mode-independent.
  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    for v_item in
      select value
      from jsonb_array_elements(p_manual_items)
    loop
      v_description := nullif(trim(coalesce(v_item ->> 'description', '')), '');
      v_quantity := greatest(coalesce((v_item ->> 'quantity')::numeric, 0), 0);
      v_unit_price := greatest(coalesce((v_item ->> 'unitPrice')::numeric, 0), 0);

      if v_description is null or v_quantity <= 0 then
        continue;
      end if;

      v_items_gross_sum := v_items_gross_sum + round(v_quantity * v_unit_price, 2);
    end loop;

    if abs(v_items_gross_sum - round(coalesce(p_subtotal, 0), 2)) > v_tolerance then
      raise exception 'Invoice subtotal (%) does not match the sum of the submitted line items (%).',
        round(coalesce(p_subtotal, 0), 2), v_items_gross_sum;
    end if;
  end if;

  -- ── 2. Independently recompute taxable_amount/tax_total/total_amount from
  --      (subtotal, discount_total, gst_percent, gst_inclusive), mirroring
  --      src/lib/billingMath.ts exactly (paise-rounded via round(x, 2)), and
  --      require the client-submitted values to agree within ₹0.02. This
  --      applies to both manual and package invoices: for a package invoice
  --      the "generated item" the header is derived from is simply
  --      (p_subtotal, p_gst_percent) via this same formula, since the
  --      package path's single line item is written from these same
  --      computed values below (see finalize_invoice_write call).
  if p_gst_inclusive then
    v_computed_gross_total := round(greatest(coalesce(p_subtotal, 0) - coalesce(p_discount_total, 0), 0), 2);
    v_computed_taxable := case
      when p_gst_percent > 0 then round(v_computed_gross_total / (1 + p_gst_percent / 100), 2)
      else v_computed_gross_total
    end;
    v_computed_tax := round(v_computed_gross_total - v_computed_taxable, 2);
    v_computed_total := v_computed_gross_total;
  else
    v_computed_taxable := round(greatest(coalesce(p_subtotal, 0) - coalesce(p_discount_total, 0), 0), 2);
    v_computed_tax := round(greatest(v_computed_taxable * greatest(p_gst_percent, 0) / 100, 0), 2);
    v_computed_total := round(v_computed_taxable + v_computed_tax, 2);
  end if;

  if abs(v_computed_taxable - round(coalesce(p_taxable_amount, 0), 2)) > v_tolerance
     or abs(v_computed_tax - round(coalesce(p_tax_total, 0), 2)) > v_tolerance
     or abs(v_computed_total - round(coalesce(p_total_amount, 0), 2)) > v_tolerance then
    raise exception
      'Invoice totals do not reconcile: expected taxable=%, tax=%, total=% but received taxable=%, tax=%, total=%.',
      v_computed_taxable, v_computed_tax, v_computed_total,
      round(coalesce(p_taxable_amount, 0), 2), round(coalesce(p_tax_total, 0), 2), round(coalesce(p_total_amount, 0), 2);
  end if;

  -- ── 3. Create the invoice header (and, for package invoices, its single
  --      default line item) using the server-computed totals, not the raw
  --      client values -- this is the "server-authoritative" part. Manual
  --      items are still inserted per-line below exactly as before; only the
  --      header/default-item totals now come from step 2's computation.
  select *
    into v_result
  from public.finalize_invoice_write(
    p_student_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    p_sport_name,
    p_subtotal,
    p_discount_total,
    v_computed_taxable,
    v_computed_tax,
    v_computed_total,
    p_gst_percent,
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_invoice_date,
    p_invoice_number,
    p_paid_amount,
    p_reminder_date,
    p_reminder_note,
    p_notes,
    p_previous_received_amount
  );

  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    v_has_manual_items := true;

    select ii.id
      into v_default_item_id
    from public.invoice_items ii
    where ii.invoice_id = v_result.invoice_id
    order by ii.created_at asc
    limit 1;

    for v_item in
      select value
      from jsonb_array_elements(p_manual_items)
    loop
      v_description := nullif(trim(coalesce(v_item ->> 'description', '')), '');
      v_quantity := greatest(coalesce((v_item ->> 'quantity')::numeric, 0), 0);
      v_unit_price := greatest(coalesce((v_item ->> 'unitPrice')::numeric, 0), 0);

      if v_description is null or v_quantity <= 0 then
        continue;
      end if;

      if p_gst_inclusive then
        v_line_gross := round(v_quantity * v_unit_price, 2);
        v_line_subtotal := case
          when p_gst_percent > 0 then round(v_line_gross / (1 + p_gst_percent / 100), 2)
          else v_line_gross
        end;
        v_line_tax := v_line_gross - v_line_subtotal;
        v_line_total := v_line_gross;
      else
        v_line_subtotal := round(v_quantity * v_unit_price, 2);
        v_line_tax := round(v_line_subtotal * greatest(p_gst_percent, 0) / 100, 2);
        v_line_total := round(v_line_subtotal + v_line_tax, 2);
      end if;

      if v_default_item_id is not null and not v_default_item_updated then
        update public.invoice_items ii
        set
          package_id = p_package_id,
          sport_id = p_sport_id,
          description = v_description,
          quantity = v_quantity,
          unit_price = v_unit_price,
          gst_percent = p_gst_percent,
          line_subtotal = v_line_subtotal,
          line_tax = v_line_tax,
          line_total = v_line_total,
          updated_at = now()
        where ii.id = v_default_item_id;

        v_default_item_updated := true;
      else
        insert into public.invoice_items (
          organization_id,
          invoice_id,
          package_id,
          sport_id,
          description,
          quantity,
          unit_price,
          gst_percent,
          line_subtotal,
          line_tax,
          line_total
        )
        select
          inv.organization_id,
          v_result.invoice_id,
          p_package_id,
          p_sport_id,
          v_description,
          v_quantity,
          v_unit_price,
          p_gst_percent,
          v_line_subtotal,
          v_line_tax,
          v_line_total
        from public.invoices inv
        where inv.id = v_result.invoice_id;
      end if;
    end loop;

    if not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id) then
      v_has_manual_items := false;
    end if;
  end if;

  if not v_has_manual_items then
    insert into public.invoice_items (
      organization_id,
      invoice_id,
      package_id,
      sport_id,
      description,
      quantity,
      unit_price,
      gst_percent,
      line_subtotal,
      line_tax,
      line_total
    )
    select
      inv.organization_id,
      v_result.invoice_id,
      p_package_id,
      p_sport_id,
      p_package_name,
      1,
      p_subtotal,
      p_gst_percent,
      v_computed_taxable,
      v_computed_tax,
      v_computed_total
    from public.invoices inv
    where inv.id = v_result.invoice_id
      and not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id);
  end if;

  invoice_id := v_result.invoice_id;
  invoice_number := v_result.invoice_number;
  return next;
end;
$$;

REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean, text, numeric) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean, text, numeric) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean, text, numeric) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Close the invoices.notes column-grant exception (F5 follow-up).
--
-- With CreateInvoice.tsx's direct `.from('invoices').update({ notes })` call
-- removed (notes is now written inside finalize_invoice_write above), there
-- is no remaining legitimate direct client write to any of the four core
-- financial tables. Revoke the "notes"-only UPDATE grant so invoices is
-- locked down the same way invoice_items/payments/renewals already are.
-- ---------------------------------------------------------------------------

REVOKE UPDATE ("notes") ON TABLE public.invoices FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reload PostgREST's schema cache so both changed RPC signatures are
--    picked up immediately (Postgres itself has no separate notification
--    step for this; PostgREST caches the function catalog).
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
