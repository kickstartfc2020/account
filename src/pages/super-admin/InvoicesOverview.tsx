import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Download, Eye, Receipt, Search } from 'lucide-react';
import { useInvoices } from '@/hooks/useData';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';
import { downloadInvoicesExcelBackup } from '@/lib/invoiceReset';
import { formatDateDMY } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 20;

export default function InvoicesOverview() {
  const navigate = useNavigate();
  const academy = useAcademyDetails();
  const { data: invoices = [] } = useInvoices();

  const [searchTerm, setSearchTerm] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState(false);
  const [exportStartDate, setExportStartDate] = React.useState('');
  const [exportEndDate, setExportEndDate] = React.useState('');

  const toDateKey = React.useCallback((value: string) => {
    const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatch) return directMatch[1];

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const invoiceDateRange = React.useMemo(() => {
    const keys = invoices
      .map((invoice) => toDateKey(invoice.date))
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      min: keys[0] ?? '',
      max: keys[keys.length - 1] ?? '',
    };
  }, [invoices, toDateKey]);

  const filteredInvoices = React.useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return invoices;

    return invoices.filter((invoice) => {
      return (
        invoice.id.toLowerCase().includes(needle) ||
        invoice.studentName.toLowerCase().includes(needle) ||
        invoice.locationName.toLowerCase().includes(needle)
      );
    });
  }, [invoices, searchTerm]);

  React.useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));

  React.useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedInvoices = React.useMemo(() => {
    const startIndex = (page - 1) * PAGE_SIZE;
    return filteredInvoices.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredInvoices, page]);

  const openExportDialog = () => {
    setExportStartDate(invoiceDateRange.min);
    setExportEndDate(invoiceDateRange.max);
    setIsExportDialogOpen(true);
  };

  const handleExportData = () => {
    if (!exportStartDate || !exportEndDate) {
      toast.error('Please select both start date and end date.');
      return;
    }

    if (exportStartDate > exportEndDate) {
      toast.error('Start date cannot be after end date.');
      return;
    }

    const rowsInRange = invoices.filter((invoice) => {
      const invoiceDateKey = toDateKey(invoice.date);
      return Boolean(invoiceDateKey) && invoiceDateKey >= exportStartDate && invoiceDateKey <= exportEndDate;
    });

    if (rowsInRange.length === 0) {
      toast.error('No invoices found in the selected date range.');
      return;
    }

    downloadInvoicesExcelBackup(rowsInRange, academy.name || 'All-Invoices');
    toast.success(`Exported ${rowsInRange.length} invoices to Excel.`);
    setIsExportDialogOpen(false);
  };

  const summaryCards = React.useMemo(() => {
    const activeInvoices = invoices.filter((invoice) => invoice.status !== 'cancelled');
    const totalAmount = activeInvoices.reduce((acc, invoice) => acc + invoice.total, 0);
    const dueAmount = activeInvoices.reduce((acc, invoice) => acc + Math.max(0, invoice.balanceAmount || 0), 0);
    const branches = new Set(activeInvoices.map((invoice) => invoice.locationId).filter(Boolean));

    return [
      { label: 'Total Invoices', value: activeInvoices.length.toLocaleString('en-IN') },
      { label: 'Total Billed', value: `₹${Math.round(totalAmount).toLocaleString('en-IN')}` },
      { label: 'Pending Amount', value: `₹${Math.round(dueAmount).toLocaleString('en-IN')}` },
      { label: 'Active Branches', value: branches.size.toLocaleString('en-IN') },
    ];
  }, [invoices]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Invoices</h1>
          <p className="text-gray-500 mt-1">See all invoices across branches in one place.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={openExportDialog}>
          <Download className="w-4 h-4" />
          Download Excel
        </Button>
      </div>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export All Invoices</DialogTitle>
            <DialogDescription>
              Select a date range to download invoice data for all branches.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Start Date</label>
              <Input
                type="date"
                value={exportStartDate}
                min={invoiceDateRange.min || undefined}
                max={invoiceDateRange.max || undefined}
                onChange={(e) => setExportStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">End Date</label>
              <Input
                type="date"
                value={exportEndDate}
                min={invoiceDateRange.min || undefined}
                max={invoiceDateRange.max || undefined}
                onChange={(e) => setExportEndDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExportData}>Export Excel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="glass-card">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{card.label}</p>
                <p className="text-xl font-display font-bold text-slate-900">{card.value}</p>
              </div>
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by invoice, student, or branch..."
              className="pl-10 bg-white"
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-sm text-slate-500">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              paginatedInvoices.map((invoice) => (
                <TableRow key={invoice.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/invoices/view/${invoice.id}`)}>
                  <TableCell className="font-bold text-slate-900">{invoice.id}</TableCell>
                  <TableCell>{formatDateDMY(invoice.date)}</TableCell>
                  <TableCell className="font-medium text-indigo-700">{invoice.studentName}</TableCell>
                  <TableCell>{invoice.locationName || '-'}</TableCell>
                  <TableCell className="font-semibold">₹{Math.round(invoice.total).toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        invoice.status === 'cancelled'
                          ? 'bg-red-50 text-red-700 border-red-100'
                          : invoice.status === 'partial'
                            ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      }
                    >
                      {invoice.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(`/invoices/view/${invoice.id}`);
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="p-4 border-t bg-slate-50/50 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {paginatedInvoices.length} of {filteredInvoices.length} invoice records
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              Previous
            </Button>
            <span className="text-xs font-medium text-slate-600">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Card className="bg-indigo-600 text-white border-none shadow-xl shadow-indigo-100">
        <CardContent className="p-5 flex items-start gap-3">
          <Receipt className="w-5 h-5 text-indigo-100 mt-0.5" />
          <div>
            <p className="text-sm font-bold">Super Admin Invoice Visibility</p>
            <p className="text-xs text-indigo-100 mt-1">
              This view combines invoices from all branches and lets you download them in Excel format anytime.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
