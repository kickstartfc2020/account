-- Amount a student already paid in installments before this system tracked
-- their invoices (e.g. carried over from a prior year). Deducted from the
-- payable amount when creating new invoices so staff don't double-charge.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS previous_received_amount numeric(12,2) NOT NULL DEFAULT 0;
