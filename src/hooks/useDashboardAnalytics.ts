import React from 'react';
import { endOfDay, format, isWithinInterval, parseISO, startOfDay, subMonths } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import type { Invoice, Renewal, Student } from '@/types';

type UseDashboardAnalyticsParams = {
  dateRange?: DateRange;
  allStudents: Student[];
  allInvoices: Invoice[];
  allRenewals: Renewal[];
};

export function useDashboardAnalytics({
  dateRange,
  allStudents,
  allInvoices,
  allRenewals,
}: UseDashboardAnalyticsParams) {
  const activeInvoices = React.useMemo(
    () => allInvoices.filter((inv) => inv.status !== 'cancelled'),
    [allInvoices]
  );

  const overallRevenue = React.useMemo(
    () => activeInvoices.reduce((acc, inv) => acc + inv.total, 0),
    [activeInvoices]
  );

  const {
    filteredInvoices,
    filteredStudents,
    filteredRenewals,
    selectedRevenue,
    monthRevenue,
  } = React.useMemo(() => {
    const withinRange = (dateText: string) => {
      if (!dateRange?.from) return true;
      const start = startOfDay(dateRange.from);
      const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      return isWithinInterval(parseISO(dateText), { start, end });
    };

    const nextInvoices: Invoice[] = [];
    const nextStudents: Student[] = [];
    const nextRenewals: Renewal[] = [];
    const nextMonthRevenue = new Map<string, number>();

    let nextSelectedRevenue = 0;

    for (const inv of activeInvoices) {
      if (!withinRange(inv.date)) continue;

      nextInvoices.push(inv);
      nextSelectedRevenue += inv.total;

      const key = format(parseISO(inv.date), 'yyyy-MM');
      nextMonthRevenue.set(key, (nextMonthRevenue.get(key) ?? 0) + inv.total);
    }

    for (const student of allStudents) {
      if (withinRange(student.joinedAt)) nextStudents.push(student);
    }

    for (const renewal of allRenewals) {
      if (withinRange(renewal.expiryDate)) nextRenewals.push(renewal);
    }

    return {
      filteredInvoices: nextInvoices,
      filteredStudents: nextStudents,
      filteredRenewals: nextRenewals,
      selectedRevenue: nextSelectedRevenue,
      monthRevenue: nextMonthRevenue,
    };
  }, [dateRange, activeInvoices, allRenewals, allStudents]);

  return React.useMemo(() => {
    const revenueVal = `₹${Math.round(dateRange ? selectedRevenue : overallRevenue).toLocaleString('en-IN')}`;

    const stats = [
      { label: 'Total Revenue', value: revenueVal, trend: dateRange ? 'Based on selection' : 'All time' },
      { label: "Today's Invoices", value: filteredInvoices.length.toString(), trend: dateRange ? 'In range' : 'Total invoices' },
      { label: 'Active Students', value: filteredStudents.length.toString(), trend: dateRange ? 'Joined in range' : 'Total students' },
      { label: 'Pending Renewals', value: filteredRenewals.length.toString(), trend: dateRange ? 'Expiring in range' : 'Due within 7 days' },
    ];

    const now = new Date();
    const months = Array.from({ length: 6 }).map((_, idx) => {
      const d = subMonths(now, 5 - idx);
      const key = format(d, 'yyyy-MM');
      return { key, month: format(d, 'MMM'), revenue: 0 };
    });

    for (const month of months) {
      month.revenue = monthRevenue.get(month.key) ?? 0;
    }

    return {
      stats,
      filteredStudents,
      filteredRenewals,
      filteredRevenueData: months,
    };
  }, [dateRange, filteredInvoices, filteredRenewals, filteredStudents, monthRevenue, overallRevenue, selectedRevenue]);
}
