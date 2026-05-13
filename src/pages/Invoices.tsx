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

export default function Invoices() {
  const { data: invoices = [] } = useInvoices();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = React.useState(searchParams.get('id') || '');

  const filteredInvoices = React.useMemo(() => {
    return invoices.filter(inv => 
      inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.studentName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, invoices]);

  const clearSearch = () => {
    setSearchTerm('');
    setSearchParams({});
  };

  const summaryStats = React.useMemo(() => {
    const totalBilled = invoices.reduce((acc, inv) => acc + inv.total, 0);
    const upiTotal = invoices
      .filter((inv) => inv.paymentMode === 'upi' || inv.paymentMode === 'online')
      .reduce((acc, inv) => acc + inv.total, 0);
    const cashTotal = invoices
      .filter((inv) => inv.paymentMode === 'cash' || inv.paymentMode === 'card')
      .reduce((acc, inv) => acc + inv.total, 0);
    const pendingEstimate = Math.max(0, totalBilled - (upiTotal + cashTotal));

    return [
      { label: 'Total Billed', value: `₹${(totalBilled / 100000).toFixed(2)}L`, color: 'indigo' },
      { label: 'Received (UPI)', value: `₹${(upiTotal / 100000).toFixed(2)}L`, color: 'emerald' },
      { label: 'Received (Cash/Card)', value: `₹${(cashTotal / 100000).toFixed(2)}L`, color: 'amber' },
      { label: 'Pending Payment', value: `₹${(pendingEstimate / 100000).toFixed(2)}L`, color: 'red' },
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
          <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export Data
          </Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={() => navigate('/invoices/create')}>
            <Plus className="w-4 h-4" />
            Create Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryStats.map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                <p className="text-xl font-display font-bold text-slate-900">{stat.value}</p>
              </div>
              <div className={`p-2 bg-${stat.color}-50 text-${stat.color}-600 rounded-lg`}>
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
            {filteredInvoices.map((inv) => (
              <TableRow 
                key={inv.id} 
                className="cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => navigate(`/invoices/view/${inv.id}`)}
              >
                <TableCell className="font-bold text-slate-900">{inv.id}</TableCell>
                <TableCell>{inv.date}</TableCell>
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
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100">Paid</Badge>
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
      </div>
    </div>
  );
}
