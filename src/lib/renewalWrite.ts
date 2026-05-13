import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { finalizeInvoiceWrite } from '@/lib/invoiceWrite';
import { computeBillingTotals } from '@/lib/billingMath';

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

  const { subtotal, taxTotal, totalAmount } = computeBillingTotals(input.amount, input.gstPercent);

  const invoiceResult = await finalizeInvoiceWrite({
    studentId: input.studentId,
    packageId: input.packageId,
    sportId: input.sportId,
    packageName: input.packageName,
    sportName: input.sportName,
    subtotal,
    discountTotal: 0,
    taxableAmount: subtotal,
    taxTotal,
    totalAmount,
    gstPercent: input.gstPercent,
    paymentMethod: input.paymentMethod,
    paymentModeLabel: input.paymentModeLabel,
    invoiceDate: input.startDate,
    preferredBranchId: input.preferredBranchId ?? null,
  });

  const renewalsTable = supabase.from('renewals') as any;
  const { error } = await renewalsTable
    .update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      generated_invoice_id: invoiceResult.invoiceId,
    })
    .eq('id', input.renewalId);

  if (error) throw error;

  return invoiceResult;
}
