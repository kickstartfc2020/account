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
import { Student, StudentEnrollment } from '@/types';
import { useInvoices, usePackages } from '@/hooks/useData';
import { addMonths, parseISO } from 'date-fns';
import { formatDateDMY } from '@/lib/utils';

interface StudentDetailSheetProps {
  student: Student;
  children: React.ReactNode;
  studentEnrollments?: StudentEnrollment[];
}

export function StudentDetailSheet({ student, children, studentEnrollments = [] }: StudentDetailSheetProps) {
  const navigate = useNavigate();
  const [view, setView] = React.useState<'details' | 'history'>('details');
  const { data: allInvoices } = useInvoices();
  const { data: allPackages } = usePackages();
  
  const studentInvoices = React.useMemo(() => {
    return allInvoices.filter(inv => inv.studentId === student.id);
  }, [student.id, allInvoices]);

  const pkg = allPackages.find(p => p.id === student.packageId);

  const enrolledPackages = React.useMemo(() => {
    const uniqueByPackage = new Map<string, { sportName: string; packageName: string; price: number }>();

    studentEnrollments.forEach((enrollment) => {
        if (!uniqueByPackage.has(enrollment.packageId)) {
          uniqueByPackage.set(enrollment.packageId, {
            sportName: enrollment.sportName,
            packageName: enrollment.packageName,
            price: enrollment.price,
          });
        }
      });

    const values = Array.from(uniqueByPackage.values());
    if (values.length > 0) return values;

    if (!student.packageName) return [];
    return [{
      sportName: student.sportName || 'Sport',
      packageName: student.packageName,
      price: pkg?.price ?? 0,
    }];
  }, [studentEnrollments, student.packageName, student.sportName, pkg?.price]);

  const activeStudentInvoices = React.useMemo(() => {
    return studentInvoices.filter((inv) => inv.status !== 'cancelled');
  }, [studentInvoices]);

  const totalPaid = React.useMemo(() => {
    return activeStudentInvoices.reduce((sum, inv) => sum + inv.total, 0);
  }, [activeStudentInvoices]);

  const latestInvoice = React.useMemo(() => {
    if (studentInvoices.length === 0) return null;
    return [...studentInvoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [studentInvoices]);

  const packageWiseSummaries = React.useMemo(() => {
    const startDate = (() => {
      try {
        return student.joinedAt ? parseISO(student.joinedAt) : null;
      } catch {
        return null;
      }
    })();

    const fallbackEnrollments = student.packageId
      ? [{ packageId: student.packageId, packageName: student.packageName, sportName: student.sportName }]
      : [];

    const sourceEnrollments = studentEnrollments.length > 0 ? studentEnrollments : fallbackEnrollments;
    const uniqueByPackageId = new Map<string, typeof sourceEnrollments[number]>();
    sourceEnrollments.forEach((enrollment) => {
      const key = enrollment.packageId || `${enrollment.sportName}:${enrollment.packageName}`;
      if (!uniqueByPackageId.has(key)) {
        uniqueByPackageId.set(key, enrollment);
      }
    });

    const summaries: Array<{
      sportName: string;
      packageName: string;
      packageId: string;
      startDateLabel: string;
      expiryDateLabel: string;
      nextRenewalLabel: string;
      showNextRenewal: boolean;
      paidTillNow: number;
      amountPending: number;
    }> = [];

    uniqueByPackageId.forEach((enrollment) => {
      const sportName = enrollment.sportName || 'Sport';
      const packageDetails = allPackages.find((item) => item.id === enrollment.packageId);
      const durationMonths = Math.max(packageDetails?.durationMonths ?? 1, 1);

      const startDateLabel = startDate ? formatDateDMY(startDate, 'N/A') : 'N/A';
      const expiryDateLabel = startDate ? formatDateDMY(addMonths(startDate, durationMonths), 'N/A') : 'N/A';

      let nextRenewalLabel = 'N/A';
      const showNextRenewal = packageDetails?.billingType !== 'one-time';
      if (startDate && showNextRenewal) {
        nextRenewalLabel = formatDateDMY(addMonths(startDate, 1), 'N/A');
      }

      const matchingInvoices = activeStudentInvoices.filter((invoice) =>
        invoice.packageName === enrollment.packageName
      );
      const paidTillNow = matchingInvoices.reduce((sum, invoice) => sum + invoice.total, 0);

      const expectedTotal = (() => {
        if (!packageDetails) return 0;
        return packageDetails.price + (packageDetails.price * packageDetails.taxPercent) / 100;
      })();

      summaries.push({
        sportName,
        packageName: enrollment.packageName || packageDetails?.name || 'Batch',
        packageId: enrollment.packageId,
        startDateLabel,
        expiryDateLabel,
        nextRenewalLabel,
        showNextRenewal,
        paidTillNow,
        amountPending: Math.max(expectedTotal - paidTillNow, 0),
      });
    });

    return summaries.sort((a, b) => {
      if (b.amountPending !== a.amountPending) {
        return b.amountPending - a.amountPending;
      }

      return a.packageName.localeCompare(b.packageName);
    });
  }, [student.joinedAt, student.packageId, student.packageName, student.sportName, studentEnrollments, allPackages, activeStudentInvoices]);

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
                  <h4 className="font-display font-bold text-slate-900">Enrolled Batches</h4>
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-100">{enrolledPackages.length} Total</Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  {enrolledPackages.length > 0 ? (
                    enrolledPackages.map((packageInfo) => (
                      <Badge key={`${packageInfo.sportName}-${packageInfo.packageName}`} variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100 uppercase text-[10px]">
                        {packageInfo.sportName} - {packageInfo.packageName} - ₹{Math.round(packageInfo.price).toLocaleString('en-IN')}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">{student.packageName || 'No batch history'}</Badge>
                  )}
                </div>
                
                <div className="space-y-3">
                  {packageWiseSummaries.map((summary) => (
                    <div key={`${summary.packageId}:${summary.packageName}`} className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50">
                      <div className="flex items-center justify-between gap-3 pb-3 border-b border-indigo-100/60">
                        <div>
                          <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Sport</p>
                          <p className="text-sm font-bold text-indigo-900 mt-1">{summary.sportName}</p>
                        </div>
                        <Badge variant="outline" className="bg-white text-indigo-700 border-indigo-200 text-[10px] uppercase">
                          {summary.packageName || 'No batch'}
                        </Badge>
                      </div>

                      <div className={`grid ${summary.showNextRenewal ? 'grid-cols-3' : 'grid-cols-2'} gap-3 pt-3`}>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Start</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{summary.startDateLabel}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Expiry</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{summary.expiryDateLabel}</p>
                        </div>
                        {summary.showNextRenewal && (
                          <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Next Renewal</p>
                            <p className="text-sm font-bold text-slate-900 mt-1">{summary.nextRenewalLabel}</p>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-3 mt-3 border-t border-indigo-100/60">
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Paid Till Now</p>
                          <p className="text-base font-display font-bold text-emerald-700 mt-1">₹{summary.paidTillNow.toLocaleString('en-IN')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount Pending</p>
                          <p className="text-base font-display font-bold text-rose-500 mt-1">₹{summary.amountPending.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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

