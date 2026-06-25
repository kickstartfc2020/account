import React from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, Users, Building2, Receipt,
  CalendarDays, Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { DateRange } from 'react-day-picker';
import { cn, formatDateDMY, formatDateRangeDMY } from '@/lib/utils';
import { useInvoices, useStudents, useLocations } from '@/hooks/useData';
import { isWithinInterval, startOfDay, endOfDay, parseISO } from 'date-fns';
import { downloadInvoicesExcelBackup } from '@/lib/invoiceReset';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function SuperAdminReports() {
  const { data: allInvoices = [] } = useInvoices();
  const { data: allStudents = [] } = useStudents();
  const { data: locations = [] } = useLocations();
  const academy = useAcademyDetails();

  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [trendPeriod, setTrendPeriod] = React.useState<'6m' | '1y'>('6m');

  const filteredInvoices = React.useMemo(() => {
    const active = allInvoices.filter((inv) => inv.status !== 'cancelled');
    if (!dateRange?.from) return active;
    const start = startOfDay(dateRange.from);
    const end = endOfDay(dateRange.to ?? dateRange.from);
    return active.filter((inv) => isWithinInterval(parseISO(inv.date), { start, end }));
  }, [allInvoices, dateRange]);

  const filteredStudents = React.useMemo(() => {
    if (!dateRange?.from) return allStudents;
    const start = startOfDay(dateRange.from);
    const end = endOfDay(dateRange.to ?? dateRange.from);
    return allStudents.filter((s) => isWithinInterval(parseISO(s.joinedAt), { start, end }));
  }, [allStudents, dateRange]);

  // ── KPI ──────────────────────────────────────────────────────────────────
  const totalRevenue = React.useMemo(
    () => filteredInvoices.reduce((s, inv) => s + inv.total, 0),
    [filteredInvoices],
  );
  const totalCollected = React.useMemo(
    () => filteredInvoices.reduce((s, inv) => s + (inv.total - (inv.balanceAmount ?? 0)), 0),
    [filteredInvoices],
  );
  const totalPending = React.useMemo(
    () => filteredInvoices.reduce((s, inv) => s + (inv.balanceAmount ?? 0), 0),
    [filteredInvoices],
  );

  // ── Revenue trend ─────────────────────────────────────────────────────────
  const revenueTrendData = React.useMemo(() => {
    const monthCount = trendPeriod === '6m' ? 6 : 12;
    const now = new Date();
    const months = Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1);
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        month: d.toLocaleString('en-IN', { month: 'short' }),
        revenue: 0,
      };
    });
    allInvoices
      .filter((inv) => inv.status !== 'cancelled')
      .forEach((inv) => {
        const key = inv.date.slice(0, 7);
        const row = months.find((m) => m.key === key);
        if (row) row.revenue += inv.total;
      });
    return months;
  }, [allInvoices, trendPeriod]);

  // ── Revenue by branch ─────────────────────────────────────────────────────
  const revenueByBranch = React.useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; collected: number; students: number }>();
    locations.forEach((loc) => map.set(loc.id, { name: loc.name, revenue: 0, collected: 0, students: 0 }));
    filteredInvoices.forEach((inv) => {
      const entry = map.get(inv.locationId);
      if (entry) {
        entry.revenue += inv.total;
        entry.collected += inv.total - (inv.balanceAmount ?? 0);
      }
    });
    filteredStudents.forEach((s) => {
      const entry = map.get(s.locationId);
      if (entry) entry.students += 1;
    });
    return Array.from(map.values())
      .filter((b) => b.revenue > 0 || b.students > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredInvoices, filteredStudents, locations]);

  // ── Revenue by sport ──────────────────────────────────────────────────────
  const revenueBySport = React.useMemo(() => {
    const map = new Map<string, number>();
    const studentSportMap = new Map(allStudents.map((s) => [s.id, s.sportName]));
    filteredInvoices.forEach((inv) => {
      const sport = studentSportMap.get(inv.studentId) ?? 'Manual';
      map.set(sport, (map.get(sport) ?? 0) + inv.total);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredInvoices, allStudents]);

  // ── Revenue by payment mode ───────────────────────────────────────────────
  const revenueByPayment = React.useMemo(() => {
    const labelMap: Record<string, string> = { upi: 'UPI', cash: 'Cash', card: 'Card', online: 'Bank' };
    const map = new Map<string, number>();
    filteredInvoices.forEach((inv) => {
      const label = labelMap[inv.paymentMode] ?? inv.paymentMode ?? 'Other';
      map.set(label, (map.get(label) ?? 0) + inv.total);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredInvoices]);

  // ── Monthly summary table ─────────────────────────────────────────────────
  const monthlySummary = React.useMemo(() => {
    const map = new Map<string, { billed: number; collected: number; invoices: number; students: Set<string> }>();
    filteredInvoices.forEach((inv) => {
      const key = inv.date.slice(0, 7);
      if (!map.has(key)) map.set(key, { billed: 0, collected: 0, invoices: 0, students: new Set() });
      const row = map.get(key)!;
      row.billed += inv.total;
      row.collected += inv.total - (inv.balanceAmount ?? 0);
      row.invoices += 1;
      row.students.add(inv.studentId);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({
        month: new Date(key + '-01').toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
        billed: v.billed,
        collected: v.collected,
        invoices: v.invoices,
        uniqueStudents: v.students.size,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);
  }, [filteredInvoices]);

  const kpis = [
    { label: 'Total Billed', value: fmt(totalRevenue), icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Total Collected', value: fmt(totalCollected), icon: Receipt, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Pending', value: fmt(totalPending), icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: dateRange ? 'Students (Period)' : 'Total Students', value: filteredStudents.length.toString(), icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Active Branches', value: locations.length.toString(), icon: Building2, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Total Invoices', value: filteredInvoices.length.toString(), icon: Receipt, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Global Reports</h1>
          <p className="text-gray-500 mt-1 font-medium">Cross-branch analytics across all locations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('h-11 justify-start text-left font-bold border-slate-200 bg-white min-w-[240px] shadow-sm', !dateRange && 'text-slate-500')}
              >
                <CalendarDays className="mr-2 h-4 w-4 text-indigo-500" />
                {dateRange?.from
                  ? dateRange.to
                    ? formatDateRangeDMY(dateRange.from, dateRange.to)
                    : formatDateDMY(dateRange.from)
                  : 'Filter by Date Range'}
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
          {dateRange && (
            <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)} className="h-11 text-xs font-bold text-slate-500 hover:text-indigo-600">
              Reset
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 gap-2 font-bold"
            onClick={() => downloadInvoicesExcelBackup(allInvoices, academy.name || 'Kickstart')}
          >
            <Download className="w-4 h-4" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="glass-card p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{k.label}</p>
                <h3 className="text-xl font-bold mt-1 text-gray-900">{k.value}</h3>
              </div>
              <div className={cn('p-1.5 rounded-lg', k.bg, k.color)}>
                <k.icon className="w-4 h-4" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Revenue Trend */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-lg font-display font-semibold">Revenue Trend (All Branches)</CardTitle>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {(['6m', '1y'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setTrendPeriod(p)}
                className={cn('px-3 py-1 text-xs font-bold rounded-md transition-all', trendPeriod === p ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
              >
                {p === '6m' ? '6 Months' : '1 Year'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrendData}>
                <defs>
                  <linearGradient id="rptGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }}
                  formatter={(v: number) => [fmt(v), 'Revenue']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={3} fill="url(#rptGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Branch Revenue + Sport/Payment split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Branch breakdown */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold">Revenue by Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByBranch} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#374151', fontSize: 12, fontWeight: 600 }} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }}
                    formatter={(v: number) => [fmt(v)]}
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="Billed" fill="#c7d2fe" radius={[0, 4, 4, 0]} barSize={12} />
                  <Bar dataKey="collected" name="Collected" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Sport + Payment stacked */}
        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Revenue by Sport</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={revenueBySport} dataKey="value" cx="50%" cy="50%" outerRadius={50} paddingAngle={3}>
                      {revenueBySport.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 12px rgb(0 0 0/0.1)' }} formatter={(v: number) => [fmt(v)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {revenueBySport.map((s, i) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="font-medium text-gray-700 truncate max-w-[100px]">{s.name}</span>
                    </div>
                    <span className="font-bold text-gray-900">{fmt(s.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Revenue by Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {revenueByPayment.map(({ name, value }, i) => {
                const max = revenueByPayment[0]?.value ?? 1;
                const barColor = name === 'UPI' ? 'bg-violet-500' : name === 'Cash' ? 'bg-emerald-500' : name === 'Card' ? 'bg-blue-500' : 'bg-amber-500';
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold text-gray-700">{name}</span>
                      <span className="font-bold text-gray-900">{fmt(value)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.round((value / max) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Branch Detail Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base font-bold">Branch Performance Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Branch</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Students</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Billed</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Collected</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pending</th>
                </tr>
              </thead>
              <tbody>
                {revenueByBranch.map((b, i) => (
                  <tr key={b.name} className={cn('border-b border-gray-50 hover:bg-slate-50 transition-colors', i % 2 === 0 ? '' : 'bg-gray-50/30')}>
                    <td className="px-6 py-3 font-semibold text-gray-900">{b.name}</td>
                    <td className="px-6 py-3 text-right text-gray-600 font-medium">{b.students}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(b.revenue)}</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-600">{fmt(b.collected)}</td>
                    <td className="px-6 py-3 text-right font-bold text-amber-600">{fmt(b.revenue - b.collected)}</td>
                  </tr>
                ))}
                {revenueByBranch.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">No data for selected period.</td></tr>
                )}
              </tbody>
              {revenueByBranch.length > 0 && (
                <tfoot>
                  <tr className="bg-indigo-50/60 border-t-2 border-indigo-100">
                    <td className="px-6 py-3 font-bold text-indigo-800">Total</td>
                    <td className="px-6 py-3 text-right font-bold text-indigo-800">{filteredStudents.length}</td>
                    <td className="px-6 py-3 text-right font-bold text-indigo-800">{fmt(totalRevenue)}</td>
                    <td className="px-6 py-3 text-right font-bold text-indigo-800">{fmt(totalCollected)}</td>
                    <td className="px-6 py-3 text-right font-bold text-indigo-800">{fmt(totalPending)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Summary Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base font-bold">Monthly Summary (Last 12 Months)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Month</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Invoices</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Unique Students</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Billed</th>
                  <th className="text-right px-6 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Collected</th>
                </tr>
              </thead>
              <tbody>
                {monthlySummary.map((row, i) => (
                  <tr key={row.month} className={cn('border-b border-gray-50 hover:bg-slate-50 transition-colors', i % 2 === 0 ? '' : 'bg-gray-50/30')}>
                    <td className="px-6 py-3 font-semibold text-gray-900">{row.month}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.invoices}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.uniqueStudents}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(row.billed)}</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-600">{fmt(row.collected)}</td>
                  </tr>
                ))}
                {monthlySummary.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400 text-sm">No invoice data available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
