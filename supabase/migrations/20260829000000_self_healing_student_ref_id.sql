-- Fix: generate_student_ref_id(uuid) trusted the ref_counters table blindly,
-- so if a student row ever ended up with a ref_id that didn't come from
-- (or wasn't reflected in) that counter -- manual insert, import, a
-- previous reset -- the counter could hand out a value that collides with
-- an existing row, causing "duplicate key value violates unique constraint
-- students_ref_id_key" on student creation.
--
-- Made the generator self-healing: it now loops past any already-used
-- ref_id instead of trusting the counter is in sync with public.students.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_branch_name text;
  v_prefix text;
  v_seq integer;
  v_candidate text;
  v_attempts integer := 0;
begin
  select name
    into v_branch_name
  from public.branches
  where id = p_branch_id;

  v_prefix := substring(regexp_replace(upper(coalesce(v_branch_name, 'BRN')), '[^A-Z]', '', 'g') from 1 for 3);
  v_prefix := rpad(coalesce(nullif(v_prefix, ''), 'BRN'), 3, 'X');

  -- Counter is shared by prefix so IDs remain unique even if branch names are similar.
  loop
    v_seq := public.next_ref_counter('student:' || v_prefix);
    v_candidate := v_prefix || lpad(v_seq::text, 2, '0');

    exit when not exists (select 1 from public.students where ref_id = v_candidate);

    v_attempts := v_attempts + 1;
    if v_attempts > 1000 then
      raise exception 'Unable to generate a unique student ref id for prefix %', v_prefix;
    end if;
  end loop;

  return v_candidate;
end;
$$;

ALTER FUNCTION "public"."generate_student_ref_id"("p_branch_id" "uuid") OWNER TO "postgres";
