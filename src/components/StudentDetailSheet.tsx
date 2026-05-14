import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Phone, 
  Mail,
  History,
  CreditCard,
  Calendar,
  ChevronLeft,
  ArrowRight
} from 'lucide-react';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Student } from '@/types';
import { useInvoices, usePackages } from '@/hooks/useData';
import { addMonths, parseISO } from 'date-fns';
import { formatDateDMY } from '@/lib/utils';

interface StudentDetailSheetProps {
  student: Student;
  children: React.ReactNode;
}

export function StudentDetailSheet({ student, children }: StudentDetailSheetProps) {
  const navigate = useNavigate();
  const [view, setView] = React.useState<'details' | 'history'>('details');
  const { data: allInvoices } = useInvoices();
  const { data: allPackages } = usePackages();
  
  const studentInvoices = React.useMemo(() => {
    return allInvoices.filter(inv => inv.studentId === student.id);
  }, [student.id, allInvoices]);

  const activeStudentInvoices = React.useMemo(() => {
    return studentInvoices.filter((inv) => inv.status !== 'cancelled');
  }, [studentInvoices]);

  const totalPaid = React.useMemo(() => {
    return activeStudentInvoices.reduce((sum, inv) => sum + inv.total, 0);
  }, [activeStudentInvoices]);

  const pkg = allPackages.find(p => p.id === student.packageId);
  const packageBadgeText = pkg
    ? `${pkg.name} • ₹${Math.round(pkg.price).toLocaleString('en-IN')}`
    : student.packageName;

  const computedStartDate = React.useMemo(() => {
    try {
      if (!student.joinedAt) return 'N/A';
      return formatDateDMY(parseISO(student.joinedAt), 'N/A');
    } catch {
      return formatDateDMY(student.joinedAt, 'N/A');
    }
  }, [student.joinedAt]);

  const computedExpiryDate = React.useMemo(() => {
    try {
      if (!student.joinedAt) return formatDateDMY(student.expiryDate, 'N/A');
      const start = parseISO(student.joinedAt);
      const durationMonths = Math.max(pkg?.durationMonths ?? 1, 1);
      return formatDateDMY(addMonths(start, durationMonths), 'N/A');
    } catch {
      return formatDateDMY(student.expiryDate, 'N/A');
    }
  }, [student.joinedAt, student.expiryDate, pkg?.durationMonths]);

  const latestInvoice = React.useMemo(() => {
    if (studentInvoices.length === 0) return null;
    return [...studentInvoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [studentInvoices]);
  
  const nextRenewalDate = React.useMemo(() => {
    try {
      if (!student.joinedAt) return 'N/A';
      const start = parseISO(student.joinedAt);

      if (pkg?.billingType === 'one-time') {
        const isFullyPaid = latestInvoice?.status === 'completed' && (latestInvoice.balanceAmount ?? 0) <= 0;
        return isFullyPaid ? 'N/A' : formatDateDMY(addMonths(start, 1), 'N/A');
      }

      return formatDateDMY(addMonths(start, 1), 'N/A');
    } catch {
      return 'N/A';
    }
  }, [student.joinedAt, pkg?.billingType, latestInvoice]);

  return (
    <Sheet onOpenChange={(open) => !open && setView('details')}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] px-0">
        <SheetHeader className="px-8 pb-6 border-b flex-row justify-between items-center space-y-0">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border">
              <AvatarFallback className="text-2xl bg-indigo-50 text-indigo-600 font-bold">
                {student.name.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle className="text-2xl font-display font-bold">{student.name}</SheetTitle>
              <Badge className="bg-indigo-100 text-indigo-700 border border-indigo-200">
                {packageBadgeText}
              </Badge>
            </div>
          </div>
          {view === 'history' && (
            <Button variant="ghost" size="sm" onClick={() => setView('details')} className="text-indigo-600 font-bold hover:text-indigo-700 hover:bg-indigo-50">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}
        </SheetHeader>
        
        <div className="px-8 py-8 space-y-8 overflow-y-auto max-h-[calc(100vh-140px)]">
          {view === 'details' ? (
            <>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase">Phone</p>
                  <p className="flex items-center gap-2 text-slate-700 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                    <Phone className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    {student.phone}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase">Email</p>
                  <p className="flex items-center gap-2 text-slate-700 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                    <Mail className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    {student.email}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-display font-bold text-slate-900">Active Membership</h4>
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-100">{student.packageName}</Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Start Date</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{computedStartDate}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Expiry Date</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">{computedExpiryDate}</p>
                  </div>
                  <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Sport</p>
                    <p className="text-sm font-bold text-indigo-900 mt-1">{student.sportName}</p>
                  </div>
                  <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Next Renewal</p>
                    <p className="text-sm font-bold text-indigo-900 mt-1">{nextRenewalDate}</p>
                  </div>
                </div>

                <div className="p-6 bg-slate-900 rounded-3xl text-white space-y-4">
                  <div className="flex justify-between items-center opacity-80 decoration-slate-400">
                    <span className="text-xs font-medium uppercase tracking-widest">Financial Summary</span>
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="grid grid-cols-2 gap-8">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Paid till now</p>
                      <p className="text-xl font-display font-bold">₹{totalPaid.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Amount Pending</p>
                      <p className="text-xl font-display font-bold text-rose-400">₹{(student.status === 'expired' ? (pkg?.price || 0) : 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 rounded-xl font-bold shadow-lg shadow-indigo-200">
                    Renew Now
                  </Button>
                  <Button variant="outline" onClick={() => setView('history')} className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50">
                    <History className="w-4 h-4 mr-2" />
                    History
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b pb-2">
                <h4 className="font-display font-bold text-slate-900">Payment History</h4>
                <p className="text-xs font-medium text-slate-500">{activeStudentInvoices.length} Transactions</p>
              </div>

              {activeStudentInvoices.length > 0 ? (
                <div className="space-y-3">
                  {activeStudentInvoices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(invoice => (
                    <div key={invoice.id} className="p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-200 transition-colors group">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">{invoice.id}</p>
                          <p className="text-sm font-bold text-slate-900 mt-0.5">{invoice.packageName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-indigo-600">₹{invoice.total.toLocaleString()}</p>
                          <p className="text-[10px] font-medium text-slate-500 uppercase">{invoice.paymentMode}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Calendar className="w-3 h-3" />
                          <span className="text-[11px] font-medium">{formatDateDMY(invoice.date)}</span>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-[10px] font-bold text-indigo-600 p-0 hover:bg-transparent"
                          onClick={() => {
                            navigate(`/invoices/view/${invoice.id}`);
                          }}
                        >
                          View Receipt <ArrowRight className="w-3 h-3 ml-1 group-hover:translate-x-1 transition-transform" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <History className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-500 font-medium">No payment history found</p>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

