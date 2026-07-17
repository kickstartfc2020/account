-- Partial payments on invoice creation, plus a mandatory follow-up reminder
-- for the pending balance, and a way to later collect that balance.
--
-- The schema already anticipated partial payments (invoice_status has
-- 'partial'/'unpaid', invoices.balance_amount exists, and
-- accounting_invoice_totals already splits billed/collected/pending) but
-- finalize_invoice_write always hardcoded balance_amount = 0 and paid the
-- full total. This migration wires that up and adds reminders tracking.

CREATE TYPE "public"."reminder_status" AS ENUM (
    'pending',
    'resolved'
);

ALTER TYPE "public"."reminder_status" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."invoice_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "remind_at" "date" NOT NULL,
    "note" "text",
    "status" "public"."reminder_status" DEFAULT 'pending'::"public"."reminder_status" NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoice_reminders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."invoice_reminders" OWNER TO "postgres";

ALTER TABLE ONLY "public"."invoice_reminders"
    ADD CONSTRAINT "invoice_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."invoice_reminders"
    ADD CONSTRAINT "invoice_reminders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."invoice_reminders"
    ADD CONSTRAINT "invoice_reminders_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."invoice_reminders"
    ADD CONSTRAINT "invoice_reminders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;

-- At most one active (pending) reminder per invoice — rescheduling updates
-- the existing row instead of stacking duplicates.
CREATE UNIQUE INDEX "invoice_reminders_one_pending_per_invoice" ON "public"."invoice_reminders" ("invoice_id") WHERE ("status" = 'pending');

CREATE INDEX "invoice_reminders_branch_status_remind_at_idx" ON "public"."invoice_reminders" ("organization_id", "branch_id", "status", "remind_at");

ALTER TABLE "public"."invoice_reminders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_reminders_select_policy" ON "public"."invoice_reminders" FOR SELECT USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("branch_id" = "public"."current_branch_id"()))));

CREATE POLICY "invoice_reminders_write_policy" ON "public"."invoice_reminders" USING (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"())))) WITH CHECK (("public"."is_super_admin"() OR (("public"."current_role"() = 'organization_admin'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"())) OR (("public"."current_role"() = 'branch_manager'::"public"."app_role") AND ("organization_id" = "public"."current_organization_id"()) AND ("branch_id" = "public"."current_branch_id"()))));

GRANT ALL ON TABLE "public"."invoice_reminders" TO "anon";
GRANT ALL ON TABLE "public"."invoice_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_reminders" TO "service_role";

-- ── finalize_invoice_write: accept a partial paid amount + mandatory reminder ──
--
-- Adding trailing parameters changes the function's type signature, so
-- CREATE OR REPLACE alone would leave the old signature behind as an
-- ambiguous overload (same pitfall the cgst_sgst_split migration hit).
-- Drop the old signatures first.

DROP FUNCTION IF EXISTS public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text);

DROP FUNCTION IF EXISTS public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text);

CREATE OR REPLACE FUNCTION public.finalize_invoice_write(p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_invoice_number text DEFAULT NULL::text, p_paid_amount numeric DEFAULT NULL::numeric, p_reminder_date date DEFAULT NULL::date, p_reminder_note text DEFAULT NULL::text)
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
        invoice_id := v_created_invoice_id;
        invoice_number := v_created_invoice_number;
        return next;
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
    p_sport_name || ' fee invoice'
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

REVOKE ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, uuid, date, text, numeric, date, text) TO service_role;

-- ── finalize_invoice_write_v2: pass the new params through ──

CREATE OR REPLACE FUNCTION "public"."finalize_invoice_write_v2"("p_student_id" "uuid", "p_package_id" "uuid", "p_sport_id" "uuid", "p_package_name" "text", "p_sport_name" "text", "p_subtotal" numeric, "p_discount_total" numeric, "p_taxable_amount" numeric, "p_tax_total" numeric, "p_total_amount" numeric, "p_gst_percent" numeric, "p_payment_method" "public"."payment_method", "p_payment_mode_label" "text", "p_manual_items" "jsonb" DEFAULT NULL::"jsonb", "p_preferred_branch_id" "uuid" DEFAULT NULL::"uuid", "p_invoice_date" "date" DEFAULT CURRENT_DATE, "p_invoice_number" "text" DEFAULT NULL::"text", "p_paid_amount" numeric DEFAULT NULL::numeric, "p_reminder_date" "date" DEFAULT NULL::"date", "p_reminder_note" "text" DEFAULT NULL::"text") RETURNS TABLE("invoice_id" "uuid", "invoice_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
  v_has_manual_items boolean := false;
begin
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
    p_taxable_amount,
    p_tax_total,
    p_total_amount,
    p_gst_percent,
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_invoice_date,
    p_invoice_number,
    p_paid_amount,
    p_reminder_date,
    p_reminder_note
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

      v_line_subtotal := round(v_quantity * v_unit_price, 2);
      v_line_tax := round(v_line_subtotal * greatest(p_gst_percent, 0) / 100, 2);
      v_line_total := round(v_line_subtotal + v_line_tax, 2);

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
      p_taxable_amount,
      p_tax_total,
      p_total_amount
    from public.invoices inv
    where inv.id = v_result.invoice_id
      and not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id);
  end if;

  invoice_id := v_result.invoice_id;
  invoice_number := v_result.invoice_number;
  return next;
end;
$$;

REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text) TO service_role;

-- ── Collect a follow-up payment against an existing partial invoice ──

CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_amount numeric, p_payment_method public.payment_method, p_payment_mode_label text)
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
  );

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

  invoice_id := p_invoice_id;
  balance_amount := v_new_balance;
  status := v_new_status;
  return next;
end;
$function$
;

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text) FROM anon;
GRANT ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text) TO authenticated;
GRANT ALL ON FUNCTION public.record_invoice_payment(uuid, numeric, public.payment_method, text) TO service_role;

-- ── Reschedule a pending reminder from the Manual Invoice Pending page ──

CREATE OR REPLACE FUNCTION public.reschedule_invoice_reminder(p_reminder_id uuid, p_remind_at date, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reminder record;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select id, branch_id, status
    into v_reminder
  from public.invoice_reminders
  where id = p_reminder_id
  for update;

  if not found then
    raise exception 'Reminder not found.';
  end if;

  if not public.can_access_branch(v_reminder.branch_id) then
    raise exception 'You do not have access to this reminder.';
  end if;

  if v_reminder.status <> 'pending' then
    raise exception 'Only pending reminders can be rescheduled.';
  end if;

  if p_remind_at is null then
    raise exception 'A reminder date is required.';
  end if;

  update public.invoice_reminders
  set
    remind_at = p_remind_at,
    note = case when p_note is null then note else nullif(btrim(p_note), '') end,
    updated_at = now()
  where id = p_reminder_id;

  return true;
end;
$function$
;

REVOKE ALL ON FUNCTION public.reschedule_invoice_reminder(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_invoice_reminder(uuid, date, text) FROM anon;
GRANT ALL ON FUNCTION public.reschedule_invoice_reminder(uuid, date, text) TO authenticated;
GRANT ALL ON FUNCTION public.reschedule_invoice_reminder(uuid, date, text) TO service_role;
