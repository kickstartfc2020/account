-- Recreate cancel_invoice_safe so it is guaranteed to exist on the live DB.
-- Grants are re-applied so both authenticated users (branch admins, org admins)
-- and the service role can call it.

CREATE OR REPLACE FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invoice_id uuid;
  v_org_id     uuid;
  v_branch_id  uuid;
  v_role       public.app_role;
begin
  -- Resolve the invoice row and lock it for update.
  select id, organization_id, branch_id
    into v_invoice_id, v_org_id, v_branch_id
  from public.invoices
  where invoice_number = p_invoice_number
  for update;

  if not found then
    raise exception 'Invoice % not found.', p_invoice_number;
  end if;

  -- Determine caller role.
  v_role := public.current_role();

  -- Super admins can cancel any invoice.
  -- Org admins can cancel invoices within their org.
  -- Branch managers can only cancel invoices within their own branch.
  if v_role = 'super_admin' then
    -- allowed
    null;
  elsif v_role = 'organization_admin' then
    if public.current_organization_id() is null or public.current_organization_id() <> v_org_id then
      raise exception 'You do not have access to this invoice.';
    end if;
  elsif v_role = 'branch_manager' then
    if public.current_organization_id() is null or public.current_organization_id() <> v_org_id then
      raise exception 'You do not have access to this invoice.';
    end if;
    if public.current_branch_id() is null or public.current_branch_id() <> v_branch_id then
      raise exception 'Branch managers can only cancel invoices in their own branch.';
    end if;
  else
    raise exception 'Insufficient permissions to cancel invoices.';
  end if;

  -- Cancel payments FIRST while the invoice is still active,
  -- otherwise enforce_payment_integrity blocks updates on a cancelled invoice.
  update public.payments
  set
    status     = 'cancelled',
    updated_at = now()
  where invoice_id = v_invoice_id
    and status in ('completed', 'pending');

  -- Now cancel the invoice itself.
  update public.invoices
  set
    status         = 'cancelled',
    balance_amount = 0,
    updated_at     = now()
  where id = v_invoice_id
    and status <> 'cancelled';

  return true;
end;
$$;

ALTER FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."cancel_invoice_safe"("p_invoice_number" "text") TO "service_role";
