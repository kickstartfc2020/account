import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  Users, 
  Receipt, 
  RefreshCcw,
  Calendar as CalendarIcon,
  CalendarDays
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStudents, useInvoices, useRenewals } from '@/hooks/useData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { DateRange } from "react-day-picker";
import { useDashboardAnalytics } from '@/hooks/useDashboardAnalytics';
import { formatDateDMY, formatDateRangeDMY } from '@/lib/utils';

export default function Dashboard() {
  const { data: allStudents = [] } = useStudents();
  const { data: allInvoices = [] } = useInvoices();
  const { data: allRenewals = [] } = useRenewals();

  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const navigate = useNavigate();
  const { stats, filteredStudents, filteredRenewals, filteredRevenueData } = useDashboardAnalytics({
    dateRange,
    allStudents,
    allInvoices,
    allRenewals,
  });

  const isStudentActiveNow = (joinedAt: string, expiryDate: string) => {
    const start = new Date(joinedAt);
    const end = new Date(expiryDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
    const now = new Date();
    return now >= start && now <= end;
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Academy Overview</h1>
          <p className="text-slate-500 font-medium">Welcome back! Here's how Kickstart is performing today.</p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-11 justify-start text-left font-bold border-slate-200 bg-white min-w-[260px] shadow-sm hover:bg-slate-50 transition-all",
                  !dateRange && "text-slate-500"
                )}
              >
                <CalendarDays className="mr-2.5 h-4 w-4 text-indigo-500" />
                {dateRange?.from ? (
                  dateRange.to ? formatDateRangeDMY(dateRange.from, dateRange.to) : formatDateDMY(dateRange.from)
                ) : (
                  <span>Filter by Dates Overview</span>
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

          {dateRange && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setDateRange(undefined)}
              className="h-11 text-xs font-bold text-slate-500 hover:text-indigo-600"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="stat-card"
          >
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{stat.label}</p>
            <h3 className="text-2xl font-bold mt-1 text-gray-900">{stat.value}</h3>
            <p className={cn(
              "text-xs mt-1 font-medium",
              i === 0 ? "text-green-600" : i === 3 ? "text-amber-600" : "text-gray-500"
            )}>
              {i === 0 && !dateRange && "↑ "}
              {stat.trend}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Revenue Chart */}
        <Card className="lg:col-span-2 glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-8">
            <CardTitle className="text-lg font-display font-semibold">Revenue Trends</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs">{dateRange ? 'Custom Range' : 'Last 6 Months'}</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredRevenueData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={(val) => `₹${Math.round(val).toLocaleString('en-IN')}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      borderRadius: '12px', 
                      border: 'none', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' 
                    }} 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#4f46e5" 
                    strokeWidth={3}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pending Renewals Widget (Expiring Soon) */}
        <Card className="glass-card flex flex-col h-full">
          <CardHeader>
            <CardTitle className="text-lg font-display font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-600" />
              Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 flex-1">
            <div className="p-4 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-100">
              <h4 className="font-semibold mb-1 text-sm">Renewal Alerts</h4>
              <p className="text-[10px] text-indigo-100 mb-4">{filteredRenewals.length} students are expiring soon. Swift action recommended.</p>
              <Button className="w-full bg-white text-indigo-600 hover:bg-indigo-50 py-2 h-9 rounded-lg text-xs font-bold shadow-sm border-none">
                Manage Renewals
              </Button>
            </div>
            
            <div className="space-y-4">
              {filteredRenewals.slice(0, 4).map((renewal) => (
                <div key={renewal.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer group" onClick={() => navigate('/renewals')}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-400 text-[10px]">
                      {renewal.studentName.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <p className="font-semibold text-xs text-gray-900">{renewal.studentName}</p>
                      <p className="text-[10px] text-gray-500">In {renewal.daysLeft} days</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-3 h-7 uppercase hover:bg-indigo-100">
                    Renew
                  </Button>
                </div>
              ))}
              {filteredRenewals.length === 0 && (
                <p className="text-xs text-center text-slate-500 py-4">No renewals in this range.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity Table */}
        <Card className="lg:col-span-2 glass-card overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-display font-semibold">
              {dateRange ? 'Students Joined' : 'Recent Students'}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-indigo-600 text-xs">View All</Button>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50/50">
                <TableRow>
                  <TableHead className="text-[10px] uppercase font-bold text-gray-500">Student</TableHead>
                  <TableHead className="text-[10px] uppercase font-bold text-gray-500">Sport</TableHead>
                  <TableHead className="text-[10px] uppercase font-bold text-gray-500">Batch</TableHead>
                  <TableHead className="text-[10px] uppercase font-bold text-gray-500">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.slice(0, 5).map((student) => (
                  <TableRow key={student.id}>
                    <TableCell className="font-medium">{student.name}</TableCell>
                    <TableCell>{student.sportName}</TableCell>
                    <TableCell className="text-gray-500">{student.packageName}</TableCell>
                    <TableCell>
                      {(() => {
                        const isActiveNow = isStudentActiveNow(student.joinedAt, student.expiryDate);
                        return (
                      <Badge className={cn(
                        "status-badge",
                        isActiveNow
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-600"
                      )}>
                        {isActiveNow ? 'active' : 'inactive'}
                      </Badge>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredStudents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-slate-500 italic">
                      No students found in selection.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

      </div>
    </div>
  );
}
