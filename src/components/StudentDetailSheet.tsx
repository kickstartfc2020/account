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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Student, StudentEnrollment } from '@/types';
import { useInvoices, usePackages, useReminders } from '@/hooks/useData';
import { addMonths, parseISO } from 'date-fns';
import { formatDateDMY } from '@/lib/utils';
import { recordInvoicePayment } from '@/lib/invoiceWrite';
import { reportOperationalError } from '@/lib/observability';
import { toast } from 'sonner';

interface StudentDetailSheetProps {
  student: Student;
  children?: React.ReactNode;
  studentEnrollments?: StudentEnrollment[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function StudentDetailSheet({ student, children, studentEnrollments = [], open, onOpenChange }: StudentDetailSheetProps) {
  const navigate = useNavigate();
  const [view, setView] = React.useState<'details' | 'history'>('details');
  const { data: allInvoices } = useInvoices();
  const { data: allPackages } = usePackages();
  const { data: allReminders } = useReminders();
  const [payingInvoiceId, setPayingInvoiceId] = React.useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = React.useState('');
  const [paymentMethod, setPaymentMethod] = React.useState<'cash' | 'card' | 'upi' | 'bank_transfer'>('cash');
  const [isRecordingPayment, setIsRecordingPayment] = React.useState(false);

  const handleRecordPayment = async (invoiceDbId: string) => {
    const amount = parseFloat(paymentAmount || '0');
    if (!paymentAmount || amount <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }

    setIsRecordingPayment(true);
    try {
      await recordInvoicePayment({
        invoiceId: invoiceDbId,
        amount,
        paymentMethod,
        paymentModeLabel: paymentMethod,
      });
      toast.success('Payment recorded.');
      setPayingInvoiceId(null);
      setPaymentAmount('');
    } catch (error) {
      reportOperationalError('invoice.record_payment', 'Failed to record payment.', error, { invoiceId: invoiceDbId });
      toast.error(error instanceof Error ? error.message : 'Failed to record payment.');
    } finally {
      setIsRecordingPayment(false);
    }
  };
  
  const studentInvoices = React.useMemo(() => {
    return allInvoices.filter(inv => inv.studentId === student.id);
  }, [student.id, allInvoices]);

  const nextReminderLabel = React.useMemo(() => {
    const upcoming = allReminders
      .filter((reminder) => reminder.studentId === student.id)
      .sort((a, b) => a.remindAt.localeCompare(b.remindAt));
    return upcoming.length > 0 ? formatDateDMY(upcoming[0].remindAt) : 'None scheduled';
  }, [allReminders, student.id]);

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
      ? [{ packageId: student.packageId, packageName: student.packageName, sportName: student.sportName, price: student.enrolledPrice ?? 0 }]
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
      isManual: boolean;
      startDateLabel: string;
      expiryDateLabel: string;
      nextRenewalLabel: string;
      showNextRenewal: boolean;
      paidTillNow: number;
      totalDiscountGiven: number;
      previousReceivedAmount: number;
      amountPending: number;
    }> = [];

    uniqueByPackageId.forEach((enrollment) => {
      const sportName = enrollment.sportName || 'Sport';
      const packageDetails = allPackages.find((item) => item.id === enrollment.packageId);
      const durationMonths = Math.max(packageDetails?.durationMonths ?? 1, 1);
      // Manual invoices share one dummy zero-price package per branch — there's
      // no fixed batch cost or enrollment period to compute Start/Expiry/pending
      // against, so each manual invoice's own total/balance is used instead.
      const isManual = enrollment.packageName === 'Manual Billing Package';

      const startDateLabel = startDate ? formatDateDMY(startDate, 'N/A') : 'N/A';
      const expiryDateLabel = startDate ? formatDateDMY(addMonths(startDate, durationMonths), 'N/A') : 'N/A';

      let nextRenewalLabel = 'N/A';
      const showNextRenewal = packageDetails?.billingType !== 'one-time';
      if (startDate && showNextRenewal) {
        nextRenewalLabel = formatDateDMY(addMonths(startDate, 1), 'N/A');
      }

      const matchingInvoices = isManual
        ? activeStudentInvoices.filter((invoice) => invoice.manualCustomerName !== undefined)
        : activeStudentInvoices.filter((invoice) => invoice.packageName === enrollment.packageName);
      const totalDiscountGiven = matchingInvoices.reduce((sum, invoice) => sum + (invoice.discountAmount ?? 0), 0);

      let paidTillNow: number;
      let amountPending: number;
      // Previous received amount is tracked once per student (not per batch), so it
      // only applies against their current package's pending balance.
      const previousReceivedAmount = (!isManual && enrollment.packageId === student.packageId)
        ? (student.previousReceivedAmount ?? 0)
        : 0;

      if (isManual) {
        paidTillNow = matchingInvoices.reduce((sum, invoice) => sum + Math.max(invoice.total - invoice.balanceAmount, 0), 0);
        amountPending = matchingInvoices.reduce((sum, invoice) => sum + Math.max(invoice.balanceAmount, 0), 0);
      } else {
        paidTillNow = matchingInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
        // Use the price locked at enrollment time; fall back to current package price.
        const packagePrice = enrollment.price > 0 ? enrollment.price : (packageDetails?.price ?? 0);
        amountPending = Math.max(packagePrice - paidTillNow - totalDiscountGiven - previousReceivedAmount, 0);
      }

      summaries.push({
        sportName,
        packageName: enrollment.packageName || packageDetails?.name || 'Batch',
        packageId: enrollment.packageId,
        isManual,
        startDateLabel,
        expiryDateLabel,
        nextRenewalLabel,
        showNextRenewal,
        paidTillNow,
        totalDiscountGiven,
        previousReceivedAmount,
        amountPending,
      });
    });

    return summaries.sort((a, b) => {
      if (b.amountPending !== a.amountPending) {
        return b.amountPending - a.amountPending;
      }

      return a.packageName.localeCompare(b.packageName);
    });
  }, [student.joinedAt, student.packageId, student.packageName, student.sportName, student.previousReceivedAmount, studentEnrollments, allPackages, activeStudentInvoices]);

  const isControlled = open !== undefined;

  return (
    <Sheet
      open={isControlled ? open : undefined}
      onOpenChange={(o) => {
        if (!o) setView('details');
        onOpenChange?.(o);
      }}
    >
      {!isControlled && <SheetTrigger asChild>{children}</SheetTrigger>}
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

                      {summary.isManual ? (
                        <div className="pt-3">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Next Reminder</p>
                          <p className="text-sm font-bold text-slate-900 mt-1">{nextReminderLabel}</p>
                        </div>
                      ) : (
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
                      )}

                      <div className="grid grid-cols-2 gap-3 pt-3 mt-3 border-t border-indigo-100/60">
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Paid Till Now</p>
                          <p className="text-base font-display font-bold text-emerald-700 mt-1">₹{summary.paidTillNow.toLocaleString('en-IN')}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount Pending</p>
                          <p className="text-base font-display font-bold text-rose-500 mt-1">₹{summary.amountPending.toLocaleString('en-IN')}</p>
                        </div>
                        {summary.previousReceivedAmount > 0 && (
                          <div className="col-span-2">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Previous Received Amount</p>
                            <p className="text-base font-display font-bold text-indigo-600 mt-1">₹{summary.previousReceivedAmount.toLocaleString('en-IN')}</p>
                          </div>
                        )}
                        {summary.totalDiscountGiven > 0 && (
                          <div className="col-span-2">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Discount Given</p>
                            <p className="text-base font-display font-bold text-amber-600 mt-1">₹{summary.totalDiscountGiven.toLocaleString('en-IN')}</p>
                          </div>
                        )}
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
                      {invoice.balanceAmount > 0 && (
                        <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-50">
                          <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-100 text-[10px] uppercase">
                            ₹{invoice.balanceAmount.toLocaleString()} Pending
                          </Badge>
                          {payingInvoiceId !== invoice.dbId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] font-bold text-emerald-600 p-0 hover:bg-transparent"
                              onClick={() => {
                                setPayingInvoiceId(invoice.dbId);
                                setPaymentAmount(String(invoice.balanceAmount));
                              }}
                            >
                              Record Payment
                            </Button>
                          )}
                        </div>
                      )}

                      {payingInvoiceId === invoice.dbId && (
                        <div className="mt-3 pt-3 border-t border-slate-50 space-y-2">
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min={0}
                              max={invoice.balanceAmount}
                              value={paymentAmount}
                              onChange={(e) => setPaymentAmount(e.target.value)}
                              className="h-9 text-sm"
                              placeholder="Amount"
                            />
                            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                              <SelectTrigger className="h-9 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Cash</SelectItem>
                                <SelectItem value="upi">UPI</SelectItem>
                                <SelectItem value="card">Card</SelectItem>
                                <SelectItem value="bank_transfer">Bank</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => setPayingInvoiceId(null)} disabled={isRecordingPayment}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => void handleRecordPayment(invoice.dbId)}
                              disabled={isRecordingPayment}
                            >
                              {isRecordingPayment ? 'Saving...' : 'Confirm'}
                            </Button>
                          </div>
                        </div>
                      )}

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

