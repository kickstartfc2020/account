-- Phone number is no longer a de-dup/identity key for students: multiple
-- students may share a phone number (e.g. siblings on a parent's number),
-- and phone may be left blank. This only relaxes constraints going
-- forward — no existing rows are modified, deleted, or overwritten.

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_organization_id_phone_key;

ALTER TABLE public.students
  ALTER COLUMN phone DROP NOT NULL;
