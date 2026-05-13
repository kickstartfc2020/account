import React from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { 
  Search, 
  Clock, 
  Calendar, 
  Zap, 
  CheckCircle2, 
  Printer, 
  Download,
  Receipt,
  CalendarDays
} from 'lucide-react';
import { useRenewals, usePackages, useStudents } from '@/hooks/useData';
import { format, addMonths, isSameDay, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DateRange } from "react-day-picker";
import { StudentDetailSheet } from '@/components/StudentDetailSheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { completeRenewal } from '@/lib/renewalWrite';
import { computeBillingTotals } from '@/lib/billingMath';

export default function Renewals() {
  const { data: renewalsData } = useRenewals();
  const { data: packagesData } = usePackages();
  const { data: studentsData } = useStudents();

  const [selectedRenewal, setSelectedRenewal] = React.useState<any>(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = React.useState(false);
  const [selectedPackageId, setSelectedPackageId] = React.useState('');
  const [paymentMode, setPaymentMode] = React.useState<'upi' | 'cash' | 'card' | 'online'>('upi');
  const [renewalStartDate, setRenewalStartDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [generatedInvoiceNumber, setGeneratedInvoiceNumber] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [sportFilter, setSportFilter] = React.useState('all');
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [currentPage, setCurrentPage] = React.useState(1);
  const itemsPerPage = 5;

  const handleRenew = (renewal: any) => {
    setSelectedRenewal(renewal);
    const initialPackage = packagesData.find((pkg) => pkg.name === renewal.currentPackageName) ?? packagesData[0];
    setSelectedPackageId(initialPackage?.id ?? '');
    setPaymentMode('upi');
    setRenewalStartDate(format(new Date(), 'yyyy-MM-dd'));
  };

  const selectedPackage = packagesData.find((pkg) => pkg.id === selectedPackageId) ?? null;
  const selectedStudent = selectedRenewal ? studentsData.find((student) => student.id === selectedRenewal.studentId) : null;
  const selectedPackageAmount = selectedPackage?.price ?? 0;
  const selectedGstPercent = selectedPackage?.taxPercent ?? 18;
  const selectedBilling = computeBillingTotals(selectedPackageAmount, selectedGstPercent);

  const confirmRenewal = async () => {
    if (!selectedRenewal || !selectedStudent || !selectedPackage) {
      toast.error('Select a package before confirming renewal.');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await completeRenewal({
        renewalId: selectedRenewal.id,
        studentId: selectedStudent.id,
        packageId: selectedPackage.id,
        sportId: selectedPackage.sportId,
        packageName: selectedPackage.name,
        sportName: selectedPackage.sportName,
        amount: selectedPackage.price,
        gstPercent: selectedPackage.taxPercent,
        paymentMethod: paymentMode,
        paymentModeLabel: paymentMode,
        startDate: renewalStartDate,
        preferredBranchId: selectedStudent.locationId,
      });

      setGeneratedInvoiceNumber(result.invoiceNumber);
      toast.success(`Membership for ${selectedRenewal.studentName} renewed successfully!`);
      setIsInvoiceOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete renewal.';
      console.error(error);
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Filtered data
  const filteredRenewals = renewalsData.filter(renewal => {
    const matchesSearch = 
      renewal.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      renewal.sportName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      renewal.currentPackageName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || renewal.status === statusFilter;
    const matchesSport = sportFilter === 'all' || renewal.sportName === sportFilter;
    
    let matchesDate = true;
    if (dateRange?.from) {
      const expiryDate = parseISO(renewal.expiryDate);
      if (dateRange.to) {
        matchesDate = isWithinInterval(expiryDate, { 
          start: startOfDay(dateRange.from), 
          end: endOfDay(dateRange.to) 
        });
      } else {
        matchesDate = isSameDay(expiryDate, dateRange.from);
      }
    }

    return matchesSearch && matchesStatus && matchesSport && matchesDate;
  });

  const uniqueSports = Array.from(new Set(renewalsData.map(r => r.sportName)));

  // Pagination logic
  const totalPages = Math.ceil(filteredRenewals.length / itemsPerPage);
  const paginatedRenewals = filteredRenewals.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 on search or filter change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sportFilter, dateRange]);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Renewals</h1>
          <p className="text-slate-500">Quickly process expiring and expired memberships.</p>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card shadow-amber-100 shadow-lg border-amber-200">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-amber-100 text-amber-600 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-600">Expiring in 7 Days</p>
              <p className="text-2xl font-bold text-slate-900">8 Students</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card shadow-red-100 shadow-lg border-red-200">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-red-100 text-red-600 rounded-xl">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-red-600">Expired Students</p>
              <p className="text-2xl font-bold text-slate-900">4 Students</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card shadow-emerald-100 shadow-lg border-emerald-200">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-600">Renewed Today</p>
              <p className="text-2xl font-bold text-slate-900">5 Renewals</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consolidated Search & Filters Bar */}
      <div className="bg-white p-2 rounded-2xl border shadow-sm flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Search students, sports or packages..." 
            className="pl-10 h-10 bg-slate-50/50 border-transparent focus:bg-white focus:border-indigo-500 transition-all shadow-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block" />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-10 bg-slate-50/50 border-transparent hover:bg-slate-100 transition-colors shadow-none text-xs font-semibold">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="expiring">Expiring</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sportFilter} onValueChange={setSportFilter}>
            <SelectTrigger className="w-[130px] h-10 bg-slate-50/50 border-transparent hover:bg-slate-100 transition-colors shadow-none text-xs font-semibold">
              <SelectValue placeholder="Sport" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              {uniqueSports.map(sport => (
                <SelectItem key={sport} value={sport} className="text-xs">{sport}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"ghost"}
                className={cn(
                  "h-10 px-3 justify-start text-xs font-semibold bg-slate-50/50 hover:bg-slate-100 transition-colors",
                  !dateRange && "text-slate-500"
                )}
              >
                <CalendarDays className="mr-2 h-4 w-4 text-slate-400" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM dd")} - {format(dateRange.to, "MMM dd, yyyy")}
                    </>
                  ) : (
                    format(dateRange.from, "MMM dd, yyyy")
                  )
                ) : (
                  <span>Expiry Date Range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <CalendarComponent
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

          {(statusFilter !== 'all' || sportFilter !== 'all' || searchQuery !== '' || dateRange) && (
            <>
              <div className="h-6 w-px bg-slate-200 mx-1" />
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setStatusFilter('all');
                  setSportFilter('all');
                  setSearchQuery('');
                  setDateRange(undefined);
                }}
                className="h-10 text-xs font-bold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
              >
                Reset Filters
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Renewals Table */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Sport</TableHead>
              <TableHead>Current Package</TableHead>
              <TableHead>Expiry Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRenewals.map((renewal) => {
              const student = studentsData.find(s => s.id === renewal.studentId);
              return (
                <TableRow key={renewal.id}>
                  <TableCell>
                    {student ? (
                      <StudentDetailSheet student={student}>
                        <div className="flex items-center gap-3 cursor-pointer group">
                          <Avatar className="h-8 w-8 border">
                            <AvatarFallback className="bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                              {student.name.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <span className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                              {renewal.studentName}
                            </span>
                            {renewal.refId && (
                              <p className="text-[10px] font-mono text-slate-400">{renewal.refId}</p>
                            )}
                          </div>
                        </div>
                      </StudentDetailSheet>
                    ) : (
                      <div>
                        <span className="font-semibold">{renewal.studentName}</span>
                        {renewal.refId && (
                          <p className="text-[10px] font-mono text-slate-400">{renewal.refId}</p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{renewal.sportName}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-slate-50">{renewal.currentPackageName}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{renewal.expiryDate}</span>
                    <span className={`text-[10px] font-bold uppercase ${renewal.daysLeft < 0 ? 'text-red-500' : 'text-amber-600'}`}>
                      {renewal.daysLeft < 0 ? `${Math.abs(renewal.daysLeft)} days ago` : `${renewal.daysLeft} days left`}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className={
                    renewal.renewalStatus === 'overdue' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                  } variant="outline">
                    {(renewal.renewalStatus ?? 'pending').charAt(0).toUpperCase() + (renewal.renewalStatus ?? 'pending').slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button 
                        onClick={() => handleRenew(renewal)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-xs h-8"
                      >
                        Renew
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle className="font-display font-bold text-xl">Process Renewal</DialogTitle>
                      </DialogHeader>
                      <div className="py-6 space-y-4">
                        <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2">
                          <p className="text-xs font-bold text-indigo-600 uppercase">Confirming for:</p>
                          <p className="font-bold text-lg">{renewal.studentName}</p>
                          <p className="text-sm text-slate-500">{renewal.sportName} • {renewal.currentPackageName}</p>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-500 uppercase">Select New Package</label>
                            <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select package" />
                              </SelectTrigger>
                              <SelectContent>
                                {packagesData.map(pkg => (
                                  <SelectItem key={pkg.id} value={pkg.id}>
                                    {pkg.name} - ₹{pkg.price}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-500 uppercase">Start Date</label>
                              <Input type="date" value={renewalStartDate} onChange={(e) => setRenewalStartDate(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-500 uppercase">Payment Mode</label>
                              <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as 'upi' | 'cash' | 'card' | 'online')}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Mode" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="upi">UPI / GPay</SelectItem>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="card">Card</SelectItem>
                                  <SelectItem value="online">Online Transfer</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Package Amount</span>
                            <span className="font-semibold">₹{selectedBilling.subtotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">GST ({selectedGstPercent}%)</span>
                            <span className="font-semibold">₹{selectedBilling.taxTotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-lg font-bold">
                            <span>Total Payable</span>
                            <span className="text-indigo-600">₹{selectedBilling.totalAmount.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" className="flex-1">Cancel</Button>
                        <Button onClick={() => void confirmRenewal()} className="flex-1 bg-indigo-600 hover:bg-indigo-700" disabled={isProcessing}>
                          {isProcessing ? 'Processing...' : 'Confirm & Invoice'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            );
          })}
            {paginatedRenewals.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-slate-500 font-medium italic">
                  No matching renewals found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <p className="text-sm text-slate-500 font-medium">
            Showing <span className="font-bold text-slate-900">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-bold text-slate-900">{Math.min(currentPage * itemsPerPage, filteredRenewals.length)}</span> of <span className="font-bold text-slate-900">{filteredRenewals.length}</span> results
          </p>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="h-9 px-4 font-bold border-slate-200"
            >
              Previous
            </Button>
            <div className="flex gap-1">
              {[...Array(totalPages)].map((_, i) => (
                <Button
                  key={i}
                  variant={currentPage === i + 1 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(i + 1)}
                  className={`w-9 h-9 font-bold ${currentPage === i + 1 ? 'bg-indigo-600' : 'border-slate-200'}`}
                >
                  {i + 1}
                </Button>
              ))}
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="h-9 px-4 font-bold border-slate-200"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Invoice Preview Modal */}
      <Dialog open={isInvoiceOpen} onOpenChange={setIsInvoiceOpen}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-2xl">
          <div className="p-8 space-y-8 bg-white">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-2xl">
                  K
                </div>
                <h2 className="text-xl font-display font-bold">Kickstart Sports Academy</h2>
                <p className="text-xs text-slate-500 max-w-[200px]">123 Sport Street, Main Campus, Mysore - 570001</p>
              </div>
              <div className="text-right space-y-1">
                <h1 className="text-4xl font-display font-black text-slate-100 uppercase tracking-widest">Invoice</h1>
                <p className="text-sm font-semibold text-slate-900">#{generatedInvoiceNumber || '---'}</p>
                <p className="text-xs text-slate-500">Date: {format(new Date(), 'MMM dd, yyyy')}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12 py-8 border-y border-slate-100">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bill To</p>
                <p className="text-lg font-bold text-slate-900">{selectedRenewal?.studentName}</p>
                <p className="text-sm text-slate-500">{selectedPackage?.name || 'Membership Renewal'}</p>
              </div>
              <div className="space-y-2 text-right">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Payment Status</p>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">PAID VIA UPI</Badge>
              </div>
            </div>

            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-bold text-slate-900">Description</TableHead>
                  <TableHead className="text-right font-bold text-slate-900">Duration</TableHead>
                  <TableHead className="text-right font-bold text-slate-900">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium font-bold">{selectedPackage?.name || 'Selected Package'}</TableCell>
                  <TableCell className="text-right">{selectedPackage?.durationMonths || 1} Month{(selectedPackage?.durationMonths || 1) > 1 ? 's' : ''}</TableCell>
                  <TableCell className="text-right">₹{selectedBilling.subtotal.toFixed(2)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="flex justify-end pt-4">
              <div className="w-56 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 font-medium">Subtotal</span>
                  <span className="font-bold">₹{selectedBilling.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 font-medium">Tax (GST {selectedGstPercent}%)</span>
                  <span className="font-bold">₹{selectedBilling.taxTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xl font-bold pt-3 border-t">
                  <span>Total</span>
                  <span className="text-indigo-600">₹{selectedBilling.totalAmount.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="pt-8 border-t">
              <p className="text-xs text-slate-400 text-center">Thank you for choosing Kickstart! This is a computer-generated invoice.</p>
            </div>
          </div>
          
          <div className="bg-slate-50 p-4 flex gap-3 justify-end items-center px-8 border-t">
            <Button variant="ghost" size="sm" className="gap-2">
              <Download className="w-4 h-4" />
              Download PDF
            </Button>
            <Button variant="ghost" size="sm" className="gap-2">
              <Printer className="w-4 h-4" />
              Print
            </Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
              <Receipt className="w-4 h-4" />
              Share WhatsApp
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
