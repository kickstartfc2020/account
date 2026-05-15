import React from 'react';
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  CheckCircle2, 
  XCircle,
  Clock,
  IndianRupee,
  Calendar,
  Zap,
  Trash2,
  Edit2,
  AlertCircle
} from 'lucide-react';
import { usePackages, useSports } from '@/hooks/useData';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Package } from '@/types';
import { cn } from '@/lib/utils';
import { createPackage, updatePackage, archivePackage } from '@/lib/dataMutations';
import { normalizePackageDuration, type RecurringInterval } from '@/lib/packageDuration';
import { reportOperationalError } from '@/lib/observability';

export default function Packages() {
  const pageSize = 10;
  const { data: dbPackages } = usePackages();
  const { data: sports } = useSports();
  const [packages, setPackages] = React.useState<Package[]>(() => dbPackages);

  React.useEffect(() => {
    setPackages(dbPackages);
  }, [dbPackages]);
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isArchiving, setIsArchiving] = React.useState(false);
  
  const [editingPackage, setEditingPackage] = React.useState<Package | null>(null);
  const [deletingPackage, setDeletingPackage] = React.useState<Package | null>(null);
  const [newSportId, setNewSportId] = React.useState('');
  const [newRecurringInterval, setNewRecurringInterval] = React.useState<RecurringInterval>('month');
  const [newRecurringCount, setNewRecurringCount] = React.useState('1');
  const [editRecurringInterval, setEditRecurringInterval] = React.useState<RecurringInterval>('month');
  const [editRecurringCount, setEditRecurringCount] = React.useState('1');
  const [packageType, setPackageType] = React.useState<"one-time" | "recurring">("one-time");
  const [packagesPage, setPackagesPage] = React.useState(1);

  const packagesTotalPages = Math.max(1, Math.ceil(packages.length / pageSize));

  React.useEffect(() => {
    setPackagesPage((current) => Math.min(current, packagesTotalPages));
  }, [packagesTotalPages]);

  const paginatedPackages = React.useMemo(() => {
    const startIndex = (packagesPage - 1) * pageSize;
    return packages.slice(startIndex, startIndex + pageSize);
  }, [packages, packagesPage]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const formData = new FormData(formElement);
    const name = String(formData.get('name') ?? '').trim();
    const durationMonths = Number(formData.get('duration') ?? 0);
    const amount = Number(formData.get('price') ?? 0);
    const normalizedDurationMonths = normalizePackageDuration(
      packageType,
      durationMonths,
      newRecurringInterval,
      Number(newRecurringCount)
    );

    if (!name || !newSportId || !Number.isFinite(normalizedDurationMonths) || normalizedDurationMonths <= 0 || !Number.isFinite(amount) || amount < 0) {
      toast.error('Please complete all required package fields.');
      return;
    }

    setIsSaving(true);
    try {
      const created = await createPackage({
        sportId: newSportId,
        name,
        billingType: packageType,
        durationMonths: normalizedDurationMonths,
        amount,
        gstPercent: 18,
      });

      const sport = sports.find((item) => item.id === newSportId);
      setPackages((prev) => [
        {
          id: created.id,
          name,
          sportId: newSportId,
          sportName: sport?.name ?? '',
          billingType: packageType,
          durationMonths: normalizedDurationMonths,
          price: amount,
          taxPercent: 18,
          status: 'active',
        },
        ...prev,
      ]);
      toast.success('Package created successfully!');
      setIsAddOpen(false);
      setPackageType('one-time');
      setNewSportId('');
      setNewRecurringInterval('month');
      setNewRecurringCount('1');
      formElement.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create package.';
      reportOperationalError('package.create', 'Failed to create package.', error, { name, sportId: newSportId });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditClick = (pkg: Package) => {
    setEditingPackage({ ...pkg });
    setPackageType(pkg.billingType);
    setEditRecurringInterval('month');
    setEditRecurringCount(pkg.billingType === 'recurring' ? String(pkg.durationMonths) : '1');
    setIsEditOpen(true);
  };

  const handleDeleteClick = (pkg: Package) => {
    setDeletingPackage(pkg);
    setIsDeleteOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingPackage) return;

    const normalizedDurationMonths = editingPackage.billingType === 'recurring'
      ? normalizePackageDuration(
          editingPackage.billingType,
          editingPackage.durationMonths,
          editRecurringInterval,
          Number(editRecurringCount)
        )
      : editingPackage.durationMonths;

    setIsSaving(true);
    try {
      await updatePackage({
        id: editingPackage.id,
        sportId: editingPackage.sportId,
        name: editingPackage.name,
        billingType: editingPackage.billingType,
        durationMonths: normalizedDurationMonths,
        amount: editingPackage.price,
        gstPercent: editingPackage.taxPercent,
        status: editingPackage.status === 'active' ? 'active' : 'inactive',
      });

      setPackages((prev) => prev.map((pkg) => (pkg.id === editingPackage.id ? { ...editingPackage, durationMonths: normalizedDurationMonths } : pkg)));
      toast.success(`${editingPackage.name} updated successfully`);
      setIsEditOpen(false);
      setEditRecurringInterval('month');
      setEditRecurringCount('1');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update package.';
      reportOperationalError('package.update', 'Failed to update package.', error, { packageId: editingPackage.id });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingPackage) return;

    setIsArchiving(true);
    try {
      await archivePackage(deletingPackage.id);
      setPackages((prev) => prev.filter((pkg) => pkg.id !== deletingPackage.id));
      toast.info(`${deletingPackage.name} archived successfully`);
      setIsDeleteOpen(false);
      setDeletingPackage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive package.';
      reportOperationalError('package.archive', 'Failed to archive package.', error, { packageId: deletingPackage.id });
      toast.error(message);
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Packages</h1>
          <p className="text-slate-500">Define membership durations and pricing for your students.</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 h-11 px-6 rounded-xl shadow-lg shadow-indigo-100 transition-all active:scale-95">
              <Plus className="w-5 h-5" />
              Create Package
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold font-display">Create New Package</DialogTitle>
                <DialogDescription>
                  Set up a new membership plan for your students.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-6">
                <div className="grid gap-2">
                  <Label htmlFor="name" className="text-xs font-bold uppercase text-slate-500">Package Name</Label>
                  <Input id="name" name="name" placeholder="e.g. Badminton Gold Monthly" required />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-xs font-bold uppercase text-slate-500">Sport</Label>
                    <Select required value={newSportId} onValueChange={setNewSportId}>
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Select sport">
                          {sports.find((sport) => sport.id === newSportId)?.name ?? ''}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {sports.map(sport => (
                          <SelectItem key={sport.id} value={sport.id} label={sport.name}>{sport.name}</SelectItem>
                        ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {packageType !== 'recurring' && (
                      <div className="grid gap-2">
                        <Label htmlFor="duration" className="text-xs font-bold uppercase text-slate-500">Duration (Months)</Label>
                        <Input id="duration" name="duration" type="number" placeholder="1" defaultValue="1" min="1" className="h-11 rounded-xl" required />
                      </div>
                    )}
                  </div>

                <div className="grid gap-2">
                  <Label htmlFor="price" className="text-xs font-bold uppercase text-slate-500">Price (₹)</Label>
                    <Input id="price" name="price" type="number" placeholder="2000" className="h-11 rounded-xl" required />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase text-slate-500">Billing Type</Label>
                  <Select 
                    defaultValue="one-time" 
                    onValueChange={(v) => setPackageType(v as any)}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="one-time">One-time</SelectItem>
                      <SelectItem value="recurring">Recurring</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {packageType === "recurring" && (
                  <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100/50 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label className="text-[10px] font-bold uppercase text-indigo-600">Interval</Label>
                        <Select value={newRecurringInterval} onValueChange={(v) => setNewRecurringInterval(v as 'week' | 'month' | 'year')}>
                          <SelectTrigger className="bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="week">Week</SelectItem>
                            <SelectItem value="month">Month</SelectItem>
                            <SelectItem value="year">Year</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-[10px] font-bold uppercase text-indigo-600">Duration</Label>
                        <Input type="number" className="bg-white h-10" placeholder="1" min="1" value={newRecurringCount} onChange={(e) => setNewRecurringCount(e.target.value)} required />
                      </div>
                    </div>
                    <p className="text-[10px] text-indigo-400 mt-3 font-medium">
                      Student will be charged every X intervals indefinitely.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)} className="h-11 rounded-xl font-bold text-slate-500">Cancel</Button>
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 px-8 h-11 rounded-xl font-bold shadow-lg shadow-indigo-200" disabled={isSaving}>{isSaving ? 'Creating...' : 'Create'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50/50 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              className="pl-10 bg-white" 
              placeholder="Search packages..." 
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Package Name</TableHead>
              <TableHead>Sport</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Price (Base)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedPackages.map((pkg) => (
              <TableRow key={pkg.id} className="group hover:bg-slate-50/50 transition-colors">
                <TableCell>
                  <p className="font-bold text-slate-900 underline decoration-indigo-200 underline-offset-4">{pkg.name}</p>
                  {pkg.refId && <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{pkg.refId}</p>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-none font-medium">
                      {pkg.sportName}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>{pkg.durationMonths} {pkg.durationMonths === 1 ? 'Month' : 'Months'}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-0.5 font-bold text-slate-700">
                    <IndianRupee className="w-3 h-3" />
                    {pkg.price.toLocaleString()}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(
                    "gap-1 px-2 border-none",
                    pkg.status === 'active' ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  )}>
                    {pkg.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {pkg.status === 'active' ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                        <MoreHorizontal className="w-4 h-4 text-slate-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-xl p-1">
                      <DropdownMenuItem onClick={() => handleEditClick(pkg)} className="rounded-lg font-medium text-xs py-2 cursor-pointer">
                        <Edit2 className="w-3.5 h-3.5 mr-2 text-slate-400" />
                        Edit Package
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDeleteClick(pkg)}
                        className="rounded-lg font-bold text-xs py-2 cursor-pointer text-red-500 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Delete Package
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3 border-t bg-slate-50/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-slate-500">
            Showing {packages.length === 0 ? 0 : (packagesPage - 1) * pageSize + 1}-{Math.min(packagesPage * pageSize, packages.length)} of {packages.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPackagesPage((page) => Math.max(1, page - 1))}
              disabled={packagesPage === 1}
            >
              Previous
            </Button>
            <span className="text-xs font-semibold text-slate-500">
              Page {packagesPage} of {packagesTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPackagesPage((page) => Math.min(packagesTotalPages, page + 1))}
              disabled={packagesPage === packagesTotalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <form onSubmit={handleUpdate}>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold font-display">Update Package</DialogTitle>
              <DialogDescription>
                Modify plan details for <span className="font-bold text-slate-900">{editingPackage?.name}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-6">
              <div className="grid gap-2">
                <Label htmlFor="edit-name" className="text-xs font-bold uppercase text-slate-500">Package Name</Label>
                <Input 
                  id="edit-name" 
                  value={editingPackage?.name || ''} 
                  onChange={(e) => editingPackage && setEditingPackage({...editingPackage, name: e.target.value})}
                  className="h-11 rounded-xl"
                  required 
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-xs font-bold uppercase text-slate-500">Sport</Label>
                  <Select 
                    value={editingPackage?.sportId} 
                    onValueChange={(v) => {
                      const sport = sports.find(s => s.id === v);
                      if (editingPackage && sport) {
                        setEditingPackage({...editingPackage, sportId: v, sportName: sport.name});
                      }
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder="Select sport">
                        {sports.find((sport) => sport.id === editingPackage?.sportId)?.name ?? ''}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {sports.map(sport => (
                        <SelectItem key={sport.id} value={sport.id} label={sport.name}>{sport.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(editingPackage?.billingType ?? packageType) !== 'recurring' && (
                  <div className="grid gap-2">
                    <Label htmlFor="edit-duration" className="text-xs font-bold uppercase text-slate-500">Duration (Months)</Label>
                    <Input 
                      id="edit-duration" 
                      type="number" 
                      value={editingPackage?.durationMonths || ''} 
                      onChange={(e) => editingPackage && setEditingPackage({...editingPackage, durationMonths: parseInt(e.target.value)})}
                      className="h-11 rounded-xl"
                      required 
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-price" className="text-xs font-bold uppercase text-slate-500">Price (₹)</Label>
                <Input 
                  id="edit-price" 
                  type="number" 
                  value={editingPackage?.price || ''} 
                        onChange={(e) => editingPackage && setEditingPackage({...editingPackage, price: parseFloat(e.target.value) || 0})}
                  className="h-11 rounded-xl"
                  required 
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase text-slate-500">Billing Type</Label>
                <Select 
                  value={editingPackage?.billingType ?? packageType}
                  onValueChange={(v) => {
                    setPackageType(v as any);
                    if (editingPackage) setEditingPackage({ ...editingPackage, billingType: v as 'one-time' | 'recurring' });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="one-time">One-time</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(editingPackage?.billingType ?? packageType) === "recurring" && (
                <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100/50 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label className="text-[10px] font-bold uppercase text-indigo-600">Interval</Label>
                      <Select value={editRecurringInterval} onValueChange={(v) => setEditRecurringInterval(v as RecurringInterval)}>
                        <SelectTrigger className="bg-white rounded-lg h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="week">Week</SelectItem>
                          <SelectItem value="month">Month</SelectItem>
                          <SelectItem value="year">Year</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-[10px] font-bold uppercase text-indigo-600">Duration</Label>
                      <Input type="number" className="bg-white h-9 rounded-lg" placeholder="1" min="1" value={editRecurringCount} onChange={(e) => setEditRecurringCount(e.target.value)} />
                    </div>
                  </div>
                  <p className="text-[10px] text-indigo-400 mt-3 font-medium">
                    Student will be charged every X intervals indefinitely.
                  </p>
                </div>
              )}

              <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase text-slate-500">Status</Label>
                <Select 
                  value={editingPackage?.status} 
                  onValueChange={(v: 'active' | 'inactive') => editingPackage && setEditingPackage({...editingPackage, status: v})}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-3">
              <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} className="h-11 rounded-xl font-bold text-slate-500">Cancel</Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 px-8 h-11 rounded-xl font-bold shadow-lg shadow-indigo-200" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl">
          <DialogHeader>
              <DialogTitle className="text-xl font-display font-bold text-slate-900">Archive Package?</DialogTitle>
            <DialogDescription className="text-slate-500 pt-2">
              Are you sure you want to archive <span className="font-bold text-slate-900">{deletingPackage?.name}</span>? 
              It will remain visible only as archived data.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </div>
          <DialogFooter className="gap-3 mt-2">
            <Button 
                variant="outline" 
                onClick={() => setIsDeleteOpen(false)}
                className="h-11 flex-1 rounded-xl font-bold text-slate-500 border-slate-200"
              >
                No, Keep it
              </Button>
              <Button 
                onClick={confirmDelete}
                disabled={isArchiving}
                className="h-11 flex-1 rounded-xl font-bold bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95"
              >
                {isArchiving ? 'Archiving...' : 'Yes, Archive'}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
