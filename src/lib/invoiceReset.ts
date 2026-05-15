import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Invoice } from '@/types';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function triggerDownload(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadInvoicesExcelBackup(invoices: Invoice[], organizationName: string) {
  const fileName = `${organizationName || 'Invoices'}-backup-${new Date().toISOString().slice(0, 10)}.xls`;
  const rows = invoices.map((invoice, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(invoice.id)}</td>
      <td>${escapeHtml(invoice.date)}</td>
      <td>${escapeHtml(invoice.studentName)}</td>
      <td>${escapeHtml(invoice.locationName)}</td>
      <td>${escapeHtml(invoice.packageName)}</td>
      <td>${escapeHtml(invoice.paymentMode)}</td>
      <td>${invoice.amount.toFixed(2)}</td>
      <td>${invoice.tax.toFixed(2)}</td>
      <td>${invoice.total.toFixed(2)}</td>
      <td>${escapeHtml(invoice.status)}</td>
      <td>${invoice.balanceAmount.toFixed(2)}</td>
    </tr>`).join('');

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; }
          th { background: #f8fafc; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Invoice Number</th>
              <th>Date</th>
              <th>Student</th>
              <th>Location</th>
              <th>Package</th>
              <th>Payment Mode</th>
              <th>Amount</th>
              <th>Tax</th>
              <th>Total</th>
              <th>Status</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="12">No invoices available.</td></tr>'}</tbody>
        </table>
      </body>
    </html>`;

  triggerDownload(html, fileName, 'application/vnd.ms-excel');
}

export async function resetInvoicesForOrganization(organizationId: string) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await (supabase as any).rpc('admin_reset_invoices', {
    p_organization_id: organizationId,
  });

  if (error) {
    throw error;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:invoices:changed'));
  }

  return data as Array<{ deleted_invoices: number; deleted_payments: number; deleted_items: number }>;
}
