import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { computeBillingTotals } from '@/lib/billingMath';
import { reportOperationalError } from '@/lib/observability';

type CompleteRenewalInput = {
  renewalId: string;
  studentId: string;
  packageId: string;
  sportId: string;
  packageName: string;
  sportName: string;
  amount: number;
  gstPercent: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';
  paymentModeLabel: string;
  startDate?: string;
  preferredBranchId?: string | null;
};

export async function completeRenewal(input: CompleteRenewalInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { subtotal, taxableAmount, taxTotal, totalAmount } = computeBillingTotals(input.amount, input.gstPercent);

  const { data, error } = await (supabase as any).rpc('complete_renewal_with_invoice', {
    p_renewal_id: input.renewalId,
    p_student_id: input.studentId,
    p_package_id: input.packageId,
    p_sport_id: input.sportId,
    p_package_name: input.packageName,
    p_sport_name: input.sportName,
    p_subtotal: subtotal,
    p_discount_total: 0,
    p_taxable_amount: taxableAmount,
    p_tax_total: taxTotal,
    p_total_amount: totalAmount,
    p_gst_percent: input.gstPercent,
    p_payment_method: input.paymentMethod,
    p_payment_mode_label: input.paymentModeLabel,
    p_preferred_branch_id: input.preferredBranchId ?? null,
    p_start_date: input.startDate ?? new Date().toISOString().slice(0, 10),
  });

  if (error || !data) {
    reportOperationalError('rpc.renewal.complete', 'complete_renewal_with_invoice RPC failed.', error, {
      renewalId: input.renewalId,
      studentId: input.studentId,
      packageId: input.packageId,
      sportId: input.sportId,
    });
    throw error ?? new Error('Failed to complete renewal.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  const invoiceId = (row as any)?.invoice_id as string | undefined;
  const invoiceNumber = (row as any)?.invoice_number as string | undefined;

  if (!invoiceId || !invoiceNumber) {
    throw new Error('Failed to resolve generated renewal invoice.');
  }

  return { invoiceId, invoiceNumber };
}
