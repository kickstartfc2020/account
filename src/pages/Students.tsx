import React from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Download, 
  UserPlus, 
  MoreHorizontal,
  Mail,
  Phone,
  Clock,
  Calendar,
  AlertCircle,
  User,
  Hash
} from 'lucide-react';
import { useStudents, useSports, usePackages, useLocations } from '@/hooks/useData';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from 'sonner';

import { StudentDetailSheet } from '@/components/StudentDetailSheet';
import { createStudent, updateStudent, archiveStudent } from '@/lib/dataMutations';
import type { Student } from '@/types';

export default function Students() {
  const { data: students } = useStudents();
  const { data: sports } = useSports();
  const { data: packages } = usePackages();
  const { data: locations } = useLocations();
  const [studentRows, setStudentRows] = React.useState<Student[]>(students);

  React.useEffect(() => {
    setStudentRows(students);
  }, [students]);

  const [searchTerm, setSearchTerm] = React.useState('');
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isArchiving, setIsArchiving] = React.useState(false);
  const [editingStudent, setEditingStudent] = React.useState<any>(null);
  
  const [newStudent, setNewStudent] = React.useState({
    name: '',
    email: '',
    phone: '',
    sportId: '',
    packageId: '',
    startDate: '',
    endDate: ''
  });

  const availablePackages = React.useMemo(() => {
    if (!newStudent.sportId) return [];
    return packages.filter(p => p.sportId === newStudent.sportId);
  }, [newStudent.sportId, packages]);

  const selectedLocation = React.useMemo(() => {
    return locations.find(l => l.id === (newStudent as any).locationId);
  }, [(newStudent as any).locationId, locations]);

  const selectedSport = React.useMemo(() => {
    return sports.find(s => s.id === newStudent.sportId);
  }, [newStudent.sportId, sports]);

  const selectedPackage = React.useMemo(() => {
    return availablePackages.find(p => p.id === newStudent.packageId);
  }, [availablePackages, newStudent.packageId]);

  const handleAddStudent = async () => {
    if (!newStudent.name || !newStudent.sportId || !newStudent.packageId) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      const created = await createStudent({
        name: newStudent.name,
        phone: newStudent.phone,
        email: newStudent.email,
        sportId: newStudent.sportId,
        packageId: newStudent.packageId,
        branchId: locations[0]?.id,
      });

      const sport = sports.find((item) => item.id === newStudent.sportId);
      const pkg = packages.find((item) => item.id === newStudent.packageId);
      const location = locations.find((item) => item.id === created.branch_id);
      const studentId = created.id;

      setStudentRows((prev) => [{
        id: studentId,
        refId: created.ref_id ?? '',
        name: newStudent.name,
        phone: newStudent.phone,
        email: newStudent.email,
        sportId: newStudent.sportId,
        sportName: sport?.name ?? '',
        packageId: newStudent.packageId,
        packageName: pkg?.name ?? '',
        locationId: location?.id ?? '',
        locationName: location?.name ?? '',
        expiryDate: new Date().toISOString().slice(0, 10),
        status: 'active',
        joinedAt: new Date().toISOString().slice(0, 10),
      }, ...prev]);

      toast.success(`${newStudent.name} registered successfully`);
      setIsAddDialogOpen(false);
      setNewStudent({
        name: '',
        email: '',
        phone: '',
        sportId: '',
        packageId: '',
        startDate: '',
        endDate: ''
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create student.';
      console.error(error);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditProfile = (student: any) => {
    setEditingStudent({ ...student });
    setIsEditDialogOpen(true);
  };

  const handleUpdateStudent = async () => {
    if (!editingStudent) return;

    setIsSaving(true);
    try {
      await updateStudent({
        id: editingStudent.id,
        name: editingStudent.name,
        phone: editingStudent.phone,
        email: editingStudent.email,
        packageId: editingStudent.packageId || '',
      });

      setStudentRows((prev) => prev.map((student) => student.id === editingStudent.id ? editingStudent : student));
      toast.success('Student profile updated successfully');
      setIsEditDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update student.';
      console.error(error);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveStudent = async (student: Student) => {
    const confirmed = window.confirm(`Archive ${student.name}? They will remain visible as archived data.`);
    if (!confirmed) return;

    setIsArchiving(true);
    try {
      await archiveStudent(student.id);
      setStudentRows((prev) => prev.filter((row) => row.id !== student.id));
      toast.success('Student archived successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive student.';
      console.error(error);
      toast.error(message);
    } finally {
      setIsArchiving(false);
    }
  };

  const filteredStudents = studentRows.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.phone.includes(searchTerm)
  );

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Students</h1>
          <p className="text-slate-500">Manage enrollment, attendance, and student history.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2 h-11 px-6 rounded-xl font-bold text-slate-600 border-slate-200">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 h-11 px-6 rounded-xl shadow-lg shadow-indigo-100 font-bold transition-all active:scale-95">
                <UserPlus className="w-5 h-5" />
                Add Student
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-2xl font-display font-bold text-slate-900">Add New Student</DialogTitle>
                <DialogDescription className="text-slate-500">
                  Register a new student and enroll them in a package.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="add-name" className="text-xs font-bold uppercase text-slate-500">Student Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      id="add-name" 
                      placeholder="Enter full name"
                      value={newStudent.name}
                      onChange={(e) => setNewStudent({...newStudent, name: e.target.value})}
                      className="pl-10 h-11 rounded-xl"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-bold uppercase text-slate-500">Select Sport</Label>
                    <Select 
                      value={newStudent.sportId} 
                      onValueChange={(v) => setNewStudent({...newStudent, sportId: v, packageId: ''})}
                    >
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Select Sport">
                          {selectedSport ? selectedSport.name : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {sports.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-bold uppercase text-slate-500">Select Package</Label>
                    <Select 
                      value={newStudent.packageId} 
                      onValueChange={(v) => setNewStudent({...newStudent, packageId: v})}
                      disabled={!newStudent.sportId}
                    >
                      <SelectTrigger className="h-11 rounded-xl">
                        <SelectValue placeholder="Select Package">
                          {selectedPackage ? selectedPackage.name : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {availablePackages.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="start-date" className="text-xs font-bold uppercase text-slate-500">Timing Start</Label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="start-date" 
                        type="time"
                        value={newStudent.startDate}
                        onChange={(e) => setNewStudent({...newStudent, startDate: e.target.value})}
                        className="pl-10 h-11 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="end-date" className="text-xs font-bold uppercase text-slate-500">Timing End</Label>
                    <div className="relative">
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="end-date" 
                        type="time"
                        value={newStudent.endDate}
                        onChange={(e) => setNewStudent({...newStudent, endDate: e.target.value})}
                        className="pl-10 h-11 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="add-phone" className="text-xs font-bold uppercase text-slate-500">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="add-phone" 
                        placeholder="e.g. 9876543210"
                        value={newStudent.phone}
                        onChange={(e) => setNewStudent({...newStudent, phone: e.target.value})}
                        className="pl-10 h-11 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="add-email" className="text-xs font-bold uppercase text-slate-500">Email ID</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="add-email" 
                        type="email"
                        placeholder="student@example.com"
                        value={newStudent.email}
                        onChange={(e) => setNewStudent({...newStudent, email: e.target.value})}
                        className="pl-10 h-11 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {selectedPackage && (
                  <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between animate-in fade-in zoom-in duration-300">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-indigo-400 tracking-wider">Plan Summary</p>
                      <p className="text-sm font-bold text-indigo-900 mt-0.5">{selectedPackage.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-display font-bold text-indigo-600">₹{selectedPackage.price.toLocaleString()}</p>
                      <p className="text-[10px] font-medium text-indigo-500">{selectedPackage.durationMonths} Month{selectedPackage.durationMonths > 1 ? 's' : ''} Course</p>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-3">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="h-11 px-6 rounded-xl font-bold text-slate-500 border-slate-200">Cancel</Button>
                <Button onClick={handleAddStudent} className="h-11 px-8 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95" disabled={isSaving}>{isSaving ? 'Saving...' : 'Register Student'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50/50 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              className="pl-10 bg-white" 
              placeholder="Search by name or phone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" />
              Filters
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[280px]">Student Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Sport & Location</TableHead>
              <TableHead>Current Package</TableHead>
              <TableHead>Expiry Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStudents.map((student) => (
              <TableRow key={student.id} className="cursor-pointer hover:bg-slate-50 transition-colors">
                <TableCell>
                  <StudentDetailSheet student={student}>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 border">
                        <AvatarFallback className="bg-indigo-50 text-indigo-600 font-semibold">
                          {student.name.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-slate-900 leading-none">{student.name}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{student.refId || student.id}</p>
                      </div>
                    </div>
                  </StudentDetailSheet>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{student.phone}</p>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{student.sportName}</p>
                  <p className="text-xs text-slate-500">{student.locationName}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 uppercase text-[10px]">
                    {student.packageName}
                  </Badge>
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{student.expiryDate}</p>
                </TableCell>
                <TableCell>
                  <Badge className={
                    student.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                    student.status === 'expiring' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    student.status === 'unknown' ? 'bg-slate-50 text-slate-600 border-slate-100' :
                    'bg-red-50 text-red-700 border-red-100'
                  } variant="outline">
                    {student.status.charAt(0).toUpperCase() + student.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                   <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditProfile(student)}>Edit Profile</DropdownMenuItem>
                      <DropdownMenuItem>Renew Membership</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-500" onClick={() => void handleArchiveStudent(student)}>Deactivate</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-display font-bold">Edit Student Profile</DialogTitle>
          </DialogHeader>
          {editingStudent && (
            <div className="grid gap-6 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-xs font-bold uppercase text-slate-500">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    id="name" 
                    value={editingStudent.name} 
                    onChange={(e) => setEditingStudent({...editingStudent, name: e.target.value})}
                    className="pl-10 h-11"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="phone" className="text-xs font-bold uppercase text-slate-500">Phone Number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      id="phone" 
                      value={editingStudent.phone} 
                      onChange={(e) => setEditingStudent({...editingStudent, phone: e.target.value})}
                      className="pl-10 h-11"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="id" className="text-xs font-bold uppercase text-slate-500">Student ID</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      id="id" 
                      value={editingStudent.refId || editingStudent.id} 
                      disabled
                      className="pl-10 h-11 bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-xs font-bold uppercase text-slate-500">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input 
                    id="email" 
                    type="email"
                    value={editingStudent.email} 
                    onChange={(e) => setEditingStudent({...editingStudent, email: e.target.value})}
                    className="pl-10 h-11"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-3">
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="h-11 px-6 rounded-xl font-bold text-slate-500">Cancel</Button>
            <Button onClick={handleUpdateStudent} className="h-11 px-8 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
