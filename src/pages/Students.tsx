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
import { useStudents, useSports, usePackages, useLocations, useStudentEnrollments } from '@/hooks/useData';
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
import { addStudentEnrollment, createStudent, updateStudent, archiveStudent } from '@/lib/dataMutations';
import type { Student, StudentEnrollment } from '@/types';
import { cn, formatDateDMY } from '@/lib/utils';
import { reportOperationalError } from '@/lib/observability';

export default function Students() {
  const pageSize = 10;
  const { data: students } = useStudents();
  const { data: sports } = useSports();
  const { data: packages } = usePackages();
  const { data: locations } = useLocations();
  const { data: studentEnrollments } = useStudentEnrollments();
  const [studentRows, setStudentRows] = React.useState<Student[]>(students);
  const [enrollmentRows, setEnrollmentRows] = React.useState<StudentEnrollment[]>(studentEnrollments);

  React.useEffect(() => {
    setStudentRows(students);
  }, [students]);

  React.useEffect(() => {
    setEnrollmentRows(studentEnrollments);
  }, [studentEnrollments]);

  const [searchTerm, setSearchTerm] = React.useState('');
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isArchiving, setIsArchiving] = React.useState(false);
  const [editingStudent, setEditingStudent] = React.useState<any>(null);
  const [existingStudentSearch, setExistingStudentSearch] = React.useState('');
  const [selectedExistingStudentId, setSelectedExistingStudentId] = React.useState<string | null>(null);
  const [studentsPage, setStudentsPage] = React.useState(1);
  const [addStudentErrors, setAddStudentErrors] = React.useState<{
    name?: string;
    sportId?: string;
    packageId?: string;
    phone?: string;
    email?: string;
  }>({});
  
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
    return packages.find(p => p.id === newStudent.packageId);
  }, [packages, newStudent.packageId]);

  const normalizePhone = (value: string) => value.replace(/\D/g, '');
  const normalizedNewPhone = normalizePhone(newStudent.phone);
  const normalizedNewEmail = newStudent.email.trim().toLowerCase();

  const existingStudentMatches = React.useMemo(() => {
    const term = existingStudentSearch.trim().toLowerCase();
    if (!term) return [];

    const searchPhone = normalizePhone(term);

    return studentRows
      .filter((student) => {
        const name = student.name.toLowerCase();
        const phone = normalizePhone(student.phone);
        const refId = (student.refId || '').toLowerCase();
        const id = student.id.toLowerCase();
        return (
          name.includes(term) ||
          refId.includes(term) ||
          id.includes(term) ||
          phone.includes(searchPhone)
        );
      })
      .slice(0, 6)
      .map((student) => {
        const name = student.name.toLowerCase();
        const phone = normalizePhone(student.phone);
        const refId = (student.refId || '').toLowerCase();
        const id = student.id.toLowerCase();

        const matchReason = name.includes(term)
          ? 'Matched by name'
          : refId.includes(term) || id.includes(term)
            ? 'Matched by student ID'
            : 'Matched by phone';

        return { student, matchReason };
      });
  }, [existingStudentSearch, studentRows]);

  const selectedExistingStudent = React.useMemo(() => {
    if (!selectedExistingStudentId) return null;
    return studentRows.find((student) => student.id === selectedExistingStudentId) ?? null;
  }, [selectedExistingStudentId, studentRows]);

  const existingStudentPackageIds = React.useMemo(() => {
    if (!selectedExistingStudent) return new Set<string>();

    const ids = new Set<string>();
    enrollmentRows
      .filter((enrollment) => enrollment.studentId === selectedExistingStudent.id)
      .forEach((enrollment) => ids.add(enrollment.packageId));

    if (selectedExistingStudent.packageId) {
      ids.add(selectedExistingStudent.packageId);
    }

    return ids;
  }, [selectedExistingStudent, enrollmentRows]);

  const packageOptionsForSelection = React.useMemo(() => {
    if (!selectedExistingStudent) return availablePackages;
    return packages.filter((pkg) => !existingStudentPackageIds.has(pkg.id));
  }, [selectedExistingStudent, packages, availablePackages, existingStudentPackageIds]);

  const handlePickExistingStudent = (student: Student) => {
    setSelectedExistingStudentId(student.id);
    setExistingStudentSearch(student.phone);
    setNewStudent((prev) => ({
      ...prev,
      name: student.name,
      phone: student.phone,
      email: student.email || '',
      packageId: '',
      sportId: '',
    }));
    toast.success(`Loaded details for ${student.name}`);
  };

  const handleSubmitStudent = async () => {
    const nextErrors: {
      name?: string;
      sportId?: string;
      packageId?: string;
      phone?: string;
      email?: string;
    } = {};

    if (!newStudent.name.trim()) {
      nextErrors.name = 'Student name is required.';
    }
    if (!selectedExistingStudent && !newStudent.sportId) {
      nextErrors.sportId = 'Sport is required.';
    }
    if (!newStudent.packageId) {
      nextErrors.packageId = 'Batch is required.';
    }
    if (!selectedExistingStudent && !newStudent.phone.trim()) {
      nextErrors.phone = 'Phone number is required.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setAddStudentErrors(nextErrors);
      toast.error('Please fill the required fields marked in red.');
      return;
    }

    setAddStudentErrors({});

    const duplicatePhoneStudent = studentRows.find((student) => {
      const samePhone = normalizePhone(student.phone) === normalizedNewPhone;
      return samePhone && student.id !== selectedExistingStudent?.id;
    });

    const duplicateEmailStudent = normalizedNewEmail
      ? studentRows.find((student) => student.email.trim().toLowerCase() === normalizedNewEmail && student.id !== selectedExistingStudent?.id)
      : null;

    if (!selectedExistingStudent && duplicatePhoneStudent) {
      setAddStudentErrors((prev) => ({ ...prev, phone: 'Phone number already exists for another student.' }));
      setSelectedExistingStudentId(duplicatePhoneStudent.id);
      setExistingStudentSearch(duplicatePhoneStudent.phone);
      setNewStudent((prev) => ({
        ...prev,
        name: duplicatePhoneStudent.name,
        phone: duplicatePhoneStudent.phone,
        email: duplicatePhoneStudent.email || '',
      }));
      toast.info('Phone number already exists. Loaded the existing student so you can update the batch instead.');
      return;
    }

    if (duplicateEmailStudent) {
      setAddStudentErrors((prev) => ({ ...prev, email: 'Email already exists for another student.' }));
      toast.error('Email already exists for another student. Use the existing student record instead of creating a duplicate.');
      return;
    }

    setIsSaving(true);
    try {
      const pkg = packages.find((item) => item.id === newStudent.packageId);
      const resolvedSportId = selectedExistingStudent
        ? (pkg?.sportId ?? newStudent.sportId)
        : newStudent.sportId;
      const sport = sports.find((item) => item.id === resolvedSportId);
      if (selectedExistingStudent) {
        await addStudentEnrollment({
          studentId: selectedExistingStudent.id,
          packageId: newStudent.packageId,
        });

        setStudentRows((prev) => prev.map((student) => student.id === selectedExistingStudent.id ? {
          ...student,
          sportId: resolvedSportId,
          sportName: sport?.name ?? student.sportName,
          packageId: newStudent.packageId,
          packageName: pkg?.name ?? student.packageName,
        } : student));

        setEnrollmentRows((prev) => {
          const alreadyTracked = prev.some((item) => item.studentId === selectedExistingStudent.id && item.packageId === newStudent.packageId);
          if (alreadyTracked || !pkg) return prev;

          return [
            ...prev,
            {
              studentId: selectedExistingStudent.id,
              packageId: newStudent.packageId,
              sportName: sport?.name ?? pkg.sportName,
              packageName: pkg.name,
              price: pkg.price,
              status: 'pending',
            },
          ];
        });

        toast.success(`Batch added for ${newStudent.name}`);
      } else {
        const created = await createStudent({
          name: newStudent.name,
          phone: newStudent.phone,
          email: newStudent.email,
          sportId: newStudent.sportId,
          packageId: newStudent.packageId,
          branchId: locations[0]?.id,
        });

        const location = locations.find((item) => item.id === created.branch_id);

        setStudentRows((prev) => [{
          id: created.id,
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
      }

      setIsAddDialogOpen(false);
      setSelectedExistingStudentId(null);
      setExistingStudentSearch('');
      setAddStudentErrors({});
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
      reportOperationalError(selectedExistingStudent ? 'student.update' : 'student.create', selectedExistingStudent ? 'Failed to update student.' : 'Failed to create student.', error, {
        name: newStudent.name,
        sportId: newStudent.sportId,
        packageId: newStudent.packageId,
      });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditProfile = (student: any) => {
    setEditingStudent({ ...student });
    setIsEditDialogOpen(true);
  };

  const editingStudentPackages = React.useMemo(() => {
    if (!editingStudent?.id) return [] as Array<{ sportName: string; packageName: string; price: number }>;

    const uniqueByPackage = new Map<string, { sportName: string; packageName: string; price: number }>();
    enrollmentRows
      .filter((enrollment) => enrollment.studentId === editingStudent.id)
      .forEach((enrollment) => {
        if (!uniqueByPackage.has(enrollment.packageId)) {
          uniqueByPackage.set(enrollment.packageId, {
            sportName: enrollment.sportName,
            packageName: enrollment.packageName,
            price: enrollment.price,
          });
        }
      });

    const values = Array.from(uniqueByPackage.values());
    if (values.length > 0) return values;

    const fallbackPackage = packages.find((pkg) => pkg.id === editingStudent.packageId);
    if (!fallbackPackage && !editingStudent.packageName) return [];

    return [{
      sportName: fallbackPackage?.sportName ?? editingStudent.sportName ?? 'Sport',
      packageName: fallbackPackage?.name ?? editingStudent.packageName ?? 'Batch',
      price: fallbackPackage?.price ?? 0,
    }];
  }, [editingStudent?.id, editingStudent?.packageId, editingStudent?.packageName, editingStudent?.sportName, enrollmentRows, packages]);

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
      reportOperationalError('student.update', 'Failed to update student.', error, {
        studentId: editingStudent.id,
      });
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
      reportOperationalError('student.archive', 'Failed to archive student.', error, {
        studentId: student.id,
      });
      toast.error(message);
    } finally {
      setIsArchiving(false);
    }
  };

  const filteredStudents = studentRows.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.phone.includes(searchTerm)
  );

  React.useEffect(() => {
    setStudentsPage(1);
  }, [searchTerm]);

  const studentsTotalPages = Math.max(1, Math.ceil(filteredStudents.length / pageSize));

  React.useEffect(() => {
    setStudentsPage((current) => Math.min(current, studentsTotalPages));
  }, [studentsTotalPages]);

  const paginatedStudents = React.useMemo(() => {
    const startIndex = (studentsPage - 1) * pageSize;
    return filteredStudents.slice(startIndex, startIndex + pageSize);
  }, [filteredStudents, studentsPage]);

  const getStudentSports = (studentId: string, fallbackSportName: string) => {
    const sportsForStudent = enrollmentRows
      .filter((enrollment) => enrollment.studentId === studentId)
      .map((enrollment) => enrollment.sportName)
      .filter(Boolean);

    return Array.from(new Set(sportsForStudent)).length > 0
      ? Array.from(new Set(sportsForStudent))
      : fallbackSportName
        ? [fallbackSportName]
        : [];
  };

  const getStudentPackages = (studentId: string, fallbackPackageName: string) => {
    const packagesForStudent = enrollmentRows
      .filter((enrollment) => enrollment.studentId === studentId)
      .map((enrollment) => enrollment.packageName)
      .filter(Boolean);

    const uniquePackages = Array.from(new Set(packagesForStudent));
    return uniquePackages.length > 0
      ? uniquePackages
      : fallbackPackageName
        ? [fallbackPackageName]
        : [];
  };

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
                <DialogTitle className="text-2xl font-display font-bold text-slate-900">{selectedExistingStudent ? 'Update Student Batch' : 'Add New Student'}</DialogTitle>
                {!selectedExistingStudent && (
                  <DialogDescription className="text-slate-500">
                    Register a new student and enroll them in a batch.
                  </DialogDescription>
                )}
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="existing-student-search" className="text-xs font-bold uppercase text-slate-500">Existing Student (Optional)</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      id="existing-student-search"
                      placeholder="Search by name, student ID, or phone"
                      value={existingStudentSearch}
                      onChange={(e) => {
                        setExistingStudentSearch(e.target.value);
                        setSelectedExistingStudentId(null);
                      }}
                      className="pl-10 h-11 rounded-xl"
                    />
                  </div>

                  {existingStudentSearch.trim() && selectedExistingStudentId === null && (
                    <div className="rounded-xl border border-slate-200 bg-white max-h-44 overflow-y-auto">
                      {existingStudentMatches.length > 0 ? (
                        existingStudentMatches.map(({ student, matchReason }) => (
                          <button
                            type="button"
                            key={student.id}
                            onClick={() => handlePickExistingStudent(student)}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0"
                          >
                            <p className="text-sm font-semibold text-slate-800">{student.name}</p>
                            <p className="text-xs text-slate-500">{student.phone}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">{matchReason}</p>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-slate-500">No student found for this search.</p>
                      )}
                    </div>
                  )}

                  {selectedExistingStudent && (
                    <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                      <p className="text-xs text-emerald-700">
                        Using existing student: <span className="font-bold">{selectedExistingStudent.name}</span> ({selectedExistingStudent.refId || selectedExistingStudent.id})
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="add-name" className="text-xs font-bold uppercase text-slate-500">
                    Student Name <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      id="add-name" 
                      placeholder="Enter full name"
                      value={newStudent.name}
                      onChange={(e) => {
                        setNewStudent({...newStudent, name: e.target.value});
                        setAddStudentErrors((prev) => ({ ...prev, name: undefined }));
                      }}
                      className={cn("pl-10 h-11 rounded-xl", addStudentErrors.name && "border-red-400 focus-visible:ring-red-400")}
                      disabled={Boolean(selectedExistingStudent)}
                    />
                  </div>
                  {addStudentErrors.name && <p className="text-[11px] text-red-500">{addStudentErrors.name}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-bold uppercase text-slate-500">
                      {selectedExistingStudent ? 'Current Sport (Reference)' : (<>{'Select Sport '}<span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></>)}
                    </Label>
                    <Select 
                      value={newStudent.sportId} 
                      onValueChange={(v) => {
                        setNewStudent({...newStudent, sportId: v, packageId: ''});
                        setAddStudentErrors((prev) => ({ ...prev, sportId: undefined }));
                      }}
                      disabled={Boolean(selectedExistingStudent)}
                    >
                      <SelectTrigger className={cn("h-11 rounded-xl", addStudentErrors.sportId && "border-red-400 focus:ring-red-400")}>
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
                    {addStudentErrors.sportId && <p className="text-[11px] text-red-500">{addStudentErrors.sportId}</p>}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-bold uppercase text-slate-500">
                      {selectedExistingStudent ? 'Select New Batch (Any Sport)' : 'Select Batch'} <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span>
                    </Label>
                    <Select 
                      value={newStudent.packageId} 
                      onValueChange={(v) => {
                        if (selectedExistingStudent) {
                          const selected = packages.find((item) => item.id === v);
                          setNewStudent({
                            ...newStudent,
                            packageId: v,
                            sportId: selected?.sportId ?? newStudent.sportId,
                          });
                          return;
                        }

                        setNewStudent({...newStudent, packageId: v});
                        setAddStudentErrors((prev) => ({ ...prev, packageId: undefined }));
                      }}
                      disabled={!selectedExistingStudent && !newStudent.sportId}
                    >
                      <SelectTrigger className={cn("h-11 rounded-xl", addStudentErrors.packageId && "border-red-400 focus:ring-red-400")}>
                        <SelectValue placeholder="Select Batch">
                          {selectedPackage ? selectedPackage.name : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {packageOptionsForSelection.map(p => (
                          <SelectItem key={p.id} value={p.id}>{selectedExistingStudent ? `${p.sportName} - ${p.name}` : p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedExistingStudent && (
                      <p className="text-[11px] text-slate-400">Already enrolled batches are hidden.</p>
                    )}
                    {addStudentErrors.packageId && <p className="text-[11px] text-red-500">{addStudentErrors.packageId}</p>}
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
                    <Label htmlFor="add-phone" className="text-xs font-bold uppercase text-slate-500">Phone Number <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="add-phone" 
                        placeholder="e.g. 9876543210"
                        value={newStudent.phone}
                        onChange={(e) => {
                          setNewStudent({...newStudent, phone: e.target.value});
                          setAddStudentErrors((prev) => ({ ...prev, phone: undefined }));
                        }}
                        className={cn("pl-10 h-11 rounded-xl", addStudentErrors.phone && "border-red-400 focus-visible:ring-red-400")}
                        disabled={Boolean(selectedExistingStudent)}
                      />
                    </div>
                    {addStudentErrors.phone && <p className="text-[11px] text-red-500">{addStudentErrors.phone}</p>}
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
                        onChange={(e) => {
                          setNewStudent({...newStudent, email: e.target.value});
                          setAddStudentErrors((prev) => ({ ...prev, email: undefined }));
                        }}
                        className={cn("pl-10 h-11 rounded-xl", addStudentErrors.email && "border-red-400 focus-visible:ring-red-400")}
                        disabled={Boolean(selectedExistingStudent)}
                      />
                    </div>
                    {addStudentErrors.email && <p className="text-[11px] text-red-500">{addStudentErrors.email}</p>}
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
                <Button onClick={handleSubmitStudent} className="h-11 px-8 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95" disabled={isSaving}>{isSaving ? 'Saving...' : selectedExistingStudent ? 'Update Student' : 'Register Student'}</Button>
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
              <TableHead>Sports</TableHead>
              <TableHead>Current Batch</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedStudents.map((student) => (
              <TableRow key={student.id} className="cursor-pointer hover:bg-slate-50 transition-colors">
                <TableCell>
                  <StudentDetailSheet student={student} studentEnrollments={enrollmentRows.filter((enrollment) => enrollment.studentId === student.id)}>
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
                  <div className="flex flex-wrap gap-1.5">
                    {getStudentSports(student.id, student.sportName).map((sportName) => (
                      <Badge key={`${student.id}-${sportName}`} variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 uppercase text-[10px]">
                        {sportName}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {getStudentPackages(student.id, student.packageName).map((packageName) => (
                      <Badge key={`${student.id}-${packageName}`} variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 uppercase text-[10px]">
                        {packageName}
                      </Badge>
                    ))}
                  </div>
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3 border-t bg-slate-50/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-slate-500">
            Showing {filteredStudents.length === 0 ? 0 : (studentsPage - 1) * pageSize + 1}-{Math.min(studentsPage * pageSize, filteredStudents.length)} of {filteredStudents.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStudentsPage((page) => Math.max(1, page - 1))}
              disabled={studentsPage === 1}
            >
              Previous
            </Button>
            <span className="text-xs font-semibold text-slate-500">
              Page {studentsPage} of {studentsTotalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStudentsPage((page) => Math.min(studentsTotalPages, page + 1))}
              disabled={studentsPage === studentsTotalPages}
            >
              Next
            </Button>
          </div>
        </div>
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

              <div className="flex flex-col gap-2">
                <Label className="text-xs font-bold uppercase text-slate-500">Enrolled Batches</Label>
                <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 min-h-11">
                  {editingStudentPackages.length > 0 ? (
                    editingStudentPackages.map((pkg) => (
                      <Badge key={`${pkg.sportName}-${pkg.packageName}`} variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 text-[10px] uppercase">
                        {pkg.sportName} - {pkg.packageName} - ₹{Math.round(pkg.price).toLocaleString('en-IN')}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No batch history found.</p>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">This profile shows all sport and batch enrollments for this student.</p>
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
