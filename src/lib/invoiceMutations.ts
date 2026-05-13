import { supabase } from '@/lib/supabase';

export async function cancelInvoice(invoiceNumber: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invoicesTable = supabase.from('invoices') as any;
  const { error } = await invoicesTable
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('invoice_number', invoiceNumber)
    .neq('status', 'cancelled');

  if (error) {
    throw error;
  }
}
