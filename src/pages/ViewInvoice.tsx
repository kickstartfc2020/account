import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Printer, 
  Download, 
  Mail, 
  ReceiptText,
  XCircle
} from 'lucide-react';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';
import { useInvoices, useStudents, useLocations } from '@/hooks/useData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { buildInvoicePdfBlob, downloadPdfBlob, sharePdfByEmail } from '@/lib/invoiceExport';
import { cancelInvoice } from '@/lib/invoiceMutations';
import { formatDateDMY } from '@/lib/utils';

export default function ViewInvoice() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: invoices } = useInvoices();
  const { data: students } = useStudents();
  const { data: locations } = useLocations();
  const isGeneratedMode = searchParams.get('generated') === '1';
  const invoiceCardRef = React.useRef<HTMLDivElement | null>(null);
  
  const academy = useAcademyDetails();
  const invoice = invoices.find(inv => inv.id === id);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [isCancelledLocally, setIsCancelledLocally] = React.useState(false);
  
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
        <Button onClick={() => navigate('/invoices')} className="bg-indigo-600">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  const student = students.find(s => s.id === invoice.studentId);
  const location = locations.find(l => l.name === invoice.locationName) || locations[0];
  const invoiceStatus = isCancelledLocally ? 'cancelled' : invoice.status;
  const isCancelled = invoiceStatus === 'cancelled';

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

  const handleShare = async (method: 'email') => {
    if (!invoice) {
      toast.error('Invoice is not ready to share yet.');
      return;
    }

    try {
      const fileName = `${invoice.id}.pdf`;
      if (!invoiceCardRef.current) {
        toast.error('Invoice is not ready to share yet.');
        return;
      }

      const pdfBlob = await buildInvoicePdfBlob({
        element: invoiceCardRef.current,
        fileName,
      });
      await sharePdfByEmail(
        pdfBlob,
        fileName,
        `Invoice ${invoice.id}`,
        `Please find attached invoice ${invoice.id} for ${invoice.studentName}.`
      );

      toast.success(`Invoice shared via ${method}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open email share flow.';
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
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase border-indigo-100 text-indigo-600 hover:bg-indigo-50" onClick={() => handleShare('email')} disabled={isCancelled}>
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
                    <img src={academy.logoUrl} alt="Organization logo" crossOrigin="anonymous" className="w-full h-full object-cover" />
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
                    <span className="text-xs font-bold text-gray-900">{formatDateDMY(invoice.date)}</span>
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
                  <p className="text-lg font-bold text-gray-900 leading-tight">{invoice.studentName}</p>
                  <p className="text-sm font-medium text-gray-500">Student ID: {invoice.studentRefId || invoice.studentId}</p>
                  <p className="text-sm font-medium text-gray-500">{invoice.locationName}</p>
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
                    <Badge className={invoiceStatus === 'cancelled' ? 'font-bold border uppercase text-[10px] tracking-wider px-3 bg-red-100 text-red-700 border-red-200' : 'font-bold border uppercase text-[10px] tracking-wider px-3 bg-emerald-100 text-emerald-700 border-emerald-200'}>
                      {invoiceStatus === 'cancelled' ? 'Cancelled' : 'Paid'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">Tax Status</span>
                    <span className="font-bold text-[#1A3C34]">{Math.round((invoice.tax / invoice.amount) * 100)}% GST Applied</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-4">
              <div className="grid grid-cols-12 px-10 py-4 bg-[#1A3C34] rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] text-[#D4FF00]">
                <div className="col-span-8">Description</div>
                <div className="col-span-4 text-right">Amount</div>
              </div>
              
              <div className="px-10 py-5 grid grid-cols-12 text-sm items-center border-b border-gray-50 text-slate-900 font-medium">
                <div className="col-span-8">
                  <p className="font-bold text-gray-900 text-base tracking-tight">{invoice.packageName}</p>
                  <p className="text-xs text-gray-400 mt-2 font-medium">Monthly Training • 1 Month Access</p>
                </div>
                <div className="col-span-4 text-right font-black text-gray-900 text-base">
                  ₹{invoice.amount.toLocaleString()}
                </div>
              </div>

              {/* Totals */}
              <div className="flex justify-end pt-3">
                <div className="w-full max-w-[320px] rounded-2xl bg-gray-50 p-6 space-y-3 border border-gray-100">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">Subtotal</span>
                    <span className="font-bold text-gray-900 text-right">₹{invoice.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <div className="flex flex-col">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">GST ({Math.round((invoice.tax / invoice.amount) * 100)}%)</span>
                      <span className="text-[8px] text-gray-400 font-medium">Central & State Tax</span>
                    </div>
                    <span className="font-bold text-gray-900 text-right">₹{invoice.tax.toLocaleString()}</span>
                  </div>
                  <div className="pt-6 mt-2 border-t-2 border-dashed border-gray-200 flex justify-between items-end">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-[#D4FF00] uppercase tracking-[0.2em] leading-none">Total Payable</span>
                      <h4 className="text-xl font-display font-bold text-[#1A3C34] leading-none">Grand Total</h4>
                    </div>
                    <span className="text-xl font-display font-bold text-[#1A3C34] tracking-tight">₹{invoice.total.toLocaleString()}</span>
                  </div>
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
                      Package validity starts from the date of first session.
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
            <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase border-indigo-100 text-indigo-600 hover:bg-indigo-50" onClick={() => handleShare('email')} disabled={isCancelled}>
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
      </div>
    </div>
  );
}
