import React from 'react';
import { 
  Users, 
  Search, 
  Filter, 
  MoreVertical, 
  UserPlus, 
  Mail, 
  Shield, 
  MapPin,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useLocations } from '@/hooks/useData';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { createBranchManagerAccount } from '@/lib/adminManagement';
import { reportOperationalError } from '@/lib/observability';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  branch: string;
  lastActive: string;
  status: string;
};

export default function UserManagement() {
  const { data: locations } = useLocations();
  const [users, setUsers] = React.useState<AdminUserRow[]>([]);
  const [isAddAdminOpen, setIsAddAdminOpen] = React.useState(false);
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [isCreating, setIsCreating] = React.useState(false);

  React.useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return;
        const rows = data as any[];
        setUsers(
          rows.map((p) => {
            const location = locations.find((l) => l.id === (p.branch_id as string));
            const role = String(p.role || '').replace('_', ' ');
            const title = role
              .split(' ')
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ');
            return {
              id: p.id as string,
              name: (p.full_name as string) || 'Unnamed User',
              email: location?.email || 'No email available',
              role: title || 'Unknown',
              branch: location?.name || 'Global',
              lastActive: 'From auth session',
              status: ((p.status as string) || 'inactive') as string,
            };
          })
        );
      });
  }, [locations]);

  const resetCreateAdminForm = React.useCallback(() => {
    setFullName('');
    setEmail('');
    setPassword('');
    setBranchId('');
  }, []);

  const handleCreateAdmin = async () => {
    if (isCreating) return;

    if (!fullName.trim()) {
      toast.error('Full name is required.');
      return;
    }

    if (!email.trim()) {
      toast.error('Email is required.');
      return;
    }

    if (!branchId) {
      toast.error('Please select a branch.');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setIsCreating(true);
    try {
      const { userId } = await createBranchManagerAccount({
        email,
        password,
        fullName,
        branchId,
      });

      const selectedBranch = locations.find((location) => location.id === branchId);
      setUsers((prev) => [
        {
          id: userId,
          name: fullName.trim(),
          email: email.trim(),
          role: 'Branch Manager',
          branch: selectedBranch?.name || 'Unknown Branch',
          lastActive: 'Just created',
          status: 'active',
        },
        ...prev,
      ]);

      toast.success('Admin user created successfully.');
      setIsAddAdminOpen(false);
      resetCreateAdminForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create admin user.';
      reportOperationalError('superadmin.user_create', 'Failed to create admin user.', error);
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const roleDistribution = React.useMemo(() => {
    const total = users.length || 1;
    const byRole = users.reduce<Record<string, number>>((acc, u) => {
      acc[u.role] = (acc[u.role] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(byRole).map(([role, count], idx) => {
      const countNum = Number(count);
      return ({
      role,
      count: countNum,
      pct: Math.round((countNum / total) * 100),
      color: idx === 0 ? 'bg-indigo-600' : idx === 1 ? 'bg-blue-500' : 'bg-purple-600',
      });
    });
  }, [users]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">User Management</h1>
          <p className="text-gray-500 mt-1">Control access levels and manage administrator accounts for all branches.</p>
        </div>
        <Button className="btn-primary gap-2 h-11 px-6" onClick={() => setIsAddAdminOpen(true)}>
          <UserPlus className="w-5 h-5" />
          Add Admin User
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-3 glass-card">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-100">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search by name or email..." className="pl-10 h-10" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="w-4 h-4" />
                Filter
              </Button>
            </div>
          </CardHeader>
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-gray-500">User</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-gray-500">Role & Branch</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-gray-500">Last Active</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-gray-500">Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} className="hover:bg-gray-50/50 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-gray-900 flex items-center gap-1">
                        <Shield className="w-3 h-3 text-indigo-500" />
                        {user.role}
                      </p>
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        {user.branch}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">{user.lastActive}</TableCell>
                  <TableCell>
                    <Badge className={cn(
                      "status-badge",
                      user.status === 'active' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                    )}>
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="space-y-6">
          <Card className="bg-indigo-600 text-white border-none shadow-xl shadow-indigo-100">
            <CardHeader>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Access Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-indigo-200 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold">Secure Auth</p>
                  <p className="text-xs text-indigo-100">All admins must use verified corporate emails.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-indigo-200 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold">Revocation</p>
                  <p className="text-xs text-indigo-100">Suspending an account revokes access to all branch data instantly.</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base font-bold">Role Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {roleDistribution.map((r) => (
                <div className="space-y-2" key={r.role}>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 font-medium">{r.role}</span>
                    <span className="font-bold text-gray-900">{r.count}</span>
                  </div>
                  <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                    <div className={`${r.color} h-full`} style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isAddAdminOpen} onOpenChange={setIsAddAdminOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Admin User</DialogTitle>
            <DialogDescription>
              Create a branch-level admin account and assign it to a branch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-full-name">Full Name</Label>
              <Input
                id="admin-full-name"
                placeholder="e.g. John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="admin@branch.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password">Initial Password</Label>
              <Input
                id="admin-password"
                type="password"
                placeholder="Set initial password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Assign Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddAdminOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateAdmin()}
              disabled={isCreating || locations.length === 0}
            >
              {isCreating ? 'Creating...' : 'Create Admin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
