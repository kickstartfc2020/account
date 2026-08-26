import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Plus,
  Search, 
  User, 
  Package as PackageIcon, 
  Calendar, 
  CreditCard, 
  Printer, 
  Download, 
  Share2,
  Mail,
  Phone,
  ReceiptText,
  Trash2
} from 'lucide-react';
import { useAcademyDetails } from '@/hooks/useAcademyDetails';
import { useStudents, usePackages, useSports, useLocations, useInvoices, useGstRates, useStudentEnrollments } from '@/hooks/useData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatDateDMY } from '@/lib/utils';
import { reportOperationalError } from '@/lib/observability';
import { toast } from 'sonner';
import { finalizeInvoiceWrite } from '@/lib/invoiceWrite';
import { createPackage, createSport, createStudent, updateStudentPreviousReceivedAmount } from '@/lib/dataMutations';
import { useInvoiceCalculator } from '@/hooks/useInvoiceCalculator';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { serializeManualInvoiceNotes } from '@/lib/manualInvoice';

type DraftManualItem = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isValidIndianPhone = (value: string) => /^(\+91)?[6-9]\d{9}$/.test(value.trim());

export default function CreateInvoice() {
  const { data: students } = useStudents();
  const { data: packages } = usePackages();
  const { data: sports } = useSports();
  const { data: locations } = useLocations();
  const { data: invoices } = useInvoices();
  const { data: gstRates } = useGstRates();
  const { data: studentEnrollments = [] } = useStudentEnrollments();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isManualMode = searchParams.get('mode') === 'manual';
  const sportId = searchParams.get('sportId');
  const activeSports = React.useMemo(() => sports.filter((s) => s.status === 'active' && s.name !== 'Manual Invoices'), [sports]);
  const sportFromQuery = activeSports.find((s) => s.id === sportId) ?? null;
  const sport = isManualMode ? null : (sportFromQuery ?? activeSports[0] ?? null);
  const activeSportId = isManualMode ? '' : (sport?.id ?? '');
  const activeSportName = isManualMode ? 'Manual Invoice' : (sport?.name ?? 'No Sport');
  
  const academy = useAcademyDetails();
  const defaultGstRatePercentage = React.useMemo(() => {
    const configuredDefault = gstRates.find((rate) => rate.isDefault) ?? gstRates[0];
    return configuredDefault ? String(configuredDefault.percentage) : '18';
  }, [gstRates]);
  
  const [selectedStudentId, setSelectedStudentId] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [paymentMode, setPaymentMode] = React.useState('QR');
  const [gstRate, setGstRate] = React.useState(defaultGstRatePercentage);
  const [gstInclusive, setGstInclusive] = React.useState(!isManualMode);
  const [isGenerated, setIsGenerated] = React.useState(false);
  const [generatedInvoiceNumber, setGeneratedInvoiceNumber] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isQrPaymentDialogOpen, setIsQrPaymentDialogOpen] = React.useState(false);
  const [paymentDialogStep, setPaymentDialogStep] = React.useState<'confirm' | 'partial'>('confirm');
  const [partialAmount, setPartialAmount] = React.useState('');
  const [partialReminderDate, setPartialReminderDate] = React.useState('');
  const [partialReminderNote, setPartialReminderNote] = React.useState('');
  const [amount, setAmount] = React.useState<string>('0');
  const [discount, setDiscount] = React.useState<string>('0');
  const [previousReceivedAmount, setPreviousReceivedAmount] = React.useState<string>('0');
  const [currentBranchId, setCurrentBranchId] = React.useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
  const [manualItems, setManualItems] = React.useState<DraftManualItem[]>([
    { id: crypto.randomUUID(), description: 'Manual invoice item', quantity: '1', unitPrice: '' },
  ]);
  const [manualCustomerName, setManualCustomerName] = React.useState('');
  const [manualCustomerEmail, setManualCustomerEmail] = React.useState('');
  const [manualCustomerPhone, setManualCustomerPhone] = React.useState('');
  const [manualCustomerGst, setManualCustomerGst] = React.useState('');
  const [manualCustomerPan, setManualCustomerPan] = React.useState('');
  const [manualStudentSearch, setManualStudentSearch] = React.useState('');
  const [showManualStudentDropdown, setShowManualStudentDropdown] = React.useState(false);
  const manualSearchRef = React.useRef<HTMLDivElement>(null);
  const [phoneMatchStudent, setPhoneMatchStudent] = React.useState<{ id: string; name: string; email: string; phone: string; locationId: string } | null>(null);
  const [isPhoneMatchDialogOpen, setIsPhoneMatchDialogOpen] = React.useState(false);
  const dismissedPhoneMatchRef = React.useRef<string | null>(null);
  const [manualFieldErrors, setManualFieldErrors] = React.useState<{
    name?: string;
    email?: string;
    phone?: string;
    manualItems?: string;
  }>({});
  const submitRequestKeyRef = React.useRef<string | null>(null);
  const requestKeyStorageKey = isManualMode
    ? 'invoice:create:manual:request-key'
    : 'invoice:create:sport:request-key';

  React.useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.rpc('current_branch_id').then(({ data }) => {
      setCurrentBranchId((data as string | null) ?? null);
    });
  }, []);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (manualSearchRef.current && !manualSearchRef.current.contains(e.target as Node)) {
        setShowManualStudentDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    setGstRate(defaultGstRatePercentage);
  }, [defaultGstRatePercentage]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const persisted = window.sessionStorage.getItem(requestKeyStorageKey);
    submitRequestKeyRef.current = persisted && persisted.trim() ? persisted : null;
  }, [requestKeyStorageKey]);
  
  const selectedStudent = students.find((s) => s.id === selectedStudentId);
  const selectedStudentForWrite = selectedStudent ?? null;

  // Reset student selection when sport or mode changes so previous selection never bleeds through
  React.useEffect(() => {
    setSelectedStudentId(null);
  }, [activeSportId, isManualMode]);

  const formatSafeDate = React.useCallback((value: string | null | undefined) => formatDateDMY(value, '—'), []);

  const sportFilteredStudentIds = React.useMemo(() => {
    if (isManualMode) return new Set<string>();
    const ids = new Set<string>();

    studentEnrollments.forEach((enrollment) => {
      const enrollmentPackage = packages.find((pkg) => pkg.id === enrollment.packageId);
      if (enrollmentPackage?.sportId === activeSportId) {
        ids.add(enrollment.studentId);
      }
    });

    return ids;
  }, [studentEnrollments, packages, activeSportId, isManualMode]);

  const filteredStudents = students.filter((s) => {
    const isInSportScope = isManualMode
      ? true
      : (sportFilteredStudentIds.size > 0 ? sportFilteredStudentIds.has(s.id) : s.sportId === activeSportId);
    return isInSportScope &&
      (s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.phone.includes(searchTerm));
  });

  const visibleStudents = React.useMemo(() => {
    if (searchTerm.trim()) return filteredStudents;
    return filteredStudents.slice(0, 2);
  }, [filteredStudents, searchTerm]);
  
  const studentInvoiceStatus = React.useMemo(() => {
    const map = new Map<string, 'paid' | 'pending' | 'unpaid'>();
    const totalInvoiced = new Map<string, number>();

    invoices.forEach((inv) => {
      if (inv.status === 'cancelled') return;
      totalInvoiced.set(inv.studentId, (totalInvoiced.get(inv.studentId) ?? 0) + (inv.amount ?? 0));
      const prev = map.get(inv.studentId);
      let next: 'paid' | 'pending' | 'unpaid';
      if (inv.status === 'completed' && (inv.balanceAmount ?? 0) <= 0) {
        next = 'paid';
      } else if (inv.status === 'partial' || ((inv.balanceAmount ?? 0) > 0 && inv.status !== 'unpaid')) {
        next = 'pending';
      } else {
        next = 'unpaid';
      }
      // Worst-case wins: unpaid > pending > paid
      if (!prev || next === 'unpaid' || (next === 'pending' && prev === 'paid')) {
        map.set(inv.studentId, next);
      }
    });

    // If a student's total invoiced amount is less than their package price,
    // they haven't fully paid yet — downgrade 'paid' to 'pending'.
    map.forEach((status, studentId) => {
      if (status !== 'paid') return;
      const student = students.find((s) => s.id === studentId);
      if (!student) return;
      const pkg = packages.find((p) => p.id === student.packageId);
      if (!pkg) return;
      const enrolledPrice = student.enrolledPrice ?? pkg.price;
      const netPrice = Math.max(0, enrolledPrice - (student.previousReceivedAmount ?? 0));
      if ((totalInvoiced.get(studentId) ?? 0) < netPrice) {
        map.set(studentId, 'pending');
      }
    });

    return map;
  }, [invoices, students, packages]);

  const manualStudentSearchResults = React.useMemo(() => {
    const q = manualStudentSearch.trim().toLowerCase();
    if (!q) return [];
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.phone.includes(q)
    ).slice(0, 8);
  }, [students, manualStudentSearch]);

  const handleManualPhoneBlur = React.useCallback(() => {
    if (!isManualMode) return;
    const typedPhone = manualCustomerPhone.trim();
    if (!isValidIndianPhone(typedPhone)) return;
    if (selectedStudent && selectedStudent.phone.trim() === typedPhone) return;
    if (dismissedPhoneMatchRef.current === typedPhone) return;

    const match = students.find((s) => s.phone.trim() === typedPhone);
    if (!match) return;

    setPhoneMatchStudent({
      id: match.id,
      name: match.name,
      email: match.email,
      phone: match.phone,
      locationId: match.locationId,
    });
    setIsPhoneMatchDialogOpen(true);
  }, [isManualMode, manualCustomerPhone, selectedStudent, students]);

  const studentPayments = invoices.filter(inv => inv.studentId === selectedStudentId);
  const branch =
    locations.find((location) => location.id === selectedStudentForWrite?.locationId) ??
    locations.find((location) => location.id === currentBranchId) ??
    locations[0] ??
    null;
  const studentPackage = packages.find((p) => p.id === selectedStudent?.packageId) ?? null;
  const fallbackManualPackage = React.useMemo(() => {
    return packages.find((pkg) => pkg.name.toLowerCase().includes('manual')) ?? packages[0] ?? null;
  }, [packages]);
  const fallbackManualSport = React.useMemo(() => {
    if (!fallbackManualPackage) return null;
    return sports.find((item) => item.id === fallbackManualPackage.sportId) ?? null;
  }, [sports, fallbackManualPackage]);
  const effectivePackage = isManualMode ? (fallbackManualPackage ?? studentPackage ?? null) : studentPackage;
  const effectiveSport = isManualMode ? (fallbackManualSport ?? null) : sport;
  const packageMaxAmount = effectivePackage?.price ?? null;
  const activeStudentInvoices = studentPayments.filter((inv) => inv.status !== 'cancelled');
  const outstandingBalanceAmount = activeStudentInvoices.reduce((sum, inv) => sum + Math.max(0, inv.balanceAmount ?? 0), 0);
  const totalInvoicedSubtotal = activeStudentInvoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0);
  const currentInvoiceCount = invoices.length;
  const previousReceivedAmountValue = Math.max(0, parseFloat(previousReceivedAmount || '0') || 0);
  const allowedBaseAmount = React.useMemo(() => {
    if (isManualMode) return Number.MAX_SAFE_INTEGER;
    if (!effectivePackage) return 0;
    // Use the price locked at enrollment time, not the current (possibly changed) package price.
    const packagePrice = selectedStudent?.enrolledPrice ?? effectivePackage.price;
    // Deduct installments the student already paid before this system tracked their invoices.
    const netPackagePrice = Math.max(0, packagePrice - previousReceivedAmountValue);
    if (outstandingBalanceAmount > 0) {
      return Math.min(outstandingBalanceAmount, netPackagePrice);
    }
    return Math.max(0, netPackagePrice - totalInvoicedSubtotal);
  }, [outstandingBalanceAmount, totalInvoicedSubtotal, effectivePackage, isManualMode, selectedStudent, previousReceivedAmountValue]);
  // Derived for UI messaging only — not used as a gate
  const hasFullyPaidInvoice = !isManualMode && allowedBaseAmount === 0 && activeStudentInvoices.length > 0;
  const amountExceedsAllowedAmount = isManualMode ? false : parseFloat(amount || '0') > allowedBaseAmount;

  React.useEffect(() => {
    if (selectedStudent && !isManualMode && !isGenerated) {
      setAmount(allowedBaseAmount.toString());
    }
  }, [selectedStudentId, allowedBaseAmount, selectedStudent, isManualMode, isGenerated]);

  React.useEffect(() => {
    setPreviousReceivedAmount(String(selectedStudent?.previousReceivedAmount ?? 0));
  }, [selectedStudentId, selectedStudent]);

  const validManualItems = React.useMemo(() => {
    return manualItems
      .map((item) => {
        const description = item.description.trim();
        const quantity = Math.max(0, Number(item.quantity || '0'));
        const unitPrice = Math.max(0, Number(item.unitPrice || '0'));
        const lineTotal = quantity * unitPrice;
        return { description, quantity, unitPrice, lineTotal };
      })
      .filter((item) => item.description.length > 0 && item.quantity > 0 && item.unitPrice > 0);
  }, [manualItems]);

  const manualSubtotal = React.useMemo(
    () => validManualItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [validManualItems]
  );

  const amountInput = isManualMode ? String(manualSubtotal) : amount;

  const { subtotal, discountAmount, taxableAmount, taxAmount, total, invoiceNumber, isGstInclusive } =
    useInvoiceCalculator({
      amount: amountInput,
      discount,
      gstRate,
      academyCode: academy.code,
      invoiceCount: currentInvoiceCount,
      isGstInclusive: gstInclusive,
    });

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    toast.success('Invoice downloaded as PDF');
  };

  const handleShare = (method: 'email' | 'whatsapp') => {
    toast.success(`Invoice shared via ${method}`);
  };

  const mapPaymentMethod = (mode: string): 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer' => {
    if (mode === 'Cash') return 'cash';
    if (mode === 'Bank') return 'bank_transfer';
    if (mode === 'Card') return 'card';
    return 'upi';
  };

  const handleFinalizeInvoice = async (opts?: { paidAmount: number; reminderDate?: string; reminderNote?: string }) => {
    if (!isManualMode && !sport) {
      toast.error('No sport available for invoice. Please create a sport first.');
      return;
    }

    const nextManualErrors: { name?: string; phone?: string; manualItems?: string } = {};

    if (isManualMode && !manualCustomerName.trim()) {
      nextManualErrors.name = 'Name is required.';
    }
    if (isManualMode && !isValidIndianPhone(manualCustomerPhone)) {
      nextManualErrors.phone = 'Enter a valid 10-digit phone number.';
    }
    if (isManualMode && manualSubtotal <= 0) {
      nextManualErrors.manualItems = 'At least one item must have description, quantity, and rate greater than 0.';
    }

    if (Object.keys(nextManualErrors).length > 0) {
      setManualFieldErrors(nextManualErrors);
    }

    if (isManualMode && !manualCustomerName.trim()) {
      toast.error('Name is required for manual invoices.');
      return;
    }

    if (isManualMode && !isValidIndianPhone(manualCustomerPhone)) {
      toast.error('A valid phone number is required for manual invoices.');
      return;
    }

    let packageForWrite = effectivePackage;
    let sportForWrite = effectiveSport;

    if (isManualMode) {
      try {
        if (!supabase) {
          throw new Error('Supabase is not configured.');
        }

        // Always use an active dedicated manual sport.
        let manualSport = null as { id: string; name: string; status: string; archived_at: string | null } | null;
        {
          const { data } = await (supabase.from('sports') as any)
            .select('id, name, status, archived_at')
            .eq('name', 'Manual Invoices')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          manualSport = (data ?? null) as { id: string; name: string; status: string; archived_at: string | null } | null;
        }

        if (!manualSport) {
          const createdSport = await createSport({ name: 'Manual Invoices' });
          manualSport = {
            id: createdSport.id,
            name: createdSport.name,
            status: 'active',
            archived_at: null,
          };
        } else if (manualSport.status !== 'active' || manualSport.archived_at) {
          const { error: reactivateSportError } = await (supabase.from('sports') as any)
            .update({ status: 'active', archived_at: null })
            .eq('id', manualSport.id);
          if (reactivateSportError) throw reactivateSportError;
          manualSport.status = 'active';
          manualSport.archived_at = null;
        }

        sportForWrite = {
          id: manualSport.id,
          name: manualSport.name,
        } as typeof effectiveSport;

        // Always use an active dedicated manual package bound to the manual sport.
        let manualPackage = null as { id: string; name: string; sport_id: string; status: string; archived_at: string | null } | null;
        {
          const { data } = await (supabase.from('packages') as any)
            .select('id, name, sport_id, status, archived_at')
            .eq('name', 'Manual Billing Package')
            .eq('sport_id', sportForWrite.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          manualPackage = (data ?? null) as { id: string; name: string; sport_id: string; status: string; archived_at: string | null } | null;
        }

        if (!manualPackage) {
          const createdPackage = await createPackage({
            sportId: sportForWrite.id,
            name: 'Manual Billing Package',
            billingType: 'one-time',
            durationMonths: 1,
            amount: 0,
            gstPercent: parseFloat(gstRate) || 18,
          });
          manualPackage = {
            id: createdPackage.id,
            name: 'Manual Billing Package',
            sport_id: sportForWrite.id,
            status: 'active',
            archived_at: null,
          };
        } else if (manualPackage.status !== 'active' || manualPackage.archived_at) {
          const { error: reactivatePackageError } = await (supabase.from('packages') as any)
            .update({ status: 'active', archived_at: null })
            .eq('id', manualPackage.id);
          if (reactivatePackageError) throw reactivatePackageError;
          manualPackage.status = 'active';
          manualPackage.archived_at = null;
        }

        packageForWrite = {
          id: manualPackage.id,
          name: manualPackage.name,
          sportId: manualPackage.sport_id,
        } as typeof effectivePackage;

        if (!effectiveSport || !effectivePackage) {
          toast.success('Initialized default manual sport and batch.');
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : (typeof error === 'object' && error !== null && 'message' in error)
            ? String((error as { message?: unknown }).message)
            : 'Failed to initialize manual batch context.';
        toast.error(message);
        return;
      }
    }

    if (!packageForWrite || !sportForWrite) {
      toast.error('Select a batch before finalizing.');
      return;
    }

    let studentForWrite = selectedStudentForWrite;
    if (!studentForWrite && isManualMode) {
      const branchForManualInvoice = currentBranchId ?? locations[0]?.id ?? null;
      if (!branchForManualInvoice) {
        toast.error('No branch found for manual invoice generation.');
        return;
      }

      try {
        // Reuse the existing profile for this phone number instead of trying to
        // insert a duplicate (students.phone is unique per organization).
        const existingByPhone = students.find((s) => s.phone.trim() === manualCustomerPhone.trim());

        if (existingByPhone) {
          setSelectedStudentId(existingByPhone.id);
          studentForWrite = {
            id: existingByPhone.id,
            locationId: existingByPhone.locationId,
          } as typeof selectedStudent;
        } else {
          try {
            const createdStudent = await createStudent({
              name: manualCustomerName.trim() || 'Walk-in Customer',
              phone: manualCustomerPhone.trim(),
              email: manualCustomerEmail.trim(),
              sportId: sportForWrite.id,
              packageId: packageForWrite.id,
              branchId: branchForManualInvoice,
            });

            setSelectedStudentId(createdStudent.id);
            studentForWrite = {
              id: createdStudent.id,
              locationId: createdStudent.branch_id,
            } as typeof selectedStudent;
          } catch (createError) {
            // Someone else (or a stale local cache) already created a student with this
            // phone number between our lookup above and this insert — fall back to it
            // instead of failing, since students.phone is unique per organization.
            const isDuplicatePhone =
              typeof createError === 'object' && createError !== null &&
              'code' in createError && (createError as { code?: unknown }).code === '23505';
            if (!isDuplicatePhone || !supabase) throw createError;

            const { data: existing, error: lookupError } = await supabase
              .from('students')
              .select('id, branch_id')
              .eq('phone', manualCustomerPhone.trim())
              .maybeSingle();
            if (lookupError || !existing) throw createError;

            const existingRow = existing as { id: string; branch_id: string };
            setSelectedStudentId(existingRow.id);
            studentForWrite = {
              id: existingRow.id,
              locationId: existingRow.branch_id,
            } as typeof selectedStudent;
          }
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : (typeof error === 'object' && error !== null && 'message' in error)
            ? String((error as { message?: unknown }).message)
            : 'Failed to initialize manual customer.';
        toast.error(message);
        return;
      }
    }

    if (!studentForWrite) {
      toast.error('Select a student before finalizing.');
      return;
    }

    if (isManualMode && manualSubtotal <= 0) {
      toast.error('Add at least one valid manual item with quantity and rate greater than 0.');
      return;
    }

    if (isManualMode) {
      setManualFieldErrors({});
    }

    if (!isManualMode && hasFullyPaidInvoice) {
      toast.error('This student has already paid for their batch. The base amount is locked at ₹0.');
      return;
    }

    if (!isManualMode && amountExceedsAllowedAmount) {
      toast.error(`Amount cannot exceed the available payable amount of ₹${allowedBaseAmount.toLocaleString()}.`);
      return;
    }

    if (!opts) {
      setPaymentDialogStep('confirm');
      setIsQrPaymentDialogOpen(true);
      return;
    }

    setIsQrPaymentDialogOpen(false);
    setPaymentDialogStep('confirm');
    setPartialAmount('');
    setPartialReminderDate('');
    setPartialReminderNote('');

    // Open app route synchronously from user click to avoid popup blockers and blank-tab fallbacks.
    const preparingUrl = `${window.location.origin}/invoices/view/pending?generated=1&creating=1`;
    const invoiceTab = window.open(preparingUrl, '_blank');
    if (!invoiceTab) {
      toast.error('Please allow popups to open the generated invoice in a new tab.');
      return;
    }

    setIsSaving(true);
    if (!submitRequestKeyRef.current) {
      submitRequestKeyRef.current = `inv:${studentForWrite.id}:${Date.now()}:${crypto.randomUUID()}`;
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(requestKeyStorageKey, submitRequestKeyRef.current);
      }
    }

    try {
      const result = await finalizeInvoiceWrite({
        studentId: studentForWrite.id,
        packageId: packageForWrite.id,
        sportId: sportForWrite.id,
        packageName: isManualMode ? validManualItems[0]?.description || 'Manual invoice item' : packageForWrite.name,
        sportName: isManualMode ? 'Manual Invoice' : sportForWrite.name,
        subtotal,
        discountTotal: discountAmount,
        taxableAmount,
        taxTotal: taxAmount,
        totalAmount: total,
        gstPercent: parseFloat(gstRate),
        gstInclusive,
        paymentMethod: mapPaymentMethod(paymentMode),
        paymentModeLabel: paymentMode,
        manualItems: isManualMode ? validManualItems : undefined,
        preferredBranchId: studentForWrite.locationId,
        invoiceDate,
        requestKey: submitRequestKeyRef.current,
        paidAmount: opts.paidAmount,
        reminderDate: opts.reminderDate,
        reminderNote: opts.reminderNote,
      });

      if (!isManualMode && previousReceivedAmountValue !== (selectedStudent?.previousReceivedAmount ?? 0)) {
        try {
          await updateStudentPreviousReceivedAmount(studentForWrite.id, previousReceivedAmountValue);
        } catch (error) {
          reportOperationalError('invoice.previous_received_amount', 'Failed to save previous received amount.', error, {
            studentId: studentForWrite.id,
          });
        }
      }

      if (isManualMode && supabase) {
        const manualNotes = serializeManualInvoiceNotes({
          name: manualCustomerName.trim(),
          email: manualCustomerEmail.trim(),
          phone: manualCustomerPhone.trim(),
          gst: manualCustomerGst.trim(),
          pan: manualCustomerPan.trim(),
        });

        const { error: notesError } = await supabase
          .from('invoices')
          .update({ notes: manualNotes })
          .eq('id', result.invoiceId);

        if (notesError) {
          reportOperationalError('invoice.manual_notes', 'Failed to save manual invoice bill-to details.', notesError, {
            invoiceId: result.invoiceId,
            invoiceNumber: result.invoiceNumber,
          });
        }
      }

      setIsGenerated(true);
      setGeneratedInvoiceNumber(result.invoiceNumber);
      submitRequestKeyRef.current = null;
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(requestKeyStorageKey);
      }
      toast.success('Invoice finalized and payment recorded.');
      if (!result.invoiceNumber) {
        throw new Error('Generated invoice number is missing. Please retry.');
      }
      const invoiceUrl = `${window.location.origin}/invoices/view/${encodeURIComponent(result.invoiceNumber)}?generated=1`;
      if (!invoiceTab.closed) {
        invoiceTab.location.replace(invoiceUrl);
        invoiceTab.focus();
      } else {
        window.open(invoiceUrl, '_blank');
      }
    } catch (err) {
      invoiceTab.close();
      reportOperationalError('invoice.finalize', 'Failed to finalize invoice.', err, {
        studentId: studentForWrite.id,
        packageId: packageForWrite.id,
      });
      const message = err instanceof Error ? err.message : 'Failed to finalize invoice.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const partialAmountValue = parseFloat(partialAmount || '0');
  const partialPendingAmount = Math.max(total - (Number.isFinite(partialAmountValue) ? partialAmountValue : 0), 0);

  const handlePartialPaymentConfirm = async () => {
    if (!partialAmount || partialAmountValue <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    if (partialAmountValue > total) {
      toast.error('Amount paid cannot exceed the invoice total.');
      return;
    }
    if (!partialReminderDate) {
      toast.error('A reminder date is required for a partial payment.');
      return;
    }
    await handleFinalizeInvoice({ paidAmount: partialAmountValue, reminderDate: partialReminderDate, reminderNote: partialReminderNote });
  };

  const finalizeDisabled = isManualMode
    ? isSaving || !manualCustomerName.trim() || manualSubtotal <= 0
    : isSaving || !selectedStudentForWrite || amountExceedsAllowedAmount || allowedBaseAmount === 0;

  return (
    !isManualMode && !sport ? (
      <div className="-mx-8 -my-8 flex-1 bg-white border rounded-2xl shadow-sm p-8 flex flex-col items-start justify-center gap-4">
        <h1 className="text-2xl font-display font-bold text-slate-900">Create Invoice</h1>
        <p className="text-slate-600 max-w-xl">
          No sport is available for this branch yet, so invoice creation cannot start.
        </p>
        <Button onClick={() => navigate('/sports')} className="bg-indigo-600 hover:bg-indigo-700">
          Go To Sports
        </Button>
      </div>
    ) : (
    <>
    <div className="-mx-8 -my-8 flex-1 bg-gray-50 flex flex-col rounded-2xl overflow-hidden border shadow-sm">
      {/* Header */}
      <div className="bg-white border-b px-8 py-4 flex items-center justify-between sticky top-0 z-10 print:hidden">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Button>
          <div className="h-8 w-[1px] bg-gray-200"></div>
          <div>
            <h1 className="text-xl font-bold font-display text-gray-900 tracking-tight">Create Invoice</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{activeSportName} • {branch?.name ?? 'No Branch'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-kickstart-lime/10 border-kickstart-lime/20 text-kickstart-forest" onClick={handlePrint}>
            <Printer className="w-3.5 h-3.5" />
            Print
          </Button>
          <Button variant="outline" size="sm" className="gap-2 text-xs font-bold uppercase transition-all hover:bg-emerald-50 border-emerald-100 text-emerald-600" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5" />
            PDF
          </Button>
          <div className="h-6 w-[1px] bg-gray-200 mx-1"></div>
          <Button
            className="bg-kickstart-forest text-white gap-2 h-9 px-6 text-xs font-bold uppercase hover:bg-kickstart-forest/90"
            onClick={() => void handleFinalizeInvoice()}
            disabled={finalizeDisabled}
            title={!isManualMode && hasFullyPaidInvoice ? 'Student has already paid for this batch' : !isManualMode && amountExceedsAllowedAmount ? `Amount exceeds payable limit of ₹${allowedBaseAmount.toLocaleString()}` : undefined}
          >
            {isSaving ? 'Saving...' : 'Finalize Invoice'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden text-gray-900">
        {/* Left Side: Student Selection & Info */}
        <div className="w-[400px] border-r bg-white overflow-y-auto p-6 space-y-8 print:hidden scrollbar-hide">
          {isManualMode ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Manual Customer Details</h2>
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 uppercase text-[10px]">
                  MANUAL INVOICE
                </Badge>
              </div>
              <div className="space-y-3">
                {/* Student lookup — fills form fields from existing students */}
                <div ref={manualSearchRef} className="relative">
                  <label className="text-[10px] font-bold uppercase text-gray-500">Search Existing Student</label>
                  <div className="relative mt-1.5">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <Input
                      value={manualStudentSearch}
                      onChange={(e) => {
                        setManualStudentSearch(e.target.value);
                        setShowManualStudentDropdown(true);
                      }}
                      onFocus={() => setShowManualStudentDropdown(true)}
                      placeholder="Name or phone number..."
                      className="h-11 pl-9 border-gray-200 focus:ring-indigo-500"
                    />
                  </div>
                  {showManualStudentDropdown && manualStudentSearchResults.length > 0 && (
                    <div className="absolute z-50 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                      {manualStudentSearchResults.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-indigo-50 transition-colors border-b border-gray-100 last:border-0"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setManualCustomerName(s.name);
                            setManualCustomerPhone(s.phone);
                            setManualCustomerEmail(s.email ?? '');
                            setSelectedStudentId(s.id);
                            dismissedPhoneMatchRef.current = null;
                            setManualStudentSearch('');
                            setShowManualStudentDropdown(false);
                            setManualFieldErrors((prev) => ({ ...prev, name: undefined, phone: undefined }));
                            setIsGenerated(false);
                          }}
                        >
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                            <p className="text-[11px] text-gray-500">{s.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[10px] font-bold uppercase text-gray-400 shrink-0">Customer Details</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-500">Name <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                  <Input value={manualCustomerName} onChange={(e) => { setManualCustomerName(e.target.value); setManualFieldErrors((prev) => ({ ...prev, name: undefined })); setIsGenerated(false); }} placeholder="Customer full name" className={cn("h-11 border-gray-200 focus:ring-indigo-500", manualFieldErrors.name && "border-red-400 focus:ring-red-400")} />
                  {manualFieldErrors.name && <p className="text-[11px] text-red-500">{manualFieldErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-500">Email (Optional)</label>
                  <Input type="email" value={manualCustomerEmail} onChange={(e) => { setManualCustomerEmail(e.target.value); setIsGenerated(false); }} placeholder="customer@email.com" className="h-11 border-gray-200 focus:ring-indigo-500" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-500">Phone Number <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                  <Input
                    value={manualCustomerPhone}
                    onChange={(e) => {
                      setManualCustomerPhone(e.target.value);
                      setManualFieldErrors((prev) => ({ ...prev, phone: undefined }));
                      setIsGenerated(false);
                      // Editing away from the matched number means this is no longer that customer.
                      if (selectedStudentId && e.target.value.trim() !== selectedStudent?.phone.trim()) {
                        setSelectedStudentId(null);
                      }
                    }}
                    onBlur={handleManualPhoneBlur}
                    placeholder="10-digit phone number"
                    className={cn("h-11 border-gray-200 focus:ring-indigo-500", manualFieldErrors.phone && "border-red-400 focus:ring-red-400")}
                  />
                  {manualFieldErrors.phone && <p className="text-[11px] text-red-500">{manualFieldErrors.phone}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-500">GST</label>
                  <Input value={manualCustomerGst} onChange={(e) => { setManualCustomerGst(e.target.value); setIsGenerated(false); }} placeholder="GST number" className="h-11 border-gray-200 focus:ring-indigo-500" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-gray-500">PAN</label>
                  <Input value={manualCustomerPan} onChange={(e) => { setManualCustomerPan(e.target.value); setIsGenerated(false); }} placeholder="PAN number" className="h-11 border-gray-200 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-400">Student Lookup</h2>
                <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 uppercase text-[10px]">
                  {activeSportName}
                </Badge>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input 
                  placeholder="Search name or phone..." 
                  className="pl-10 h-11 border-gray-200 focus:ring-indigo-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              
              <div className="grid gap-2">
                {visibleStudents.map(student => (
                  <button
                    key={student.id}
                    onClick={() => {
                      setSelectedStudentId(student.id);
                      setIsGenerated(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border text-left transition-all group",
                      selectedStudentId === student.id 
                        ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100" 
                        : "bg-white border-gray-100 hover:border-indigo-300 hover:bg-indigo-50/50 text-gray-900"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
                      selectedStudentId === student.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-400 group-hover:bg-kickstart-lime/20 group-hover:text-kickstart-forest"
                    )}>
                      {student.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{student.name}</p>
                      <p className={cn("text-[10px] font-medium", selectedStudentId === student.id ? "text-kickstart-lime" : "text-gray-500")}>
                        {student.phone}
                      </p>
                    </div>
                    {(() => {
                      const status = studentInvoiceStatus.get(student.id);
                      if (!status) return null;
                      const isSelected = selectedStudentId === student.id;
                      const colourClass = isSelected
                        ? 'bg-white/20 text-white'
                        : status === 'paid'
                          ? 'bg-emerald-100 text-emerald-700'
                          : status === 'pending'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-600';
                      const label = status === 'paid' ? 'Paid' : status === 'pending' ? 'Pending' : 'Unpaid';
                      return <span className={cn('text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0', colourClass)}>{label}</span>;
                    })()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="h-[1px] bg-gray-100"></div>

          {/* Invoice Configuration */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-kickstart-forest">Invoice Configuration</h2>
            <div className="grid gap-4 p-5 bg-kickstart-lime/5 rounded-2xl border border-kickstart-lime/10">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">
                    {gstInclusive ? 'Amount (₹, incl. GST)' : 'Base Amount (₹, excl. GST)'}{!isManualMode && selectedStudent && <span className="ml-1 text-gray-400 normal-case">max ₹{allowedBaseAmount.toLocaleString()}</span>}
                  </label>
                  <Input 
                    type="number" 
                    value={isManualMode ? String(manualSubtotal) : amount}
                    max={isManualMode ? undefined : allowedBaseAmount}
                    disabled={isManualMode || (!isManualMode && Boolean(selectedStudent) && allowedBaseAmount === 0)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isManualMode && allowedBaseAmount === 0) {
                        setAmount('0');
                      } else if (!isManualMode && !isNaN(val) && val > allowedBaseAmount) {
                        setAmount(allowedBaseAmount.toString());
                      } else {
                        setAmount(e.target.value);
                      }
                      setIsGenerated(false);
                    }}
                    className={cn("bg-white border-kickstart-lime/20 h-10 focus:ring-kickstart-lime", amountExceedsAllowedAmount && "border-red-400 focus:ring-red-400")}
                  />
                  {isManualMode && (
                    <p className="text-[10px] text-gray-500">
                      Auto-calculated from manual items. Item rates are treated as {gstInclusive ? 'GST-inclusive' : 'base amounts (excl. GST)'}.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">Discount (₹)</label>
                  <Input
                    type="number"
                    value={discount}
                    onChange={(e) => {
                      setDiscount(e.target.value);
                      setIsGenerated(false);
                    }}
                    className="bg-white border-kickstart-lime/20 h-10 focus:ring-kickstart-lime"
                  />
                </div>
              </div>

              {!isManualMode && selectedStudent && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">
                    Previous Received Amount (₹)
                    <span className="ml-1 text-gray-400 normal-case">installments paid before this system</span>
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={previousReceivedAmount}
                    onChange={(e) => {
                      setPreviousReceivedAmount(e.target.value);
                      setIsGenerated(false);
                    }}
                    className="bg-white border-kickstart-lime/20 h-10 focus:ring-kickstart-lime"
                  />
                  <p className="text-[10px] text-gray-500">
                    Deducted from the batch package price so the remaining payable amount stays accurate. Saved to the student's profile.
                  </p>
                </div>
              )}

              {isManualMode && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">Manual Items <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-[10px] uppercase"
                      onClick={() => {
                        setManualItems((prev) => [
                          ...prev,
                          { id: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '' },
                        ]);
                        setIsGenerated(false);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Item
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {manualItems.map((item, index) => (
                      <div key={item.id} className="grid grid-cols-12 gap-2 items-end rounded-xl border border-kickstart-lime/20 bg-white p-2">
                        <div className="col-span-6 space-y-1">
                          <label className="text-[9px] font-bold uppercase text-gray-500">Description <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                          <Input
                            value={item.description}
                            onChange={(e) => {
                              const value = e.target.value;
                              setManualItems((prev) => prev.map((row) => row.id === item.id ? { ...row, description: value } : row));
                              setManualFieldErrors((prev) => ({ ...prev, manualItems: undefined }));
                              setIsGenerated(false);
                            }}
                            className={cn("h-9", manualFieldErrors.manualItems && !item.description.trim() && "border-red-400 focus-visible:ring-red-400")}
                            placeholder="e.g. Summer camp fee"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-[9px] font-bold uppercase text-gray-500">Qty <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const value = e.target.value;
                              setManualItems((prev) => prev.map((row) => row.id === item.id ? { ...row, quantity: value } : row));
                              setManualFieldErrors((prev) => ({ ...prev, manualItems: undefined }));
                              setIsGenerated(false);
                            }}
                            className={cn("h-9", manualFieldErrors.manualItems && (Number(item.quantity || '0') || 0) <= 0 && "border-red-400 focus-visible:ring-red-400")}
                          />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <label className="text-[9px] font-bold uppercase text-gray-500">Rate <span className="ml-0.5 text-sm font-black leading-none text-red-500">*</span></label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => {
                              const value = e.target.value;
                              setManualItems((prev) => prev.map((row) => row.id === item.id ? { ...row, unitPrice: value } : row));
                              setManualFieldErrors((prev) => ({ ...prev, manualItems: undefined }));
                              setIsGenerated(false);
                            }}
                            className={cn("h-9", manualFieldErrors.manualItems && (Number(item.unitPrice || '0') || 0) <= 0 && "border-red-400 focus-visible:ring-red-400")}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={manualItems.length === 1}
                            onClick={() => {
                              if (manualItems.length === 1) return;
                              setManualItems((prev) => prev.filter((row) => row.id !== item.id));
                              setIsGenerated(false);
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-gray-500" />
                          </Button>
                        </div>
                        <div className="col-span-12 text-right text-[10px] text-gray-500 font-medium">
                          Line Total: ₹{((Number(item.quantity || '0') || 0) * (Number(item.unitPrice || '0') || 0)).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                  {manualFieldErrors.manualItems && <p className="text-[11px] text-red-500">{manualFieldErrors.manualItems}</p>}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">Invoice Date</label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => { setInvoiceDate(e.target.value); setIsGenerated(false); }}
                  className="bg-white border-kickstart-lime/20 h-10 focus:ring-kickstart-lime"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">Payment Context</label>
                  <Select 
                    value={paymentMode} 
                    onValueChange={(v) => {
                      setPaymentMode(v);
                      setIsGenerated(false);
                    }}
                  >
                    <SelectTrigger className="bg-white border-kickstart-lime/20 h-10">
                      <SelectValue placeholder="Select Mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QR">UPI/QR code</SelectItem>
                      <SelectItem value="Bank">Bank</SelectItem>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">GST %</label>
                  <Select 
                    value={gstRate} 
                    onValueChange={(v) => {
                      setGstRate(v);
                      setIsGenerated(false);
                    }}
                  >
                    <SelectTrigger className="bg-white border-kickstart-lime/20 h-10">
                      <SelectValue placeholder="GST" />
                    </SelectTrigger>
                    <SelectContent>
                      {gstRates.length > 0 ? (
                        gstRates.map((rate) => (
                          <SelectItem key={rate.id} value={String(rate.percentage)}>
                            {rate.name} ({rate.percentage}%)
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="18">GST 18%</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <Checkbox
                  checked={gstInclusive}
                  onCheckedChange={(checked) => {
                    setGstInclusive(checked === true);
                    setIsGenerated(false);
                  }}
                />
                <span className="text-[10px] font-bold uppercase text-kickstart-forest opacity-70">Inclusive of GST</span>
                <span className="text-[10px] text-gray-400 normal-case">
                  {gstInclusive ? 'Entered amount already includes GST' : 'GST will be added on top of the entered amount'}
                </span>
              </label>

              <Button
                className="w-full bg-kickstart-forest hover:bg-kickstart-forest/90 shadow-lg shadow-kickstart-forest/10 h-12 font-bold text-xs uppercase tracking-wider"
                onClick={() => void handleFinalizeInvoice()}
                disabled={finalizeDisabled}
                title={!isManualMode && hasFullyPaidInvoice ? 'Student has already paid for this batch' : !isManualMode && amountExceedsAllowedAmount ? `Amount exceeds payable limit of ₹${allowedBaseAmount.toLocaleString()}` : undefined}
              >
                {isSaving ? 'Saving...' : isGenerated ? 'Regenerate Invoice' : 'Generate Invoice'}
              </Button>
            </div>
          </div>

          <div className="h-[1px] bg-gray-100 text-transparent"> - </div>

          {!isManualMode && selectedStudent && (
            <div className="space-y-6 animate-in fade-in slide-in-from-left-2 duration-300">
              <div className="h-[1px] bg-gray-100"></div>

              {!isManualMode && hasFullyPaidInvoice ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                  <div>
                    <p className="text-xs font-bold text-amber-800">Invoice Already Exists</p>
                    <p className="text-[10px] text-amber-700 mt-0.5">This student has already paid for their batch. The base amount is locked at zero.</p>
                  </div>
                </div>
              ) : !isManualMode && outstandingBalanceAmount > 0 ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2">
                  <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                  <div>
                    <p className="text-xs font-bold text-emerald-800">Remaining Balance Available</p>
                    <p className="text-[10px] text-emerald-700 mt-0.5">This student still has ₹{outstandingBalanceAmount.toLocaleString()} payable. The base amount cannot exceed that value.</p>
                  </div>
                </div>
              ) : null}
              
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current Standing</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Plan</p>
                    <p className="text-xs font-bold text-gray-900 mt-1">{selectedStudent.packageName}</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Expires</p>
                    <p className="text-xs font-bold text-indigo-600 mt-1">{formatSafeDate(selectedStudent.expiryDate)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Payment History</h3>
                <div className="space-y-2">
                  {studentPayments.length > 0 ? studentPayments.map(inv => (
                    <div key={inv.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                      <div>
                        <p className="font-bold text-gray-900">₹{inv.total.toLocaleString()}</p>
                        <p className="text-[10px] text-gray-500">{formatDateDMY(inv.date)}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-100">Success</Badge>
                    </div>
                  )) : (
                    <p className="text-xs text-gray-400 italic text-center py-4">No past payments found</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Invoice Preview */}
        <div className="flex-1 bg-gray-100/50 px-[10px] pt-[10px] pb-0 overflow-y-auto flex flex-col items-stretch scrollbar-hide">
          <div className="w-full bg-white shadow-2xl shadow-gray-200 rounded-none overflow-hidden print:shadow-none print:rounded-none">
            {/* Invoice Top Brand Bar */}
            <div className="h-3 bg-kickstart-lime flex">
              <div className="w-1/3 h-full bg-kickstart-forest"></div>
              <div className="w-1/3 h-full bg-kickstart-lime"></div>
              <div className="w-1/3 h-full bg-kickstart-yellow"></div>
            </div>
            
            <div className="px-14 py-10 space-y-10">
              {/* Invoice Header */}
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-5">
                  <div className="w-16 h-16 rounded-xl bg-kickstart-forest flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-kickstart-forest/20 shrink-0 border-2 border-kickstart-yellow overflow-hidden">
                    {academy.logoUrl ? (
                      <img src={academy.logoUrl} alt="Organization logo" width={64} height={64} className="w-full h-full object-cover" />
                    ) : (
                      academy.logoText || '?'
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <h2 className="text-xl font-display font-black text-gray-900 uppercase tracking-tight leading-tight">{academy.name}</h2>
                    <p className="text-kickstart-forest font-bold text-xs leading-none flex items-center gap-1.5 uppercase tracking-wide">
                      <ReceiptText className="w-3.5 h-3.5 text-kickstart-lime" />
                      {branch?.name ?? 'No Branch'} Branch
                    </p>
                    <div className="pt-1.5 flex flex-col gap-0.5">
                      <p className="text-[10px] font-bold text-gray-700">{academy.code}</p>
                    </div>
                  </div>
                </div>
                
                <div className="text-right space-y-3">
                  <h1 className="text-2xl font-display font-bold text-gray-100 uppercase tracking-tight leading-none mb-1">Invoice</h1>
                  <div className="space-y-1">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Invoice Number</span>
                      <span className="text-xs font-bold text-kickstart-forest">{isGenerated ? (generatedInvoiceNumber || invoiceNumber) : '---'}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Date Issued</span>
                      <span className="text-xs font-bold text-gray-900">{formatDateDMY(invoiceDate)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tax Details Grid */}
              <div className="grid grid-cols-4 gap-4 p-6 bg-kickstart-lime/5 rounded-2xl border border-kickstart-lime/10">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-kickstart-forest/50 uppercase tracking-widest">GST Number</span>
                  <span className="text-xs font-bold text-gray-900">{academy.gstNumber || '—'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-kickstart-forest/50 uppercase tracking-widest">PAN Number</span>
                  <span className="text-xs font-bold text-gray-900">{academy.panNumber || '—'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-kickstart-forest/50 uppercase tracking-widest">Contact</span>
                  <span className="text-xs font-bold text-gray-900">{academy.phone || '—'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-kickstart-forest/50 uppercase tracking-widest">Email</span>
                  <span className="text-xs font-bold text-gray-900">{academy.email || '—'}</span>
                </div>
              </div>

              {/* To Detail & Payment Context */}
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-kickstart-forest flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-kickstart-yellow" />
                    Bill To
                  </h3>
                  {isManualMode ? (
                    <div className="p-6 rounded-2xl bg-gray-50/50 border border-gray-100 space-y-1 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-kickstart-lime/5 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
                      <p className="text-lg font-bold text-gray-900 leading-tight">{manualCustomerName || '—'}</p>
                      {manualCustomerEmail.trim() && <p className="text-sm font-medium text-gray-500">{manualCustomerEmail}</p>}
                      {manualCustomerPhone.trim() && <p className="text-sm font-medium text-gray-500">{manualCustomerPhone}</p>}
                      {(manualCustomerGst.trim() || manualCustomerPan.trim()) && (
                        <div className="pt-2 space-y-1">
                          {manualCustomerGst.trim() && <p className="text-xs text-gray-500">GST: {manualCustomerGst}</p>}
                          {manualCustomerPan.trim() && <p className="text-xs text-gray-500">PAN: {manualCustomerPan}</p>}
                        </div>
                      )}
                    </div>
                  ) : selectedStudent ? (
                    <div className="p-6 rounded-2xl bg-gray-50/50 border border-gray-100 space-y-1 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-kickstart-lime/5 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110" />
                      <p className="text-lg font-bold text-gray-900 leading-tight">{selectedStudent.name}</p>
                      <p className="text-sm font-medium text-gray-500">{selectedStudent.email}</p>
                      <p className="text-sm font-medium text-gray-500">{selectedStudent.phone}</p>
                      <div className="pt-2">
                        <Badge variant="outline" className="bg-kickstart-lime/10 text-kickstart-forest border-kickstart-lime/20 text-[10px] font-bold">
                          STUDENT ID: {selectedStudent.refId || selectedStudent.id}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-2xl">
                      <p className="text-xs text-gray-400 font-medium italic">Select a student from the sidebar</p>
                    </div>
                  )}
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-kickstart-forest flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-kickstart-yellow" />
                    Payment Context
                  </h3>
                  <div className="p-6 bg-kickstart-lime/5 rounded-2xl border border-kickstart-lime/10 space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-medium">Payment Mode</span>
                      <span className="font-bold text-gray-900 uppercase tracking-tight">{paymentMode === 'QR' ? 'UPI / QR CODE' : paymentMode}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-medium">Payment Status</span>
                      <Badge className={cn(
                        "font-bold border uppercase text-[10px] tracking-wider px-3",
                        isGenerated 
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200" 
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      )}>
                        {isGenerated ? 'Paid' : 'Pending'}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-medium">Tax Status</span>
                      <span className="font-bold text-kickstart-forest">{gstRate}% GST Applied</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-4">
                <div className="grid grid-cols-12 px-10 py-4 bg-kickstart-forest rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] text-kickstart-lime">
                  <div className="col-span-6">Item Description</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-2 text-right">Rate</div>
                  <div className="col-span-2 text-right">Amount</div>
                </div>

                {isManualMode ? (
                  validManualItems.map((item, index) => (
                    <div key={`${item.description}-${index}`} className="px-10 py-5 grid grid-cols-12 text-sm items-center border-b border-gray-50 hover:bg-gray-50/50 transition-colors rounded-xl">
                      <div className="col-span-6">
                        <p className="font-bold text-gray-900 text-base tracking-tight">{item.description}</p>
                        <p className="text-xs text-gray-400 mt-2 font-medium">Manual billing entry</p>
                      </div>
                      <div className="col-span-2 text-center font-bold text-gray-900 bg-gray-100 w-fit mx-auto px-3 py-1 rounded-lg">
                        {String(item.quantity)}
                      </div>
                      <div className="col-span-2 text-right font-medium text-gray-600">
                        ₹{fmt(item.unitPrice)}
                      </div>
                      <div className="col-span-2 text-right font-black text-gray-900 text-base">
                        ₹{fmt(item.lineTotal)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-10 py-5 grid grid-cols-12 text-sm items-center border-b border-gray-50 hover:bg-gray-50/50 transition-colors rounded-xl">
                    <div className="col-span-6">
                      <p className="font-bold text-gray-900 text-base tracking-tight">{effectivePackage?.name || 'Select Batch'}</p>
                      <p className="text-xs text-gray-400 mt-2 font-medium">{`${activeSportName} Training • ${effectivePackage?.durationMonths || 1} Month Access`}</p>
                    </div>
                    <div className="col-span-2 text-center font-bold text-gray-900 bg-gray-100 w-fit mx-auto px-3 py-1 rounded-lg">
                      01
                    </div>
                    <div className="col-span-2 text-right font-medium text-gray-600">
                      ₹{fmt(subtotal)}
                    </div>
                    <div className="col-span-2 text-right font-black text-gray-900 text-base">
                      ₹{fmt(subtotal)}
                    </div>
                  </div>
                )}

                {/* Totals */}
                <div className="flex justify-end pt-3">
                  <div className="w-full max-w-[320px] rounded-2xl bg-gray-50 p-6 space-y-3 border border-gray-100">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">
                        {isGstInclusive ? 'Package Price (incl. GST)' : 'Subtotal'}
                      </span>
                      <span className="font-bold text-gray-900 text-right">₹{fmt(subtotal)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-emerald-500 font-bold uppercase tracking-widest text-[9px]">Discount</span>
                        <span className="font-bold text-emerald-600 text-right">- ₹{fmt(discountAmount)}</span>
                      </div>
                    )}
                    {/* For inclusive GST, always show taxable breakdown. For exclusive, show only when discount applied. */}
                    {(isGstInclusive || discountAmount > 0) && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">Taxable Amount</span>
                        <span className="font-bold text-gray-900 text-right">₹{fmt(taxableAmount)}</span>
                      </div>
                    )}
                    {Number(gstRate) > 0 && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">CGST ({Number(gstRate) / 2}%)</span>
                          <span className="font-bold text-gray-900 text-right">₹{fmt(taxAmount / 2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400 font-bold uppercase tracking-widest text-[9px]">SGST ({Number(gstRate) / 2}%)</span>
                          <span className="font-bold text-gray-900 text-right">₹{fmt(taxAmount / 2)}</span>
                        </div>
                      </>
                    )}
                    <div className="pt-6 mt-2 border-t-2 border-dashed border-gray-200 flex justify-between items-end">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-kickstart-lime uppercase tracking-[0.2em] leading-none">Total Payable</span>
                        <h4 className="text-xl font-display font-bold text-kickstart-forest leading-none">Grand Total</h4>
                      </div>
                      <span className="text-xl font-display font-bold text-kickstart-forest tracking-tight">₹{fmt(total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer / Notes */}
              <div className="grid grid-cols-2 gap-16 pt-12 mt-12 border-t border-gray-100">
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-kickstart-yellow ring-4 ring-kickstart-yellow/20" />
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-900">Important Terms</h4>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                        <span className="text-kickstart-lime">01.</span>
                        This is a computer generated invoice and does not require a physical signature.
                      </p>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                        <span className="text-kickstart-lime">02.</span>
                        Batch validity starts from the date of first session.
                      </p>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-bold flex gap-2">
                        <span className="text-kickstart-lime">03.</span>
                        No refunds will be provided for early cancellations.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                   <div className="w-40 h-16 border-2 border-dashed border-kickstart-lime/20 rounded-2xl flex items-center justify-center relative overflow-hidden bg-white group">
                     <div className="absolute inset-0 bg-kickstart-lime/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                     <div className="text-[9px] font-black text-gray-200 uppercase tracking-[0.3em] rotate-12 select-none border border-gray-100 p-1.5 rounded">
                       STAMP
                     </div>
                     <div className="absolute inset-x-0 bottom-1.5 text-[7px] font-bold text-kickstart-lime opacity-40 uppercase tracking-widest">
                       Digital Seal
                     </div>
                   </div>
                   <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">Authorized Signatory</p>
                </div>
              </div>
            </div>
            
            {/* Bottom Decoration */}
            <div className="h-12 bg-kickstart-forest flex items-center justify-between px-14 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-24 h-full bg-kickstart-lime skew-x-[30deg] translate-x-12 opacity-50" />
               <div className="absolute top-0 right-0 w-12 h-full bg-kickstart-yellow skew-x-[30deg] translate-x-3 opacity-30" />
               <p className="text-[8px] font-black text-kickstart-lime uppercase tracking-[0.25em] z-10">{academy.name}</p>
              <p className="text-[8px] font-black text-white uppercase tracking-[0.4em] z-10">{branch?.name ?? 'No Branch'} Branch</p>
            </div>
        </div>

        {/* Sharing Options */}
          <div className="mt-12 flex gap-4 print:hidden">
            <Button variant="outline" className="rounded-3xl h-16 px-10 gap-4 border-white bg-white/50 backdrop-blur shadow-sm hover:shadow-md hover:border-kickstart-lime transition-all group" onClick={() => handleShare('email')}>
              <div className="p-3 bg-kickstart-lime/10 rounded-2xl group-hover:bg-kickstart-lime/20 transition-colors">
                <Mail className="w-5 h-5 text-kickstart-forest" />
              </div>
              <span className="text-sm font-bold text-gray-700">Send via Email</span>
            </Button>
            <Button variant="outline" className="rounded-3xl h-16 px-10 gap-4 border-white bg-white/50 backdrop-blur shadow-sm hover:shadow-md hover:border-emerald-300 transition-all group" onClick={() => handleShare('whatsapp')}>
              <div className="p-3 bg-emerald-50 rounded-2xl group-hover:bg-emerald-100 transition-colors">
                <Share2 className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="text-sm font-bold text-gray-700">Send via WhatsApp</span>
            </Button>
          </div>
        </div>
      </div>
    </div>

    <Dialog
      open={isPhoneMatchDialogOpen}
      onOpenChange={(open) => {
        setIsPhoneMatchDialogOpen(open);
        if (!open && phoneMatchStudent) {
          dismissedPhoneMatchRef.current = phoneMatchStudent.phone.trim();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customer already exists</DialogTitle>
          <DialogDescription>
            A customer with this phone number is already on file. You can raise a new invoice for
            them without creating a duplicate customer record.
          </DialogDescription>
        </DialogHeader>
        {phoneMatchStudent && (
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-1">
            <p className="text-sm font-bold text-gray-900">{phoneMatchStudent.name}</p>
            {phoneMatchStudent.email && <p className="text-xs text-gray-500">{phoneMatchStudent.email}</p>}
            <p className="text-xs text-gray-500">{phoneMatchStudent.phone}</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (phoneMatchStudent) {
                dismissedPhoneMatchRef.current = phoneMatchStudent.phone.trim();
              }
              setIsPhoneMatchDialogOpen(false);
            }}
          >
            Enter As New Customer
          </Button>
          <Button
            className="bg-kickstart-forest hover:bg-kickstart-forest/90"
            onClick={() => {
              if (phoneMatchStudent) {
                setManualCustomerName(phoneMatchStudent.name);
                setManualCustomerEmail(phoneMatchStudent.email);
                setManualCustomerPhone(phoneMatchStudent.phone);
                setSelectedStudentId(phoneMatchStudent.id);
                setManualFieldErrors((prev) => ({ ...prev, name: undefined, phone: undefined }));
              }
              setIsPhoneMatchDialogOpen(false);
            }}
          >
            Use This Customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={isQrPaymentDialogOpen}
      onOpenChange={(open) => {
        setIsQrPaymentDialogOpen(open);
        if (!open) {
          setPaymentDialogStep('confirm');
          setPartialAmount('');
          setPartialReminderDate('');
          setPartialReminderNote('');
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            {paymentDialogStep === 'partial'
              ? 'Enter the amount collected now. A reminder is required for the remaining balance.'
              : paymentMode === 'QR'
                ? 'Ask the customer to scan and complete payment. Once paid, click the button below to generate the invoice.'
                : 'Confirm that payment is collected. Once paid, click the button below to generate the invoice.'}
          </DialogDescription>
        </DialogHeader>

        {paymentDialogStep === 'confirm' ? (
          <>
            {paymentMode === 'QR' ? (
              <div className="rounded-2xl border border-kickstart-lime/20 bg-kickstart-lime/5 p-4 flex flex-col items-center gap-3 text-center">
                {academy.upiQrUrl ? (
                  <img
                    src={academy.upiQrUrl}
                    alt="UPI QR code"
                    width={176}
                    height={176}
                    className="w-44 h-44 rounded-xl object-cover border border-gray-200 bg-white"
                  />
                ) : (
                  <div className="w-44 h-44 rounded-xl border border-dashed border-gray-300 bg-white flex items-center justify-center text-xs font-semibold text-gray-400 px-3">
                    QR not configured
                  </div>
                )}
                <p className="text-[10px] font-black text-kickstart-lime uppercase tracking-[0.2em]">Scan with any UPI app</p>
                <p className="text-sm font-bold text-gray-900 break-all">{academy.upiId || 'UPI ID not configured'}</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-sm font-semibold text-gray-700">Payment mode: {paymentMode}</p>
              </div>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setIsQrPaymentDialogOpen(false)} disabled={isSaving}>
                  Go Back
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-kickstart-forest hover:bg-kickstart-forest/90"
                  onClick={() => void handleFinalizeInvoice({ paidAmount: total })}
                  disabled={isSaving}
                >
                  {isSaving ? 'Generating...' : 'Paid, Generate Invoice'}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                onClick={() => setPaymentDialogStep('partial')}
                disabled={isSaving}
              >
                Partial Payment
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-gray-500">Amount Paid Now</label>
                <Input
                  type="number"
                  min={0}
                  max={total}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder="0"
                />
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 flex justify-between items-center text-sm">
                <span className="text-gray-500 font-semibold">Pending Amount</span>
                <span className="font-bold text-gray-900">₹{fmt(partialPendingAmount)}</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-gray-500">
                  Set Reminder <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  value={partialReminderDate}
                  onChange={(e) => setPartialReminderDate(e.target.value)}
                />
                <p className="text-[11px] text-gray-400">Required so the pending amount is followed up on.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase text-gray-500">Note (Optional)</label>
                <Textarea
                  value={partialReminderNote}
                  onChange={(e) => setPartialReminderNote(e.target.value)}
                  placeholder="e.g. Customer will pay balance in cash on next visit"
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setPaymentDialogStep('confirm')} disabled={isSaving}>
                Back
              </Button>
              <Button
                type="button"
                className="bg-kickstart-forest hover:bg-kickstart-forest/90"
                onClick={() => void handlePartialPaymentConfirm()}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Confirm Partial Payment'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
    )
  );
}

