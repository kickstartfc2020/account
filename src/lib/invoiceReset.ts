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

export type FinancialYearResetPreview = {
  financial_year: string;
  fy_start: string;
  fy_end: string;
  invoices_count: number;
  invoice_items_count: number;
  payments_count: number;
  renewals_count: number;
};

export type FinancialYearResetResult = {
  financial_year: string;
  invoices_deleted: number;
  invoice_items_deleted: number;
  payments_deleted: number;
  renewals_deleted: number;
  backup_id: number;
  audit_log_id: number;
};

function toError(raw: unknown, fallback: string): Error {
  if (raw instanceof Error) return raw;
  const msg = (raw as any)?.message ?? (raw as any)?.error_description ?? fallback;
  return new Error(typeof msg === 'string' && msg ? msg : fallback);
}

export async function getFinancialYearResetPreview(organizationId?: string | null) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await (supabase as any).rpc('get_financial_year_reset_preview', {
    p_organization_id: organizationId ?? null,
  });

  if (error) {
    throw toError(error, 'Failed to load financial year reset preview.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as FinancialYearResetPreview | undefined;
  if (!row) {
    throw new Error('Failed to load financial year reset preview.');
  }

  return row;
}

export async function resetFinancialYearForOrganization(
  organizationId?: string | null,
  confirmationText = 'RESET',
  ipAddress?: string | null,
) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await (supabase as any).rpc('admin_reset_financial_year', {
    p_organization_id: organizationId ?? null,
    p_confirmation_text: confirmationText,
    p_ip_address: ipAddress ?? null,
  });

  if (error) {
    throw toError(error, 'Failed to reset financial year data.');
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:invoices:changed'));
  }

  const row = (Array.isArray(data) ? data[0] : data) as FinancialYearResetResult | undefined;
  if (!row) {
    throw new Error('Failed to reset financial year data.');
  }

  return row;
}
