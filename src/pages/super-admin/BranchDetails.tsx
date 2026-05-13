import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Users, 
  TrendingUp, 
  Mail, 
  ShieldAlert, 
  ArrowLeft,
  Key,
  Target
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocations, useStudents, useInvoices } from '@/hooks/useData';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { toast } from 'sonner';
import { setBranchStatus } from '@/lib/adminManagement';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { format, formatDistanceToNow, parseISO, subMonths } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { formatDateDMY } from '@/lib/utils';

const SPORT_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

export default function BranchDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { data: locations = [] } = useLocations();
  const { data: students = [] } = useStudents();
  const { data: invoices = [] } = useInvoices();
  const location = locations.find(l => l.id === id) || locations[0];
  const [isFreezing, setIsFreezing] = React.useState(false);
  const [isResetting, setIsResetting] = React.useState(false);
  const canManageBranchSecurity = role === 'super_admin';
  const locationMeta = location as (typeof location & {
    createdAt?: string;
    created_at?: string;
    planType?: string;
    plan_type?: string;
    status?: string;
  }) | undefined;

  const ensureSuperAdmin = React.useCallback(() => {
    if (!canManageBranchSecurity) {
      toast.error('Only super admins can perform this action.');
      return false;
    }
    return true;
  }, [canManageBranchSecurity]);

  const handleResetPassword = async () => {
    if (!ensureSuperAdmin()) return;

    if (!location?.email) {
      toast.error('No email configured for this branch.');
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      toast.error('Supabase is not configured.');
      return;
    }

    setIsResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(location.email);
    setIsResetting(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('Password reset link sent to branch email.');
  };

  const handleFreezeAccess = async () => {
    if (!ensureSuperAdmin()) return;

    if (!location?.id) return;
    setIsFreezing(true);
    try {
      await setBranchStatus(location.id, 'inactive');
      toast.success('Branch access has been frozen.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to freeze access.';
      toast.error(message);
    } finally {
      setIsFreezing(false);
    }
  };

  const branchStudents = React.useMemo(
    () => students.filter((s) => s.locationId === location?.id),
    [students, location?.id]
  );

  const branchInvoices = React.useMemo(
    () => invoices.filter((inv) => inv.locationId === location?.id),
    [invoices, location?.id]
  );

  const branchRevenue = React.useMemo(
    () => branchInvoices.reduce((acc, inv) => acc + inv.total, 0),
    [branchInvoices]
  );

  const activeSportsCount = React.useMemo(
    () => new Set(branchStudents.map((s) => s.sportName).filter(Boolean)).size,
    [branchStudents]
  );

  const studentData = React.useMemo(() => {
    const bySport = new Map<string, number>();
    for (const s of branchStudents) {
      bySport.set(s.sportName, (bySport.get(s.sportName) ?? 0) + 1);
    }
    return Array.from(bySport.entries()).map(([name, value]) => ({ name, value }));
  }, [branchStudents]);

  const revenueByMonth = React.useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 4 }).map((_, idx) => {
      const d = subMonths(now, 3 - idx);
      return { key: format(d, 'yyyy-MM'), month: format(d, 'MMM'), revenue: 0 };
    });
    for (const inv of branchInvoices) {
      const key = format(parseISO(inv.date), 'yyyy-MM');
      const row = months.find((m) => m.key === key);
      if (row) row.revenue += inv.total;
    }
    return months;
  }, [branchInvoices]);

  const recentLogs = React.useMemo(() => {
    const studentLogs = branchStudents.slice(0, 3).map((s) => ({
      action: 'Student profile active',
      time: formatDistanceToNow(parseISO(s.joinedAt), { addSuffix: true }),
      user: s.name,
    }));

    const invoiceLogs = branchInvoices.slice(0, 3).map((inv) => ({
      action: 'Invoice generated',
      time: formatDistanceToNow(parseISO(inv.date), { addSuffix: true }),
      user: inv.studentName,
    }));

    return [...invoiceLogs, ...studentLogs].slice(0, 5);
  }, [branchInvoices, branchStudents]);

  const creationDateLabel = React.useMemo(() => {
    const raw = locationMeta?.createdAt || locationMeta?.created_at;
    if (!raw) return 'Not available';
    return formatDateDMY(raw, 'Not available');
  }, [locationMeta?.createdAt, locationMeta?.created_at]);

  const planTypeLabel = locationMeta?.planType || locationMeta?.plan_type || 'Not available';
  const statusLabel = locationMeta?.status || 'unknown';
  const statusClassName = statusLabel.toLowerCase() === 'active'
    ? 'bg-green-100 text-green-700'
    : 'bg-amber-100 text-amber-700';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">{location.name}</h1>
          <p className="text-gray-500 font-medium">Branch Intelligence & Control Panel</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Branch Overview Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Students</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-gray-900">{branchStudents.length}</h3>
                <Users className="w-5 h-5 text-indigo-500" />
              </div>
            </Card>
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Revenue</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-gray-900">₹{branchRevenue.toLocaleString()}</h3>
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </Card>
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Active Sports</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-gray-900">{activeSportsCount}</h3>
                <Target className="w-5 h-5 text-amber-500" />
              </div>
            </Card>
          </div>

          {/* Revenue Performance */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                Revenue Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueByMonth}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: '#94a3b8' }}
                      tickFormatter={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`}
                    />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }} />
                    <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Demographics */}
          <div className="grid grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base font-bold">Sport Distribution</CardTitle>
              </CardHeader>
              <CardContent className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={studentData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                      {studentData.map((_, i) => <Cell key={i} fill={SPORT_COLORS[i % SPORT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base font-bold">Branch Access Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Creation Date</span>
                  <span className="text-sm font-bold">{creationDateLabel}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Plan Type</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700">{planTypeLabel}</Badge>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-500">Status</span>
                  <Badge className={statusClassName}>{statusLabel}</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-8">
          {/* Credential Management */}
          <Card className="glass-card border-indigo-100">
            <CardHeader className="bg-indigo-50/50">
              <CardTitle className="text-lg font-bold flex items-center gap-2 text-indigo-900">
                <Key className="w-5 h-5" />
                Branch Access
              </CardTitle>
              <CardDescription>View and manage credentials for this location.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-gray-500 flex items-center gap-2">
                   <Mail className="w-3 h-3" /> Branch Admin Email
                </Label>
                <div className="flex gap-2">
                  <Input readOnly value={location.email} className="h-10 bg-gray-50 font-medium" />
                  <Button variant="outline" size="sm" onClick={() => {
                    navigator.clipboard.writeText(location.email);
                    toast.success('Email copied to clipboard');
                  }}>Copy</Button>
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Security Controls</p>
                <Button
                  className="w-full btn-primary h-11 shadow-indigo-100"
                  onClick={() => void handleResetPassword()}
                  disabled={isResetting || !canManageBranchSecurity || !location?.email}
                >
                  {isResetting ? 'Sending...' : 'Reset Password Link'}
                </Button>
                <Button
                  variant="outline"
                  className="w-full text-red-600 border-red-100 hover:bg-red-50 h-11"
                  onClick={() => void handleFreezeAccess()}
                  disabled={isFreezing || !canManageBranchSecurity || !location?.id}
                >
                  {isFreezing ? 'Freezing...' : 'Freeze Account Access'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log Shortlist */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-500" />
                Recent Logs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentLogs.map((log, i) => (
                <div key={i} className="flex gap-3 items-start text-xs border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
                  <div>
                    <p className="font-bold text-gray-900">{log.action}</p>
                    <p className="text-gray-500">{log.time} • by {log.user}</p>
                  </div>
                </div>
              ))}
              <Button variant="ghost" className="w-full text-indigo-600 font-bold text-xs">View Full Audit Log</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
