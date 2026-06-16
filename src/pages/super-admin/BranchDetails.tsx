import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Users,
  TrendingUp,
  Mail,
  ShieldAlert,
  ArrowLeft,
  Key,
  Target,
  Trash2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { setBranchStatus, deleteBranch } from '@/lib/adminManagement';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { format, formatDistanceToNow, parseISO, subMonths } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { formatDateDMY } from '@/lib/utils';
import { reportOperationalError } from '@/lib/observability';

const SPORT_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

export default function BranchDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { data: locations = [], loading: locationsLoading } = useLocations();
  const { data: students = [] } = useStudents();
  const { data: invoices = [] } = useInvoices();
  const location = locations.find(l => l.id === id);
  const [isFreezing, setIsFreezing] = React.useState(false);
  const [isResetting, setIsResetting] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
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
      reportOperationalError('auth.password_reset', 'Failed to send branch password reset email.', error, {
        branchId: location?.id ?? null,
        email: location?.email ?? null,
      });
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

  const canDeleteBranch = canManageBranchSecurity && branchStudents.length === 0 && branchInvoices.length === 0;

  const handleDeleteBranch = async () => {
    if (!ensureSuperAdmin()) return;
    if (!location?.id) return;

    setIsDeleting(true);
    try {
      await deleteBranch(location.id);
      toast.success('Branch deleted.');
      setDeleteDialogOpen(false);
      navigate('/super-admin');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete branch.';
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const billedInvoices = React.useMemo(
    () => branchInvoices.filter((inv) => inv.status !== 'cancelled'),
    [branchInvoices]
  );

  const branchRevenue = React.useMemo(
    () => billedInvoices.reduce((acc, inv) => acc + inv.total, 0),
    [billedInvoices]
  );

  const branchCollected = React.useMemo(
    () => billedInvoices.reduce((acc, inv) => acc + (inv.total - inv.balanceAmount), 0),
    [billedInvoices]
  );

  const branchPending = React.useMemo(
    () => billedInvoices.reduce((acc, inv) => acc + inv.balanceAmount, 0),
    [billedInvoices]
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
      return { key: format(d, 'yyyy-MM'), month: format(d, 'MMM'), billed: 0, collected: 0 };
    });
    for (const inv of billedInvoices) {
      const key = format(parseISO(inv.date), 'yyyy-MM');
      const row = months.find((m) => m.key === key);
      if (row) {
        row.billed += inv.total;
        row.collected += inv.total - inv.balanceAmount;
      }
    }
    return months;
  }, [billedInvoices]);

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

  if (!location) {
    if (locationsLoading) {
      return (
        <div className="space-y-8 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <p className="text-gray-500 font-medium">Loading branch details...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-display font-bold text-gray-900 tracking-tight">Branch not found</h1>
            <p className="text-gray-500 font-medium">This branch may have been deleted or you no longer have access to it.</p>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Students</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-gray-900">{branchStudents.length}</h3>
                <Users className="w-5 h-5 text-indigo-500" />
              </div>
            </Card>
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Billed</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-gray-900">₹{branchRevenue.toLocaleString()}</h3>
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </Card>
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Collected</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-emerald-600">₹{branchCollected.toLocaleString()}</h3>
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </Card>
            <Card className="glass-card p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pending</p>
              <div className="flex items-end justify-between mt-2">
                <h3 className="text-2xl font-bold text-amber-600">₹{branchPending.toLocaleString()}</h3>
                <Target className="w-5 h-5 text-amber-500" />
              </div>
            </Card>
          </div>

          {/* Collections Performance */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                Collections Performance
              </CardTitle>
              <CardDescription>Billed amount vs. actually collected, by month.</CardDescription>
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
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0/0.1)' }}
                      formatter={(value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`}
                    />
                    <Bar dataKey="billed" name="Billed" fill="#c7d2fe" radius={[4, 4, 0, 0]} barSize={28} />
                    <Bar dataKey="collected" name="Collected" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={28} />
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
                <CardDescription>{activeSportsCount} active sport{activeSportsCount === 1 ? '' : 's'} at this branch.</CardDescription>
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
                {canManageBranchSecurity && (
                  <Button
                    variant="outline"
                    className="w-full text-red-600 border-red-200 hover:bg-red-50 h-11"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={!canDeleteBranch}
                    title={canDeleteBranch ? undefined : 'Branch can only be deleted when it has 0 students and 0 invoices.'}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Branch
                  </Button>
                )}
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

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-display font-bold text-slate-900">Delete Branch?</DialogTitle>
            <DialogDescription className="text-slate-500 pt-2">
              This will permanently delete <span className="font-bold text-slate-900">{location?.name}</span> and
              its branch-scoped sports/packages. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="h-11 px-6 rounded-xl font-bold text-slate-500 border-slate-200"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleDeleteBranch()}
              disabled={isDeleting}
              className="h-11 px-8 rounded-xl font-bold bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95"
            >
              {isDeleting ? 'Deleting...' : 'Yes, Delete Branch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
