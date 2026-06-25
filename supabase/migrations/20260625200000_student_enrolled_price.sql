-- Snapshot package price at enrollment time.
-- Existing students are backfilled from their current package.
-- Future enrollments set this at insert/update time from the application layer.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS enrolled_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS enrolled_tax_percent numeric(5,2);

UPDATE public.students s
SET
  enrolled_price      = p.amount,
  enrolled_tax_percent = p.gst_percent
FROM public.packages p
WHERE p.id = s.current_package_id
  AND s.enrolled_price IS NULL;
