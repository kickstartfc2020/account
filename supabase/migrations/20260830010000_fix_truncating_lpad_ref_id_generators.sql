-- Same root cause as 20260830000000 (student ref ids), found in every other
-- ref id / number generator in the schema: lpad(text, N, '0') TRUNCATES once
-- the number grows past N digits, instead of just failing to pad it. Every
-- one of these generators was written with a fixed-width lpad and no
-- protection against outgrowing it, so each will eventually start handing
-- out numbers that collide with an earlier row once its counter crosses the
-- padding width:
--
--   generate_invoice_number  -- 3 digits, per-organization, never resets.
--                                Highest risk: no retry/self-heal exists for
--                                invoices at all, so a collision here is an
--                                immediate hard failure on every invoice
--                                created for that org from then on.
--   generate_branch_ref_id   -- 4 digits, global sequence (seq_branch).
--   generate_org_ref_id      -- 4 digits, global sequence (seq_org).
--   generate_package_ref_id  -- 4 digits, global sequence (seq_package).
--   generate_payment_ref_id  -- 6 digits, global counter per calendar year.
--   generate_renewal_ref_id  -- 6 digits, global counter per calendar year.
--
-- Fix: widen the pad so it only ever grows, never truncates
-- (lpad(text, GREATEST(N, length(text)), '0')), for all six. For invoices
-- specifically -- the one with a real near-term chance of being hit and no
-- retry safety net -- also seed the per-organization counter from the
-- highest invoice number already in use, the same self-healing approach
-- used for students, so a counter that's fallen behind existing data can't
-- produce an immediate collision either.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date" DEFAULT CURRENT_DATE) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_organization_id uuid;
  v_seq integer;
  v_max_used integer;
begin
  select b.organization_id
    into v_organization_id
  from public.branches b
  where b.id = p_branch_id;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization for branch % while generating invoice number.', p_branch_id;
  end if;

  -- Fast-forward the counter past any invoice number already in use for this
  -- org, so a counter that fell behind existing rows can't hand out a
  -- number that's already taken.
  select max(substring(invoice_number from 8)::integer)
    into v_max_used
  from public.invoices
  where organization_id = v_organization_id
    and invoice_number ~ '^INV-KS-[0-9]+$';

  if v_max_used is not null then
    insert into public.ref_counters (counter_key, last_number)
    values ('invoice:' || v_organization_id::text, v_max_used)
    on conflict (counter_key)
    do update set last_number = greatest(ref_counters.last_number, excluded.last_number);
  end if;

  v_seq := public.next_ref_counter('invoice:' || v_organization_id::text);

  -- Pad to at least 3 digits without ever truncating a longer number.
  return format('INV-KS-%s', lpad(v_seq::text, greatest(3, length(v_seq::text)), '0'));
end;
$$;

ALTER FUNCTION "public"."generate_invoice_number"("p_branch_id" "uuid", "p_invoice_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_branch_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq bigint;
begin
  v_seq := nextval('public.seq_branch');
  return 'BR-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
end;
$$;

ALTER FUNCTION "public"."generate_branch_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_org_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq bigint;
begin
  v_seq := nextval('public.seq_org');
  return 'ORG-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
end;
$$;

ALTER FUNCTION "public"."generate_org_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_package_ref_id"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq bigint;
begin
  v_seq := nextval('public.seq_package');
  return 'PKG-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
end;
$$;

ALTER FUNCTION "public"."generate_package_ref_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('payment:' || v_year);
  return format('PAY-%s-%s', v_year, lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'));
end;
$$;

ALTER FUNCTION "public"."generate_payment_ref_id"("p_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_year integer;
  v_seq  integer;
begin
  v_year := extract(year from p_date)::integer;
  v_seq  := public.next_ref_counter('renewal:' || v_year);
  return format('REN-%s-%s', v_year, lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'));
end;
$$;

ALTER FUNCTION "public"."generate_renewal_ref_id"("p_date" timestamp with time zone) OWNER TO "postgres";
