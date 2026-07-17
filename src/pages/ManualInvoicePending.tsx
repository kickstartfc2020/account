import React from 'react';
import { AlertCircle, CalendarClock, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StudentDetailSheet } from '@/components/StudentDetailSheet';
import { useReminders, useStudents, useStudentEnrollments } from '@/hooks/useData';
import { rescheduleReminder } from '@/lib/dataMutations';
import { toast } from 'sonner';
import { reportOperationalError } from '@/lib/observability';
import type { InvoiceReminder } from '@/types';

export default function ManualInvoicePending() {
  const { data: reminders, loading } = useReminders();
  const { data: students } = useStudents();
  const { data: enrollments } = useStudentEnrollments();
  const [savingReminderId, setSavingReminderId] = React.useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const dueToday = React.useMemo(
    () => reminders.filter((r) => r.remindAt <= todayStr).sort((a, b) => a.remindAt.localeCompare(b.remindAt)),
    [reminders, todayStr]
  );
  const upcoming = React.useMemo(
    () => reminders.filter((r) => r.remindAt > todayStr).sort((a, b) => a.remindAt.localeCompare(b.remindAt)),
    [reminders, todayStr]
  );

  const handleReschedule = async (reminderId: string, nextDate: string) => {
    if (!nextDate) return;
    setSavingReminderId(reminderId);
    try {
      await rescheduleReminder(reminderId, nextDate);
      toast.success('Reminder rescheduled.');
    } catch (error) {
      reportOperationalError('reminder.reschedule', 'Failed to reschedule reminder.', error, { reminderId });
      toast.error(error instanceof Error ? error.message : 'Failed to reschedule reminder.');
    } finally {
      setSavingReminderId(null);
    }
  };

  const renderTable = (rows: InvoiceReminder[], emptyLabel: string) => {
    if (rows.length === 0) {
      return <p className="text-sm text-slate-400 py-8 text-center">{emptyLabel}</p>;
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Paid</TableHead>
            <TableHead>Pending</TableHead>
            <TableHead>Reminder Date</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((reminder) => {
            const student = students.find((s) => s.id === reminder.studentId);
            const paidAmount = Math.max(reminder.totalAmount - reminder.balanceAmount, 0);
            const nameCell = (
              <div className="flex items-center gap-3 cursor-pointer group">
                <Avatar className="h-8 w-8 border">
                  <AvatarFallback className="bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                    {reminder.studentName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <span className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {reminder.studentName}
                  </span>
                  <p className="text-[10px] font-mono text-slate-400">{reminder.invoiceNumber}</p>
                </div>
              </div>
            );

            return (
              <TableRow key={reminder.id}>
                <TableCell>
                  {student ? (
                    <StudentDetailSheet
                      student={student}
                      studentEnrollments={enrollments.filter((e) => e.studentId === reminder.studentId)}
                    >
                      {nameCell}
                    </StudentDetailSheet>
                  ) : (
                    nameCell
                  )}
                </TableCell>
                <TableCell className="text-slate-500 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {reminder.studentPhone}
                  </span>
                </TableCell>
                <TableCell className="font-semibold text-slate-900">₹{reminder.totalAmount.toLocaleString('en-IN')}</TableCell>
                <TableCell className="text-emerald-600 font-semibold">₹{paidAmount.toLocaleString('en-IN')}</TableCell>
                <TableCell className="text-rose-600 font-bold">₹{reminder.balanceAmount.toLocaleString('en-IN')}</TableCell>
                <TableCell>
                  <Input
                    type="date"
                    value={reminder.remindAt}
                    disabled={savingReminderId === reminder.id}
                    onChange={(e) => void handleReschedule(reminder.id, e.target.value)}
                    className="h-9 w-40"
                  />
                </TableCell>
                <TableCell className="text-slate-500 text-sm max-w-[220px]">
                  {reminder.note ? (
                    <span className="line-clamp-2" title={reminder.note}>{reminder.note}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-gray-900">Manual Invoice Pending</h1>
        <p className="text-sm text-slate-500 mt-1">Partially paid invoices awaiting the remaining balance.</p>
      </div>

      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="w-4 h-4 text-rose-500" />
            Due Today
          </CardTitle>
          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-100">
            {dueToday.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-400 py-8 text-center">Loading...</p>
          ) : (
            renderTable(dueToday, 'Nothing due today.')
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="w-4 h-4 text-indigo-500" />
            Upcoming
          </CardTitle>
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100">
            {upcoming.length}
          </Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-400 py-8 text-center">Loading...</p>
          ) : (
            renderTable(upcoming, 'No upcoming reminders.')
          )}
        </CardContent>
      </Card>
    </div>
  );
}
