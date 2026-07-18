import React from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Printer,
  Download,
  Mail,
  ReceiptText,
  XCircle,
  House,
  Pencil,
  Check,
  X
} from 'lucide-react';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';
import { useInvoices, useStudents, useLocations } from '@/hooks/useData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { buildInvoicePdfBlob, downloadPdfBlob } from '@/lib/invoiceExport';
import { cancelInvoice, updateInvoiceDate } from '@/lib/invoiceMutations';
import { cn, formatDateDMY } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Invoice } from '@/types';
import { parseManualInvoiceNotes } from '@/lib/manualInvoice';
import { sendInvoiceEmail } from '@/lib/invoiceEmail';

type EmailDeliveryStatus = 'not_sent' | 'sending' | 'sent' | 'failed';

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function mapInvoiceRowToInvoice(row: any): Invoice {
  const student = row.students as { name: string; ref_id: string | null; email: string | null } | null;
  const branch = row.branches as { name: string } | null;
  const payments = (row.payments as Array<{ method: string; status: string }>) ?? [];
  const items = (row.invoice_items as Array<{ description: string; quantity: number; unit_price: number; line_total: number; gst_percent: number | null }>) ?? [];
  const manualBillTo = parseManualInvoiceNotes(row.notes as string | null | undefined);
  const completedPayment = payments.find((payment) => payment.status === 'completed');
  const taxTotal = (row.tax_total as number) ?? 0;

  return {
    id: row.invoice_number as string,
    dbId: row.id as string,
    studentId: row.student_id as string,
    studentRefId: manualBillTo ? undefined : (student?.ref_id ?? undefined),
    studentName: manualBillTo?.name ?? (student?.name ?? ''),
    studentEmail: manualBillTo?.email ?? (student?.email ?? undefined),
    manualCustomerName: manualBillTo?.name,
    manualCustomerEmail: manualBillTo?.email,
    manualCustomerPhone: manualBillTo?.phone,
    manualCustomerGst: manualBillTo?.gst,
    manualCustomerPan: manualBillTo?.pan,
    amount: row.subtotal as number,
    discountAmount: (row.discount_total as number) ?? 0,
    tax: taxTotal,
    cgstAmount: Math.round(taxTotal / 2 * 100) / 100,
    sgstAmount: Math.round(taxTotal / 2 * 100) / 100,
    total: row.total_amount as number,
    status: (row.status as Invoice['status']) ?? 'unpaid',
    balanceAmount: (row.balance_amount as number) ?? 0,
    paymentMode: (completedPayment?.method ?? 'cash') as Invoice['paymentMode'],
    date: row.invoice_date as string,
    locationId: row.branch_id as string,
    locationName: branch?.name ?? '',
    packageName: items[0]?.description ?? '',
    invoiceItems: items.map((item) => ({
      description: item.description ?? '',
      quantity: Number(item.quantity ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      lineTotal: Number(item.line_total ?? 0),
      gstPercent: item.gst_percent != null ? Number(item.gst_percent) : undefined,
    })),
  };
}

export default function ViewInvoice() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSuperAdminContext = pathname.startsWith('/super-admin');
  const { data: invoices, loading: invoicesLoading } = useInvoices();
  const { data: students } = useStudents();
  const { data: locations } = useLocations();
  const isGeneratedMode = searchParams.get('generated') === '1';
  const shouldAutoSendEmail = searchParams.get('autosend') === '1';
  const invoiceCardRef = React.useRef<HTMLDivElement | null>(null);
  const autoSendAttemptedRef = React.useRef(false);
  
  const academy = useAcademyDetails();
  const [resolvedGeneratedInvoice, setResolvedGeneratedInvoice] = React.useState<Invoice | null>(null);
  const [isResolvingGeneratedInvoice, setIsResolvingGeneratedInvoice] = React.useState(false);
  const invoice = invoices.find((inv) => inv.id === id) ?? resolvedGeneratedInvoice;
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [isCancelledLocally, setIsCancelledLocally] = React.useState(false);
  const [isEditingDate, setIsEditingDate] = React.useState(false);
  const [editDateValue, setEditDateValue] = React.useState('');
  const [isSavingDate, setIsSavingDate] = React.useState(false);
  const [emailDeliveryStatus, setEmailDeliveryStatus] = React.useState<EmailDeliveryStatus>('not_sent');
  const [emailDeliveryMessage, setEmailDeliveryMessage] = React.useState('Not sent yet');

  React.useEffect(() => {
    if (!isGeneratedMode || !id || invoice || !isSupabaseConfigured || !supabase) {
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 12;

    const resolveInvoice = async () => {
      setIsResolvingGeneratedInvoice(true);

      try {
        const { data, error } = await (supabase as any)
          .from('invoices')
          .select('id, invoice_number, student_id, branch_id, invoice_date, status, subtotal, tax_total, discount_total, total_amount, balance_amount, notes, students(name, ref_id, email), branches(name), payments(method, status), invoice_items(description, quantity, unit_price, line_total, gst_percent)')
          .eq('invoice_number', id)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        if (error) {
          throw error;
        }

        if (data) {
          setResolvedGeneratedInvoice(mapInvoiceRowToInvoice(data));
          setIsResolvingGeneratedInvoice(false);
          return;
        }

        attempt += 1;
        if (attempt < maxAttempts) {
          window.setTimeout(resolveInvoice, 750);
        } else {
          setIsResolvingGeneratedInvoice(false);
        }
      } catch {
        if (!cancelled) {
          attempt += 1;
          if (attempt < maxAttempts) {
            window.setTimeout(resolveInvoice, 750);
          } else {
            setIsResolvingGeneratedInvoice(false);
          }
        }
      }
    };

    void resolveInvoice();

    return () => {
      cancelled = true;
    };
  }, [id, invoice, isGeneratedMode]);

  const invoiceStatus = isCancelledLocally ? 'cancelled' : (invoice?.status ?? 'unpaid');
  const isCancelled = invoiceStatus === 'cancelled';
  const billToName = invoice?.manualCustomerName || invoice?.studentName || '';
  const billToEmailForSend = (invoice?.manualCustomerEmail || invoice?.studentEmail || '').trim();
  const emailStatusBadgeClassName =
    emailDeliveryStatus === 'sent'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : emailDeliveryStatus === 'sending'
        ? 'bg-amber-50 text-amber-700 border-amber-100'
        : emailDeliveryStatus === 'failed'
          ? 'bg-red-50 text-red-700 border-red-100'
          : 'bg-slate-100 text-slate-600 border-slate-200';
  const emailStatusLabel =
    emailDeliveryStatus === 'sent'
      ? 'Sent'
      : emailDeliveryStatus === 'sending'
        ? 'Sending'
        : emailDeliveryStatus === 'failed'
          ? 'Failed'
          : 'Not Sent';

  React.useEffect(() => {
    if (!invoice) return;

    const storageKey = `invoice:auto-email:${invoice.id}`;
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) : null;

    if (stored === 'sent') {
      setEmailDeliveryStatus('sent');
      setEmailDeliveryMessage('Email delivered');
      return;
    }

    if (stored === 'sending') {
      setEmailDeliveryStatus('sending');
      setEmailDeliveryMessage('Sending in progress');
      return;
    }

    setEmailDeliveryStatus('not_sent');
    setEmailDeliveryMessage('Not sent yet');
  }, [invoice?.id]);

  React.useEffect(() => {
    if (!shouldAutoSendEmail || !invoice || !invoiceCardRef.current || isCancelled || !billToEmailForSend) {
      return;
    }

    if (autoSendAttemptedRef.current) {
      return;
    }

    const storageKey = `invoice:auto-email:${invoice.id}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(storageKey) === 'sent') {
      autoSendAttemptedRef.current = true;
      return;
    }

    autoSendAttemptedRef.current = true;

    const sendAutomatically = async () => {
      try {
        setEmailDeliveryStatus('sending');
        setEmailDeliveryMessage(`Sending to ${billToEmailForSend}`);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(storageKey, 'sending');
        }

        const fileName = `${invoice.id}.pdf`;
        const pdfBlob = await buildInvoicePdfBlob({
          element: invoiceCardRef.current as HTMLDivElement,
          fileName,
        });

        await sendInvoiceEmail({
          toEmail: billToEmailForSend,
          toName: billToName,
          invoiceNumber: invoice.id,
          invoiceDate: invoice.date,
          totalAmount: invoice.total,
          branchName: invoice.locationName,
          academyName: academy.name || 'Kickstart FC',
          paymentMode: invoice.paymentMode,
          status: invoiceStatus,
          attachmentBlob: pdfBlob,
          attachmentFileName: fileName,
        });

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(storageKey, 'sent');
        }

        setEmailDeliveryStatus('sent');
        setEmailDeliveryMessage(`Delivered to ${billToEmailForSend}`);
        toast.success(`Invoice emailed to ${billToEmailForSend}`);
      } catch (error) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(storageKey);
        }
        setEmailDeliveryStatus('failed');
        setEmailDeliveryMessage(error instanceof Error ? error.message : 'Auto email send failed.');
        const message = error instanceof Error ? error.message : 'Auto email send failed.';
        toast.error(message);
      }
    };

    void sendAutomatically();
  }, [
    shouldAutoSendEmail,
    invoice,
    isCancelled,
    billToEmailForSend,
    billToName,
    academy.name,
    invoiceStatus,
  ]);

  if ((isGeneratedMode && !invoice) || (invoicesLoading && !invoice)) {
    return (
      <div className={isGeneratedMode ? 'flex-1 bg-gray-50 flex items-center justify-center p-8' : '-mx-8 -my-8 flex-1 bg-gray-50 flex items-center justify-center p-8 rounded-2xl overflow-hidden border shadow-sm'}>
        <div className="max-w-sm w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
            <ReceiptText className="h-7 w-7 text-indigo-600 animate-pulse" />
          </div>
          <h2 className="text-2xl font-display font-bold text-slate-900">Preparing invoice</h2>
          <p className="mt-3 text-sm text-slate-500">
            The invoice is being saved and loaded. This view will update automatically once it is ready.
          </p>
          {(isResolvingGeneratedInvoice || invoicesLoading) && (
            <p className="mt-4 text-xs font-medium uppercase tracking-widest text-slate-400">Waiting for the latest invoice data</p>
          )}
        </div>
      </div>
    );
  }
  
  if (!invoice) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center">
          <ReceiptText className="w-10 h-10 text-slate-300" />
        </div>
        <h2 className="text-2xl font-display font-bold text-slate-900">Invoice Not Found</h2>
        <p className="text-slate-500 max-w-sm">
          The invoice with ID <span className="font-bold text-slate-700">{id}</span> could not be located in our records.
        </p>
        <Button onClick={() => navigate(isSuperAdminContext ? '/super-admin/invoices' : '/invoices')} className="bg-indigo-600">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  const student = students.find(s => s.id === invoice.studentId);
  const location = locations.find(l => l.name === invoice.locationName) || locations[0];
  const isManualInvoice = Boolean(invoice.manualCustomerName);
  const billToSecondary = isManualInvoice
    ? (invoice.manualCustomerEmail || null)
    : `Student ID: ${invoice.studentRefId || invoice.studentId}`;
  const billToTertiary = isManualInvoice
    ? (invoice.manualCustomerPhone || null)
    : invoice.locationName;
  const gstPercentDisplay = invoice.invoiceItems?.[0]?.gstPercent ?? (invoice.amount > 0 ? Math.round((invoice.tax / invoice.amount) * 100) : 0);
  const displayItems = (invoice.invoiceItems && invoice.invoiceItems.length > 0)
    ? invoice.invoiceItems
    : [{ description: invoice.packageName || 'Invoice Item', quantity: 1, unitPrice: invoice.amount, lineTotal: invoice.amount }];

  const handleCancelInvoice = async () => {
    if (isCancelled) {
      toast.info('This invoice is already cancelled.');
      return;
    }

    const confirmed = window.confirm(`Cancel invoice ${invoice.id}? This action cannot be undone.`);
    if (!confirmed) return;

    setIsCancelling(true);
    try {
      await cancelInvoice(invoice.id);
      setIsCancelledLocally(true);
      toast.success('Invoice cancelled. It will no longer count in totals or reports.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel invoice.';
      toast.error(message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleStartEditDate = () => {
    setEditDateValue(invoice.date);
    setIsEditingDate(true);
  };

  const handleCancelEditDate = () => {
    setIsEditingDate(false);
  };

  const handleSaveDate = async () => {
    if (!editDateValue) {
      toast.error('Please select a valid date.');
      return;
    }

    setIsSavingDate(true);
    try {
      await updateInvoiceDate(invoice.id, editDateValue);
      toast.success('Invoice date updated.');
      setIsEditingDate(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update invoice date.';
      toast.error(message);
    } finally {
      setIsSavingDate(false);
    }
  };

  const handlePrint = async () => {
    if (!invoice) {
      toast.error('Invoice is not ready for print yet.');
      return;
    }

    try {
      const fileName = `${invoice.id}.pdf`;
      if (!invoiceCardRef.current) {
        toast.error('Invoice is not ready for print yet.');
        return;
      }

      const pdfBlob = await buildInvoicePdfBlob({
        element: invoiceCardRef.current,
        fileName,
      });

      const blobUrl = URL.createObjectURL(pdfBlob);
      const printWindow = window.open(blobUrl, '_blank');

      if (!printWindow) {
        URL.revokeObjectURL(blobUrl);
        toast.error('Pop-up blocked. Please allow pop-ups to print the invoice.');
        return;
      }

      const cleanup = () => {
        URL.revokeObjectURL(blobUrl);
      };

      // Let the browser PDF viewer initialize before invoking print.
      printWindow.addEventListener('load', () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
          cleanup();
        }, 300);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to prepare print document.';
      toast.error(message);
    }
  };

  const handleDownload = async () => {
    if (!invoice) {
      toast.error('Invoice is not ready for download yet.');
      return;
    }

    try {
      const fileName = `${invoice.id}.pdf`;
      if (!invoiceCardRef.current) {
        toast.error('Invoice is not ready for download yet.');
        return;
      }

      const pdfBlob = await buildInvoicePdfBlob({
        element: invoiceCardRef.current,
        fileName,
      });
      downloadPdfBlob(pdfBlob, fileName);
      toast.success('Invoice downloaded as PDF');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate PDF. Please try again.';
      toast.error(message);
    }
  };

  const handleShare = async () => {
    if (!invoice) {
      toast.error('Invoice is not ready to share yet.');
      return;
    }

    if (!billToEmailForSend) {
      setEmailDeliveryStatus('failed');
      setEmailDeliveryMessage('Missing billed-to email');
      toast.error('Billed-to email is missing. Add customer/student email before sending.');
      return;
    }

    try {
      setEmailDeliveryStatus('sending');
      setEmailDeliveryMessage(`Sending to ${billToEmailForSend}`);
      const fileName = `${invoice.id}.pdf`;
      if (!invoiceCardRef.current) {
        toast.error('Invoice is not ready to share yet.');
        return;
      }

      const pdfBlob = await buildInvoicePdfBlob({
        element: invoiceCardRef.current,
        fileName,
      });
      await sendInvoiceEmail({
        toEmail: billToEmailForSend,
        toName: billToName,
        invoiceNumber: invoice.id,
        invoiceDate: invoice.date,
        totalAmount: invoice.total,
        branchName: invoice.locationName,
        academyName: academy.name || 'Kickstart FC',
        paymentMode: invoice.paymentMode,
        status: invoiceStatus,
        attachmentBlob: pdfBlob,
        attachmentFileName: fileName,
      });

      setEmailDeliveryStatus('sent');
      setEmailDeliveryMessage(`Delivered to ${billToEmailForSend}`);
      toast.success(`Invoice emailed to ${billToEmailForSend}`);
    } catch (error) {
      setEmailDeliveryStatus('failed');
      setEmailDeliveryMessage(error instanceof Error ? error.message : 'Unable to send invoice email.');
      const message = error instanceof Error ? error.message : 'Unable to send invoice email.';
      toast.error(message);
    }
  };

  return (
    <div className={isGeneratedMode ? 'flex-1 bg-gray-50 flex flex-col' : '-mx-8 -my-8 flex-1 bg-gray-50 flex flex-col rounded-2xl overflow-hidden border shadow-sm'}>
      {/* Header */}
      {!isGeneratedMode && (
      <div className="bg-white border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Button>
          <div className="h-8 w-[1px] bg-gray-200"></div>
          <div>
            <h1 className="text-xl font-bold font-display text-gray-900 tracking-tight">View Invoice</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{invoice.id} • {formatDateDMY(invoice.date)}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 mr-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Delivery</span>
            <Badge variant="outline" className={`text-[10px] font-bold uppercase ${emailStatusBadgeClassName}`}>
              {emailStatusLabel}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs font-bold uppercase border-red-200 text-red-600 hover:bg-red-50"
            onClick={() => void handleCancelInvoice()}
            disabled={isCancelled || isCancelling}
          >
            <XCircle className="w-3.5 h-3.5" />
            {isCancelled ? 'Cancelled' : isCancelling ? 'Cancelling...' : 'Cancel Invoice'}
          </Button>
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-slate-100 border-slate-200" onClick={handlePrint} disabled={isCancelled}>
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-slate-100 border-slate-200" onClick={handleDownload} disabled={isCancelled}>
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
          <div className="h-6 w-[1px] bg-gray-200 mx-1"></div>
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase border-indigo-100 text-indigo-600 hover:bg-indigo-50" onClick={handleShare} disabled={isCancelled}>
            <Mail className="w-3.5 h-3.5" />
            Email
          </Button>
        </div>
      </div>
      )}

      <div className={isGeneratedMode ? 'invoice-print-root flex-1 bg-gray-100/50 px-[30px] pt-[10px] pb-[10px] overflow-y-auto flex flex-col items-center scrollbar-hide' : 'invoice-print-root flex-1 bg-gray-100/50 px-[30px] pt-[10px] pb-0 overflow-y-auto flex flex-col items-center scrollbar-hide'}>
        <div ref={invoiceCardRef} className="invoice-sheet w-full max-w-[210mm] min-h-[297mm] bg-white shadow-2xl shadow-gray-200 rounded-none overflow-hidden print:shadow-none print:rounded-none">
          {/* Invoice Top Brand Bar */}
          <div className="h-3 bg-[#D4FF00] flex">
            <div className="w-1/3 h-full bg-[#1A3C34]"></div>
            <div className="w-1/3 h-full bg-[#D4FF00]"></div>
            <div className="w-1/3 h-full bg-[#FFD700]"></div>
          </div>
          
          <div className="px-14 py-10 space-y-10">
            {/* Invoice Header */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-xl bg-[#1A3C34] flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-[#1A3C34]/20 shrink-0 border-2 border-[#FFD700] overflow-hidden">
                  {academy.logoUrl ? (
                    <img src={academy.logoUrl} alt="Organization logo" width={64} height={64} crossOrigin="anonymous" className="w-full h-full object-cover" />
                  ) : (
                    academy.logoText || '?'
                  )}
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-xl font-display font-black text-gray-900 uppercase tracking-tight leading-tight">{academy.name}</h2>
                  <p className="text-[#1A3C34] font-bold text-xs leading-none flex items-center gap-1.5 uppercase tracking-wide">
                    <ReceiptText className="w-3.5 h-3.5 text-[#D4FF00]" />
                    {invoice.locationName} Branch
                  </p>
                  <div className="pt-1.5 flex flex-col gap-0.5">
                    <p className="text-[10px] font-bold text-gray-700">{academy.code}</p>
                  </div>
                </div>
              </div>
              
              <div className="text-right space-y-3">
                <h1 className="text-2xl font-display font-bold text-gray-100 uppercase tracking-tight leading-none mb-1">Invoice</h1>
                <div className="space-y-1">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Invoice Number</span>
                    <span className="text-xs font-bold text-[#1A3C34]">{invoice.id}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Date Issued</span>
                    {isEditingDate ? (
                      <div className="flex items-center gap-1.5 mt-1 print:hidden">
                        <Input
                          type="date"
                          value={editDateValue}
                          onChange={(e) => setEditDateValue(e.target.value)}
                          className="h-7 w-[130px] text-xs"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveDate()}
                          disabled={isSavingDate}
                          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                          title="Save date"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEditDate}
                          disabled={isSavingDate}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                        {formatDateDMY(invoice.date)}
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={handleStartEditDate}
                            className="text-gray-300 hover:text-indigo-600 print:hidden"
                            title="Edit invoice date"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Status</span>
                    <span className={invoiceStatus === 'cancelled' ? 'text-xs font-bold text-red-600 uppercase' : 'text-xs font-bold text-emerald-700 uppercase'}>
                      {invoiceStatus === 'cancelled' ? 'Cancelled' : 'Active'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tax Details Grid */}
            <div className="grid grid-cols-4 gap-4 p-6 bg-[#D4FF00]/5 rounded-2xl border border-[#D4FF00]/10">
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-[#1A3C34]/50 uppercase tracking-widest">GST Number</span>
                <span className="text-xs font-bold text-gray-900">{academy.gstNumber || '—'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-[#1A3C34]/50 uppercase tracking-widest">PAN Number</span>
                <span className="text-xs font-bold text-gray-900">{academy.panNumber || '—'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-[#1A3C34]/50 uppercase tracking-widest">Contact</span>
                <span className="text-xs font-bold text-gray-900">{academy.phone || '—'}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] font-bold text-[#1A3C34]/50 uppercase tracking-widest">Email</span>
                <span className="text-xs font-bold text-gray-900">{academy.email || '—'}</span>
              </div>
            </div>

            {/* To Detail & Payment Context */}
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A3C34] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FFD700]" />
                  Bill To
                </h3>
                <div className="p-6 rounded-2xl bg-gray-50/50 border border-gray-100 space-y-1 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-[#D4FF00]/5 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
                  <p className="text-lg font-bold text-gray-900 leading-tight">{billToName}</p>
                  {billToSecondary && <p className="text-sm font-medium text-gray-500">{billToSecondary}</p>}
                  {billToTertiary && <p className="text-sm font-medium text-gray-500">{billToTertiary}</p>}
                  {isManualInvoice && (invoice.manualCustomerGst || invoice.manualCustomerPan) && (
                    <div className="pt-2 space-y-1">
                      {invoice.manualCustomerGst && <p className="text-xs text-gray-500">GST: {invoice.manualCustomerGst}</p>}
                      {invoice.manualCustomerPan && <p className="text-xs text-gray-500">PAN: {invoice.manualCustomerPan}</p>}
                    </div>
                  )}
                  <div className="pt-2">
                    <Badge variant="outline" className={invoiceStatus === 'cancelled' ? 'bg-red-50 text-red-700 border-red-200 text-[10px] font-bold uppercase' : 'bg-[#D4FF00]/10 text-[#1A3C34] border-[#D4FF00]/20 text-[10px] font-bold uppercase'}>
                      {invoiceStatus === 'cancelled' ? 'Invoice Cancelled' : 'Payment Received'}
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#1A3C34] flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FFD700]" />
                  Payment Context
                </h3>
                <div className="p-6 bg-[#D4FF00]/5 rounded-2xl border border-[#D4FF00]/10 space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">Payment Mode</span>
                    <span className="font-bold text-gray-900 uppercase tracking-tight">{invoice.paymentMode}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">Payment Status</span>
                    <Badge
                      className={cn(
                        'font-bold border uppercase text-[10px] tracking-wider px-3',
                        invoiceStatus === 'cancelled'
                          ? 'bg-red-100 text-red-700 border-red-200'
                          : invoiceStatus === 'partial' || invoiceStatus === 'unpaid'
                            ? 'bg-amber-100 text-amber-700 border-amber-200'
                            : 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      )}
                    >
                      {invoiceStatus === 'cancelled' ? 'Cancelled' : invoiceStatus === 'partial' ? 'Partial' : invoiceStatus === 'unpaid' ? 'Unpaid' : 'Paid'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">Tax Status</span>
                    <span className="font-bold text-[#1A3C34]">{gstPercentDisplay}% GST Applied</span>
                  </div>
                </div>
              </div>

              {(academy.upiId || academy.upiQrUrl) && (
                <div className="p-6 bg-[#1A3C34]/5 rounded-2xl border border-[#1A3C34]/10 space-y-4">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-[0.2em] text-[#1A3C34]">Pay via UPI</h4>
                    <p className="text-[10px] font-medium text-gray-500 mt-1">Scan the QR code or use the UPI ID below.</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {academy.upiQrUrl ? (
                      <img
                        src={academy.upiQrUrl}
                        alt="UPI QR code"
                        width={96}
                        height={96}
                        className="h-24 w-24 rounded-2xl border border-gray-200 object-cover bg-white"
                      />
                    ) : (
                      <div className="h-24 w-24 rounded-2xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-[9px] font-bold uppercase tracking-widest text-gray-300 text-center px-2">
                        QR Not Set
                      </div>
                    )}
                    <div className="space-y-2 min-w-0">
                      <p className="text-xs font-bold uppercase tracking-widest text-gray-500">UPI ID</p>
                      <p className="text-sm font-bold text-gray-900 break-all">{academy.upiId || '—'}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="space-y-4">
              <div className="grid grid-cols-12 px-10 py-4 bg-[#1A3C34] rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] text-[#D4FF00]">
                <div className="col-span-8">Description</div>
                <div className="col-span-4 text-right">Amount</div>
              </div>
              
              {displayItems.map((item, index) => (
                <div
                  key={`${item.description}-${index}`}
                  className="px-10 py-5 grid grid-cols-12 text-sm items-center border-b border-gray-50 text-slate-900 font-medium"
                >
                  <div className="col-span-8">
                    <p className="font-bold text-gray-900 text-base tracking-tight">{item.description}</p>
                    <p className="text-xs text-gray-400 mt-2 font-medium">
                      Qty {item.quantity} × ₹{fmt(item.unitPrice)}
                    </p>
                  </div>
                  <div className="col-span-4 text-right font-black text-gray-900 text-base">
                    ₹{fmt(item.quantity * item.unitPrice)}
                  </div>
                </div>
              ))}

              {/* Totals */}
              <div className="flex justify-end pt-3">
                <div className="w-full max-w-[320px] rounded-2xl bg-gray-50 p-6 space-y-3 border border-gray-100">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">Subtotal</span>
                    <span className="font-bold text-gray-900 text-right">₹{fmt(invoice.amount)}</span>
                  </div>
                  {invoice.discountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-emerald-500 font-bold uppercase tracking-widest text-[9px]">Discount</span>
                      <span className="font-bold text-emerald-600 text-right">- ₹{fmt(invoice.discountAmount)}</span>
                    </div>
                  )}
                  {invoice.tax > 0 && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">Taxable Amount</span>
                        <span className="font-bold text-gray-900 text-right">₹{fmt(invoice.total - invoice.tax)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">CGST ({gstPercentDisplay / 2}%)</span>
                        <span className="font-bold text-gray-900 text-right">₹{fmt(invoice.cgstAmount)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">SGST ({gstPercentDisplay / 2}%)</span>
                        <span className="font-bold text-gray-900 text-right">₹{fmt(invoice.sgstAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="pt-6 mt-2 border-t-2 border-dashed border-gray-200 flex justify-between items-end">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-[#D4FF00] uppercase tracking-[0.2em] leading-none">Total Payable</span>
                      <h4 className="text-xl font-display font-bold text-[#1A3C34] leading-none">Grand Total</h4>
                    </div>
                    <span className="text-xl font-display font-bold text-[#1A3C34] tracking-tight">₹{fmt(invoice.total)}</span>
                  </div>
                  {invoice.balanceAmount > 0 && (
                    <div className="flex justify-between text-sm pt-2">
                      <span className="text-rose-500 font-bold uppercase tracking-widest text-[9px]">Balance Due</span>
                      <span className="font-bold text-rose-600 text-right">₹{fmt(invoice.balanceAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer / Notes */}
            <div className="grid grid-cols-2 gap-16 pt-12 mt-12 border-t border-gray-100">
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FFD700] ring-4 ring-[#FFD700]/20" />
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-900">Important Terms</h4>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                      <span className="text-[#D4FF00]">01.</span>
                      This is a computer generated invoice and does not require a physical signature.
                    </p>
                    <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                      <span className="text-[#D4FF00]">02.</span>
                      Batch validity starts from the date of first session.
                    </p>
                    <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                      <span className="text-[#D4FF00]">03.</span>
                      No refunds will be provided for early cancellations.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center space-y-3 text-center">
                 <div className="w-40 h-16 border-2 border-dashed border-[#D4FF00]/20 rounded-2xl flex items-center justify-center relative overflow-hidden bg-white group">
                   <div className="absolute inset-0 bg-[#D4FF00]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                   <div className="text-[9px] font-black text-gray-200 uppercase tracking-[0.3em] rotate-12 select-none border border-gray-100 p-1.5 rounded">
                     STAMP
                   </div>
                   <div className="absolute inset-x-0 bottom-1.5 text-[7px] font-bold text-[#D4FF00] opacity-40 uppercase tracking-widest">
                     Digital Seal
                   </div>
                 </div>
                 <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">Authorized Signatory</p>
              </div>
            </div>
          </div>
          
          {/* Bottom Decoration */}
          <div className="h-12 bg-[#1A3C34] flex items-center justify-between px-14 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-24 h-full bg-[#D4FF00] skew-x-[30deg] translate-x-12 opacity-50" />
             <div className="absolute top-0 right-0 w-12 h-full bg-[#FFD700] skew-x-[30deg] translate-x-3 opacity-30" />
             <p className="text-[8px] font-black text-[#D4FF00] uppercase tracking-[0.25em] z-10">{academy.name}</p>
             <p className="text-[8px] font-black text-white uppercase tracking-[0.4em] z-10">{invoice.locationName} Branch</p>
          </div>
        </div>

        {isGeneratedMode && (
          <div className="mt-4 bg-white border rounded-xl p-4 flex items-center justify-center gap-3 print:hidden">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Email Delivery</span>
              <Badge variant="outline" className={`text-[10px] font-bold uppercase ${emailStatusBadgeClassName}`}>
                {emailStatusLabel}
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-slate-100 border-slate-200" onClick={() => navigate('/')}>
              <House className="w-3.5 h-3.5" />
              Home
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase border-indigo-100 text-indigo-600 hover:bg-indigo-50" onClick={handleShare} disabled={isCancelled}>
              <Mail className="w-3.5 h-3.5" />
              Share Email
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-slate-100 border-slate-200" onClick={handleDownload} disabled={isCancelled}>
              <Download className="w-3.5 h-3.5" />
              Download
            </Button>
            <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-slate-100 border-slate-200" onClick={handlePrint} disabled={isCancelled}>
              <Printer className="w-3.5 h-3.5" />
              Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-xs font-bold uppercase border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => void handleCancelInvoice()}
              disabled={isCancelled || isCancelling}
            >
              <XCircle className="w-3.5 h-3.5" />
              {isCancelled ? 'Cancelled' : isCancelling ? 'Cancelling...' : 'Cancel Invoice'}
            </Button>
          </div>
        )}
        <p className="mt-2 text-center text-xs text-slate-500 print:hidden">{emailDeliveryMessage}</p>
      </div>
    </div>
  );
}
