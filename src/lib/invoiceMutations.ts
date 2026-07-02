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
    throw new Error((error as any).message || 'Failed to cancel invoice.');
  }

  if (!data) {
    throw new Error('Invoice could not be cancelled.');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:invoices:changed'));
  }
}

export async function updateInvoiceDate(invoiceNumber: string, invoiceDate: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await (supabase as any)
    .from('invoices')
    .update({ invoice_date: invoiceDate })
    .eq('invoice_number', invoiceNumber);

  if (error) {
    reportOperationalError('invoice.update_date', 'Failed to update invoice date.', error, {
      invoiceNumber,
    });
    throw new Error((error as any).message || 'Failed to update invoice date.');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:invoices:changed'));
  }
}
