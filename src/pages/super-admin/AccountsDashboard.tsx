import React from 'react';
import { motion } from 'motion/react';
import { 
  Building2,
  Users,
  MapPin,
  TrendingUp,
  Plus,
  Search,
  ShieldCheck,
  CalendarDays,
  Mail
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLocations, useStudents, useInvoices, useStaffMembers } from '@/hooks/useData';
import { useNavigate } from 'react-router-dom';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { DateRange } from "react-day-picker";
import { createBranch, createBranchManagerAccount, uploadBranchImage } from '@/lib/adminManagement';
import { toast } from 'sonner';
import { formatDateDMY, formatDateRangeDMY } from '@/lib/utils';

export default function AccountsDashboard() {
  const { data: locations = [] } = useLocations();
  const { data: allStudents = [] } = useStudents();
  const { data: allInvoices = [] } = useInvoices();
  const { data: staffMembers = [] } = useStaffMembers();
  const [isAddLocationOpen, setIsAddLocationOpen] = React.useState(false);
  const [branchInfoLocation, setBranchInfoLocation] = React.useState<(typeof locations)[number] | null>(null);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [newBranchName, setNewBranchName] = React.useState('');
  const [newBranchEmail, setNewBranchEmail] = React.useState('');
  const [newBranchPassword, setNewBranchPassword] = React.useState('');
  const [newBranchImageFile, setNewBranchImageFile] = React.useState<File | null>(null);
  const [newBranchImagePreview, setNewBranchImagePreview] = React.useState<string>('');
  const [isCreatingBranch, setIsCreatingBranch] = React.useState(false);
  const [createdBranches, setCreatedBranches] = React.useState<typeof locations>([]);
  const navigate = useNavigate();

  const allLocations = React.useMemo(() => [...createdBranches, ...locations], [createdBranches, locations]);

  const studentCountByLocation = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of allStudents) {
      counts.set(student.locationId, (counts.get(student.locationId) ?? 0) + 1);
    }
    return counts;
  }, [allStudents]);

  const staffCountByLocation = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const staff of staffMembers) {
      if (!staff.branchId) continue;
      counts.set(staff.branchId, (counts.get(staff.branchId) ?? 0) + 1);
    }
    return counts;
  }, [staffMembers]);

  const getRegionName = React.useCallback((location: (typeof allLocations)[number]) => {
    if (!location.address) return 'unknown';
    const segments = location.address.split(',').map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return 'unknown';
    return segments[segments.length - 1].toLowerCase();
  }, []);

  const activeRegionCount = React.useMemo(() => {
    const regions = new Set<string>();
    for (const location of allLocations) {
      const region = getRegionName(location);
      if (region !== 'unknown') regions.add(region);
    }
    return regions.size;
  }, [allLocations, getRegionName]);

  React.useEffect(() => {
    return () => {
      if (newBranchImagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(newBranchImagePreview);
      }
    };
  }, [newBranchImagePreview]);

  const handleCreateBranch = async () => {
    if (isCreatingBranch) return;
    if (!newBranchName.trim()) {
      toast.error('Location name is required.');
      return;
    }
    if (!newBranchEmail.trim()) {
      toast.error('Branch manager email is required.');
      return;
    }
    if (newBranchPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    setIsCreatingBranch(true);
    try {
      const created = await createBranch({
        name: newBranchName.trim(),
        email: newBranchEmail.trim(),
      });

      let imageUrl: string | undefined;
      if (newBranchImageFile) {
        try {
          imageUrl = await uploadBranchImage(created.id, newBranchImageFile);
        } catch (imageError) {
          const imageMessage =
            typeof imageError === 'object' && imageError !== null && 'message' in imageError
              ? String((imageError as { message?: unknown }).message ?? 'Failed to upload branch image.')
              : 'Failed to upload branch image.';
          toast.warning(imageMessage);
        }
      }

      let managerCreated = false;
      let managerErrorMessage: string | null = null;
      try {
        await createBranchManagerAccount({
          email: newBranchEmail.trim(),
          password: newBranchPassword,
          fullName: `${newBranchName.trim()} Manager`,
          branchId: created.id,
        });
        managerCreated = true;
      } catch (managerError) {
        managerErrorMessage =
          typeof managerError === 'object' && managerError !== null && 'message' in managerError
            ? String((managerError as { message?: unknown }).message ?? 'Failed to create manager account.')
            : 'Failed to create manager account.';
      }

      setCreatedBranches((prev) => [
        {
          id: created.id,
          refId: '',
          name: created.name,
          address: '',
          phone: '',
          email: newBranchEmail.trim(),
          studentsCount: 0,
          activeSports: [],
          revenue: 0,
          image: imageUrl,
          region: 'new',
        },
        ...prev,
      ]);

      setIsAddLocationOpen(false);
      setNewBranchName('');
      setNewBranchEmail('');
      setNewBranchPassword('');
      setNewBranchImageFile(null);
      setNewBranchImagePreview('');

      if (managerCreated) {
        toast.success('Branch and manager account created successfully.');
      } else {
        toast.warning(
          managerErrorMessage
            ? `Branch created, but manager setup failed: ${managerErrorMessage}`
            : 'Branch created, but manager setup failed.'
        );
      }
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? 'Failed to create branch.')
          : 'Failed to create branch.';
      toast.error(message);
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const stats = React.useMemo(() => {
    let filteredInvoices = allInvoices;
    let filteredStudents = allStudents;

    if (dateRange?.from) {
      const start = startOfDay(dateRange.from);
      const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);

      filteredInvoices = allInvoices.filter(inv => {
        const d = parseISO(inv.date);
        return isWithinInterval(d, { start, end });
      });

      filteredStudents = allStudents.filter(s => {
        const d = parseISO(s.joinedAt);
        return isWithinInterval(d, { start, end });
      });
    }

    const totalRevenue = filteredInvoices
      .filter((inv) => inv.status !== 'cancelled')
      .reduce((acc, inv) => acc + inv.total, 0);

    return [
      { label: 'Total Branches', value: allLocations.length.toString(), icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
      { label: dateRange ? 'Joined in Range' : 'Global Students', value: (dateRange ? filteredStudents.length : allStudents.length).toString(), icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
      { label: 'Active Regions', value: activeRegionCount.toString(), icon: MapPin, color: 'text-green-600', bg: 'bg-green-50' },
      { label: dateRange ? 'Period Revenue' : 'Total Revenue', value: `₹${Math.round(totalRevenue).toLocaleString('en-IN')}`, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    ];
  }, [dateRange, allStudents, allInvoices, activeRegionCount, allLocations.length]);

  const handleBranchImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxImageBytes = 2 * 1024 * 1024;
    if (file.size > maxImageBytes) {
      toast.error('Image must be 2MB or smaller.');
      event.currentTarget.value = '';
      return;
    }

    setNewBranchImageFile(file);
    const localPreview = URL.createObjectURL(file);
    setNewBranchImagePreview(localPreview);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Accounts Dashboard</h1>
          <p className="text-gray-500 mt-1 font-medium">Manage global branches and location-specific access.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
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
                  <span>Global Performance Range</span>
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

          <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block" />
          
          <Dialog open={isAddLocationOpen} onOpenChange={setIsAddLocationOpen}>
            <DialogTrigger asChild>
              <Button className="btn-primary gap-2 h-11 px-6">
                <Plus className="w-5 h-5" />
                Add New Location
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold font-display">Create New Branch</DialogTitle>
                <p className="text-sm text-gray-500 mt-1">Set up a new location with its own management credentials.</p>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-bold uppercase tracking-wider text-gray-500">Location Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Downtown Sports Arena"
                    className="h-11"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch-image" className="text-xs font-bold uppercase tracking-wider text-gray-500">Branch Image</Label>
                  <Input
                    id="branch-image"
                    type="file"
                    accept="image/*"
                    className="h-11"
                    onChange={handleBranchImageUpload}
                  />
                  {newBranchImagePreview ? (
                    <img src={newBranchImagePreview} alt="Branch preview" className="h-24 w-full object-cover rounded-lg border border-gray-200" />
                  ) : null}
                </div>
                <div className="p-4 bg-gray-50 rounded-xl space-y-4 border border-gray-100">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Branch Credentials</span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-[10px] font-bold text-gray-600">User Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="branch@example.com"
                      className="h-9 bg-white"
                      value={newBranchEmail}
                      onChange={(e) => setNewBranchEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pass" className="text-[10px] font-bold text-gray-600">Initial Password</Label>
                    <Input
                      id="pass"
                      type="password"
                      placeholder="Set initial password"
                      className="h-9 bg-white"
                      value={newBranchPassword}
                      onChange={(e) => setNewBranchPassword(e.target.value)}
                    />
                    <p className="text-[10px] text-gray-500">Password is set here and account is created immediately.</p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddLocationOpen(false)}>Cancel</Button>
                <Button className="btn-primary px-8" onClick={() => void handleCreateBranch()} disabled={isCreatingBranch}>
                  {isCreatingBranch ? 'Creating...' : 'Create Branch'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{stat.label}</p>
                <h3 className="text-3xl font-bold mt-2 text-gray-900">{stat.value}</h3>
              </div>
              <div className={cn("p-2 rounded-lg", stat.bg, stat.color)}>
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Locations Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold font-display text-gray-900">Active Branches</h2>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search branches..." className="pl-10 h-10 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {allLocations.map((location) => (
            <Card key={location.id} className="overflow-hidden border-gray-200 hover:shadow-lg transition-all duration-300 group">
              <div className="aspect-video relative overflow-hidden bg-gray-100">
                {location.image ? (
                  <img
                    src={location.image}
                    alt={location.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500">
                    <span className="text-xs font-bold uppercase tracking-widest">No Image</span>
                  </div>
                )}
                <div className="absolute top-4 right-4 flex gap-2">
                  <Badge className="bg-white/90 text-gray-900 backdrop-blur-sm border-none shadow-sm capitalize">
                    {getRegionName(location) === 'unknown' ? location.name : getRegionName(location)}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{location.name}</h3>
                    <p className="text-sm text-gray-500">{location.address}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs font-semibold text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                    onClick={() => navigate(`/super-admin/branch/${location.id}`)}
                  >
                    Open
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-4 py-4 border-y border-gray-100 mb-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Students</p>
                    <p className="font-bold text-gray-900">{studentCountByLocation.get(location.id) ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Admin</p>
                    <p className="text-xs font-medium text-indigo-600 truncate">{location.email || 'Not available'}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs gap-2"
                    onClick={() => navigate('/super-admin/users')}
                  >
                    Manage Staff
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-xs gap-2 bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100"
                    onClick={() => setBranchInfoLocation(location)}
                  >
                    Branch Info
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!branchInfoLocation} onOpenChange={(open) => !open && setBranchInfoLocation(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-display font-bold text-slate-900">
              {branchInfoLocation?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
              <Mail className="w-4 h-4 text-indigo-500 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Admin Email</p>
                <p className="text-sm font-medium text-gray-900">{branchInfoLocation?.email || 'Not available'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
              <Users className="w-4 h-4 text-indigo-500 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Staff</p>
                <p className="text-sm font-medium text-gray-900">
                  {branchInfoLocation ? staffCountByLocation.get(branchInfoLocation.id) ?? 0 : 0}
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
