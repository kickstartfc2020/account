-- Root cause of the production error
-- "Unable to generate a unique student ref id for prefix KAL":
--
-- generate_student_ref_id() built the numeric suffix with
-- `lpad(v_seq::text, 2, '0')`. lpad() does not just zero-pad short numbers,
-- it TRUNCATES long ones to the target width -- so once a prefix's shared
-- counter passes 99, lpad('100', 2, '0') returns '10', lpad('101', 2, '0')
-- returns '10' again, lpad('123', 2, '0') returns '12', etc. The candidate
-- ref_id can never grow past 2 digits, so as soon as ~100 students have
-- been created for a prefix, every subsequent seq value collides with an
-- already-used '10'..'99' slot forever. The self-healing loop (added in
-- 20260829000000) then burns through its whole 1000-attempt budget hitting
-- those same collisions and raises the exception on every insert for that
-- prefix -- confirmed by reproducing it locally (seeding a prefix with 100+
-- rows makes seq=100 collide with the existing '...10' row every time).
--
-- Fix: never truncate -- pad to at least 2 digits but let the width grow
-- with the counter (lpad(text, GREATEST(2, length(text)), '0')). Also seed
-- the shared counter from the highest ref_id actually in use for the prefix
-- before generating, so a counter that fell behind a block of pre-existing
-- rows (legacy data, imports) doesn't need to walk past them one at a time.
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
  v_max_used integer;
  v_attempts integer := 0;
begin
  select name
    into v_branch_name
  from public.branches
  where id = p_branch_id;

  v_prefix := substring(regexp_replace(upper(coalesce(v_branch_name, 'BRN')), '[^A-Z]', '', 'g') from 1 for 3);
  v_prefix := rpad(coalesce(nullif(v_prefix, ''), 'BRN'), 3, 'X');

  -- Fast-forward the shared counter past every ref_id already in use for
  -- this prefix (covers legacy rows, imports, or a counter that fell
  -- behind) so the loop below doesn't have to re-walk them one at a time.
  select max(substring(ref_id from length(v_prefix) + 1)::integer)
    into v_max_used
  from public.students
  where ref_id ~ ('^' || v_prefix || '[0-9]+$');

  if v_max_used is not null then
    insert into public.ref_counters (counter_key, last_number)
    values ('student:' || v_prefix, v_max_used)
    on conflict (counter_key)
    do update set last_number = greatest(ref_counters.last_number, excluded.last_number);
  end if;

  -- Counter is shared by prefix so IDs remain unique even if branch names are similar.
  loop
    v_seq := public.next_ref_counter('student:' || v_prefix);
    -- Pad to at least 2 digits without ever truncating a longer number.
    v_candidate := v_prefix || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');

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
