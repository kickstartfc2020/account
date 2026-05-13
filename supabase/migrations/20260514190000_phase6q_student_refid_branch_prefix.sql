-- Phase 6q: Student readable IDs as branch-prefix format (example: BAN01)
-- Keeps UUID as PK, updates business-facing students.ref_id generation.

create or replace function public.generate_student_ref_id(p_branch_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_name text;
  v_prefix text;
  v_seq integer;
begin
  select name
    into v_branch_name
  from public.branches
  where id = p_branch_id;

  v_prefix := substring(regexp_replace(upper(coalesce(v_branch_name, 'BRN')), '[^A-Z]', '', 'g') from 1 for 3);
  v_prefix := rpad(coalesce(nullif(v_prefix, ''), 'BRN'), 3, 'X');

  -- Counter is shared by prefix so IDs remain unique even if branch names are similar.
  v_seq := public.next_ref_counter('student:' || v_prefix);

  return v_prefix || lpad(v_seq::text, 2, '0');
end;
$$;

create or replace function public.trg_set_student_ref_id()
returns trigger
language plpgsql
as $$
begin
  if new.ref_id is null then
    new.ref_id := public.generate_student_ref_id(new.branch_id);
  end if;
  return new;
end;
$$;

-- Backfill missing/non-readable values to new branch-prefix pattern.
update public.students s
set ref_id = public.generate_student_ref_id(s.branch_id)
where s.ref_id is null
   or s.ref_id !~ '^[A-Z]{3}[0-9]+$';
