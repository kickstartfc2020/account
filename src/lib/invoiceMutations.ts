import { supabase } from '@/lib/supabase';
import { reportOperationalError } from '@/lib/observability';

export async function cancelInvoice(invoiceNumber: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await (supabase as any).rpc('cancel_invoice_safe', {
    p_invoice_number: invoiceNumber,
  });

  if (error) {
    reportOperationalError('rpc.invoice.cancel', 'cancel_invoice_safe RPC failed.', error, {
      invoiceNumber,
    });
    throw error;
  }

  if (!data) {
    throw new Error('Invoice could not be cancelled.');
  }
}
