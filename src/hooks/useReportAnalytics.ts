import React from 'react';
import { format, parseISO, subMonths } from 'date-fns';
import type { Invoice, Student } from '@/types';

const SPORT_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#f43f5e'];

export function useReportAnalytics(invoices: Invoice[], students: Student[]) {
  return React.useMemo(() => {
    const activeInvoices = invoices.filter((inv) => inv.status !== 'cancelled');

    const now = new Date();
    const months = Array.from({ length: 6 }).map((_, idx) => {
      const d = subMonths(now, 5 - idx);
      const key = format(d, 'yyyy-MM');
      return { key, month: format(d, 'MMM'), revenue: 0, growth: 0 };
    });

    const revenueMap = new Map<string, number>();
    for (const inv of activeInvoices) {
      const key = format(parseISO(inv.date), 'yyyy-MM');
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + inv.total);
    }

    const growthMap = new Map<string, number>();
    for (const s of students) {
      const key = format(parseISO(s.joinedAt), 'yyyy-MM');
      growthMap.set(key, (growthMap.get(key) ?? 0) + 1);
    }

    for (const m of months) {
      m.revenue = revenueMap.get(m.key) ?? 0;
      m.growth = growthMap.get(m.key) ?? 0;
    }

    const bySport = new Map<string, number>();
    for (const s of students) {
      const sport = s.sportName || 'Unknown';
      bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
    }

    const totalStudents = students.length || 1;
    const sportData = Array.from(bySport.entries())
      .map(([name, count], idx) => ({
        name,
        value: Math.round((count / totalStudents) * 100),
        color: SPORT_COLORS[idx % SPORT_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);

    return { revenueData: months, sportData };
  }, [invoices, students]);
}
