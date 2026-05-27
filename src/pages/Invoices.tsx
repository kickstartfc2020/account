import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Receipt, 
  Search, 
  Filter, 
  Download, 
  Printer, 
  Eye, 
  ArrowUpRight,
  X,
  Plus
} from 'lucide-react';
import { useInvoices } from '@/hooks/useData';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
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
import { Separator } from '@/components/ui/separator';
import { formatDateDMY } from '@/lib/utils';
import { toast } from 'sonner';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';
import { downloadInvoicesExcelBackup } from '@/lib/invoiceReset';
import { useSports } from '@/hooks/useData';

export default function Invoices() {
  const pageSize = 10;
    const statToneClass: Record<string, string> = {
      indigo: 'bg-indigo-50 text-indigo-600',
      emerald: 'bg-emerald-50 text-emerald-600',
      amber: 'bg-amber-50 text-amber-600',
      red: 'bg-red-50 text-red-600',
    };

  const { data: invoices = [] } = useInvoices();
  const { data: sports = [], loading: sportsLoading } = useSports();
  const academy = useAcademyDetails();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = React.useState(searchParams.get('id') || '');
  const [invoicePage, setInvoicePage] = React.useState(1);
  const [isExportDialogOpen, setIsExportDialogOpen] = React.useState(false);
  const [isSportDialogOpen, setIsSportDialogOpen] = React.useState(false);
  const [exportStartDate, setExportStartDate] = React.useState('');
  const [exportEndDate, setExportEndDate] = React.useState('');

  const handleCreateInvoiceClick = () => {
    if (sportsLoading) return;
    setIsSportDialogOpen(true);
  };

  const selectSport = (sportId: string) => {
    setIsSportDialogOpen(false);
    navigate(`/invoices/create?sportId=${sportId}`);
  };

  const selectManualInvoice = () => {
    setIsSportDialogOpen(false);
    navigate('/invoices/create?mode=manual');
  };

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
    return invoices.filter(inv => 
      inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.studentName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, invoices]);

  React.useEffect(() => {
    setInvoicePage(1);
  }, [searchTerm]);

  const invoicesTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));

  React.useEffect(() => {
    setInvoicePage((current) => Math.min(current, invoicesTotalPages));
  }, [invoicesTotalPages]);

  const paginatedInvoices = React.useMemo(() => {
    const startIndex = (invoicePage - 1) * pageSize;
    return filteredInvoices.slice(startIndex, startIndex + pageSize);
  }, [filteredInvoices, invoicePage]);

  const clearSearch = () => {
    setSearchTerm('');
    setSearchParams({});
  };

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

    downloadInvoicesExcelBackup(rowsInRange, academy.name || 'Invoices');
    toast.success(`Exported ${rowsInRange.length} invoices to Excel.`);
    setIsExportDialogOpen(false);
  };

  const summaryStats = React.useMemo(() => {
    const activeInvoices = invoices.filter((inv) => inv.status !== 'cancelled');
    const totalBilled = activeInvoices.reduce((acc, inv) => acc + inv.total, 0);
    const upiTotal = activeInvoices
      .filter((inv) => inv.paymentMode === 'upi' || inv.paymentMode === 'online')
      .reduce((acc, inv) => acc + inv.total, 0);
    const cashTotal = activeInvoices
      .filter((inv) => inv.paymentMode === 'cash' || inv.paymentMode === 'card')
      .reduce((acc, inv) => acc + inv.total, 0);
    const pendingEstimate = activeInvoices.reduce((acc, inv) => acc + Math.max(0, inv.balanceAmount ?? 0), 0);

    return [
      { label: 'Total Billed', value: `₹${Math.round(totalBilled).toLocaleString('en-IN')}`, color: 'indigo' },
      { label: 'Received (UPI)', value: `₹${Math.round(upiTotal).toLocaleString('en-IN')}`, color: 'emerald' },
      { label: 'Received (Cash/Card)', value: `₹${Math.round(cashTotal).toLocaleString('en-IN')}`, color: 'amber' },
      { label: 'Pending Payment', value: `₹${Math.round(pendingEstimate).toLocaleString('en-IN')}`, color: 'red' },
    ];
  }, [invoices]);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Invoices</h1>
          <p className="text-slate-500">Track all financial transactions and membership billings.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2" onClick={openExportDialog}>
            <Download className="w-4 h-4" />
            Export Data
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={handleCreateInvoiceClick} disabled={sportsLoading}>
            <Plus className="w-4 h-4" />
            {sportsLoading ? 'Loading...' : 'Create Invoice'}
          </Button>
        </div>
      </div>

      <Dialog open={isSportDialogOpen} onOpenChange={setIsSportDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Select Sport</DialogTitle>
            <DialogDescription>
              Choose a sport or continue with manual invoice creation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {sports.map((sport) => (
              <Button
                key={sport.id}
                variant="outline"
                className="h-12 justify-between px-4"
                onClick={() => selectSport(sport.id)}
              >
                <span className="font-bold text-gray-700">{sport.name}</span>
              </Button>
            ))}
            {sports.length === 0 && (
              <p className="text-sm text-slate-500 py-1">No sports configured. You can still create a manual invoice.</p>
            )}
            <Separator className="my-1" />
            <Button
              variant="secondary"
              className="h-12 justify-between px-4"
              onClick={selectManualInvoice}
            >
              <span className="font-bold">Manual Invoice</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Invoices</DialogTitle>
            <DialogDescription>
              Select a date range to export invoice data to an Excel file.
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
            <Button onClick={handleExportData}>
              Export Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryStats.map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                <p className="text-xl font-display font-bold text-slate-900">{stat.value}</p>
              </div>
              <div className={`p-2 rounded-lg ${statToneClass[stat.color] ?? statToneClass.indigo}`}>
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50/50 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              className="pl-10 bg-white" 
              placeholder="Search by ID or student name..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button 
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" />
              Filter
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Student Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedInvoices.map((inv) => (
              <TableRow 
                key={inv.id} 
                className="cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => navigate(`/invoices/view/${inv.id}`)}
              >
                <TableCell className="font-bold text-slate-900">{inv.id}</TableCell>
                <TableCell>{formatDateDMY(inv.date)}</TableCell>
                <TableCell className="font-medium text-indigo-700">{inv.studentName}</TableCell>
                <TableCell className="text-slate-500 text-sm">{inv.locationName}</TableCell>
                <TableCell>
                  <span className="text-xs font-semibold px-2 py-1 bg-slate-100 rounded text-slate-600">RENEWAL</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-900">₹{inv.total.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400 uppercase font-bold">{inv.paymentMode}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={inv.status === 'cancelled' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}
                  >
                    {inv.status === 'cancelled' ? 'Cancelled' : 'Paid'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                      onClick={() => navigate(`/invoices/view/${inv.id}`)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                      onClick={() => navigate(`/invoices/view/${inv.id}`)}
                    >
                      <Printer className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3 border-t bg-slate-50/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-slate-500">
            Showing {filteredInvoices.length === 0 ? 0 : (invoicePage - 1) * pageSize + 1}-{Math.min(invoicePage * pageSize, filteredInvoices.length)} of {filteredInvoices.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInvoicePage((page) => Math.max(1, page - 1))}
              disabled={invoicePage === 1}
            >
              Previous
            </Button>
            <span className="text-xs font-semibold text-slate-500">
              Page {invoicePage} of {invoicesTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInvoicePage((page) => Math.min(invoicesTotalPages, page + 1))}
              disabled={invoicePage === invoicesTotalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
