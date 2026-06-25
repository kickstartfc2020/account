import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { resolveBranchImagesUrl } from '@/lib/storageAsset';
import type { Location, Sport, Package, Student, Invoice, Renewal, StudentStatus, GSTRate, StudentEnrollment } from '@/types';
import { differenceInDays, parseISO } from 'date-fns';
import { reportOperationalError } from '@/lib/observability';
import { parseManualInvoiceNotes } from '@/lib/manualInvoice';

function computeStudentStatus(
  expiryDate: string | null | undefined,
  joinedAt: string | null | undefined
): StudentStatus {
  if (!expiryDate || !joinedAt) return 'unknown';
  try {
    const now = new Date();
    const start = parseISO(joinedAt);
    const end = parseISO(expiryDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'unknown';
    if (now < start) return 'unknown';

    const days = differenceInDays(end, now);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'active';
  } catch {
    return 'unknown';
  }
}

const SPORT_ICON_MAP: Record<string, string> = {
  Football: 'Trophy',
  Badminton: 'Zap',
  Cricket: 'Target',
  Tennis: 'Dribbble',
};

// ── Branches / Locations ──────────────────────────────────────────────────────

let locationsCache: Location[] | null = null;

export function useLocations() {
  const [data, setData] = useState<Location[]>(locationsCache ?? []);
  const [loading, setLoading] = useState(!locationsCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;
    if (!locationsCache) setLoading(true);
    supabase
      .from('branches')
        .select('id, ref_id, name, address, phone, email, image, status')
      .neq('status', 'archived')
      .order('name')
      .then(async ({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.branches', 'Failed to load branches.', error);
          return;
        }
        const r = (rows ?? []) as any[];
        const mapped = await Promise.all(
          r.map(async (b) => ({
            id: b.id as string,
            refId: (b.ref_id ?? '') as string,
            name: b.name as string,
            address: (b.address ?? '') as string,
            phone: (b.phone ?? '') as string,
            email: (b.email ?? '') as string,
            studentsCount: 0,
            activeSports: [],
            revenue: 0,
            image: (await resolveBranchImagesUrl((b.image ?? null) as string | null)) ?? undefined,
            region: undefined,
          }))
        );

        if (!active) return;
        locationsCache = mapped;
        setData(mapped);
      });

    return () => {
      active = false;
    };
  }, []);

  return { data, loading };
}

// ── Staff / Profiles ────────────────────────────────────────────────────────

type StaffMember = { id: string; branchId: string | null; role: string; status: string };
let staffMembersCache: StaffMember[] | null = null;

export function useStaffMembers() {
  const [data, setData] = useState<StaffMember[]>(staffMembersCache ?? []);
  const [loading, setLoading] = useState(!staffMembersCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;
    if (!staffMembersCache) setLoading(true);
    supabase
      .from('profiles')
      .select('id, branch_id, role, status')
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.profiles', 'Failed to load staff.', error);
          return;
        }
        if (!active) return;
        const r = (rows ?? []) as any[];
        const mapped = r.map((p) => ({
          id: p.id as string,
          branchId: (p.branch_id ?? null) as string | null,
          role: p.role as string,
          status: (p.status as string) || 'active',
        }));
        staffMembersCache = mapped;
        setData(mapped);
      });

    return () => {
      active = false;
    };
  }, []);

  return { data, loading };
}

// ── GST Rates ────────────────────────────────────────────────────────────────

let gstRatesCache: GSTRate[] | null = null;

export function useGstRates() {
  const [data, setData] = useState<GSTRate[]>(gstRatesCache ?? []);
  const [loading, setLoading] = useState(!gstRatesCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!gstRatesCache) setLoading(true);
    supabase
      .from('gst_rates')
      .select('id, name, percentage, is_default')
      .order('is_default', { ascending: false })
      .order('percentage', { ascending: true })
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.gst_rates', 'Failed to load GST rates.', error);
          return;
        }
        const r = (rows ?? []) as any[];
        const mapped = r.map((rate) => ({
          id: rate.id as string,
          name: rate.name as string,
          percentage: Number(rate.percentage),
          isDefault: Boolean(rate.is_default),
        }));
        gstRatesCache = mapped;
        setData(mapped);
      });
  }, []);

  return { data, loading };
}

// ── Sports ────────────────────────────────────────────────────────────────────

  let sportsCache: Sport[] | null = null;

  export function useSports() {
    const [data, setData] = useState<Sport[]>(sportsCache ?? []);
    const [loading, setLoading] = useState(!sportsCache);

    useEffect(() => {
      if (!isSupabaseConfigured || !supabase) return;
      if (!sportsCache) setLoading(true);
      supabase
        .from('sports')
        .select('id, name, status')
        .is('archived_at', null)
        .order('name')
        .then(({ data: rows, error }) => {
          setLoading(false);
          if (error) {
            reportOperationalError('query.sports', 'Failed to load sports.', error);
            return;
          }
          const r = (rows ?? []) as any[];
          const mapped = r.map((s) => ({
            id: s.id as string,
            name: s.name as string,
            icon: SPORT_ICON_MAP[s.name as string] ?? 'Trophy',
            studentsCount: 0,
            packagesCount: 0,
            revenue: 0,
            status: (s.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
          }));
          sportsCache = mapped;
          setData(mapped);
        });
    }, []);

    return { data, loading };
  }

  // ── Packages ──────────────────────────────────────────────────────────────────

  let packagesCache: Package[] | null = null;

  export function usePackages() {
    const [data, setData] = useState<Package[]>(packagesCache ?? []);
    const [loading, setLoading] = useState(!packagesCache);

    useEffect(() => {
      if (!isSupabaseConfigured || !supabase) return;
      if (!packagesCache) setLoading(true);
      supabase
        .from('packages')
        .select('id, ref_id, name, sport_id, billing_type, duration_months, amount, gst_percent, status, sports(name)')
        .is('archived_at', null)
        .order('name')
        .then(({ data: rows, error }) => {
          setLoading(false);
          if (error) {
            reportOperationalError('query.packages', 'Failed to load packages.', error);
            return;
          }
          const r = (rows ?? []) as any[];
          const mapped = r.map((p) => ({
            id: p.id as string,
            refId: (p.ref_id ?? '') as string,
            name: p.name as string,
            sportId: p.sport_id as string,
            sportName: (p.sports as { name: string } | null)?.name ?? '',
            billingType: (p.billing_type === 'recurring_monthly' ? 'recurring' : 'one-time') as 'one-time' | 'recurring',
            durationMonths: p.duration_months as number,
            price: p.amount as number,
            taxPercent: p.gst_percent as number,
            status: (p.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
          }));
          packagesCache = mapped;
          setData(mapped);
        });
    }, []);

    return { data, loading };
  }

  // ── Students ──────────────────────────────────────────────────────────────────

let studentsCache: Student[] | null = null;

export function useStudents() {
  const [data, setData] = useState<Student[]>(studentsCache ?? []);
  const [loading, setLoading] = useState(!studentsCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!studentsCache) setLoading(true);
    supabase
      .from('students')
      .select(
        'id, ref_id, branch_id, current_package_id, name, phone, email, joined_at, status, branches(name), packages(id, name, sport_id, sports(name)), renewals(cycle_end, status)'
      )
      .is('archived_at', null)
      .order('name')
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.students', 'Failed to load students.', error);
          return;
        }
          const r = (rows ?? []) as any[];
          const mapped = r.map((s) => {
              const branch = s.branches as { name: string } | null;
              const pkg = s.packages as {
                id: string; name: string; sport_id: string;
                sports: { name: string } | null;
              } | null;
              const renewalArr = (s.renewals as Array<{ cycle_end: string; status: string }>) ?? [];
              const latestRenewal = renewalArr.reduce<{
                cycle_end: string;
                status: string;
              } | null>((latest, current) => {
                if (current.status === 'cancelled') return latest;
                if (!latest) return current;
                return current.cycle_end > latest.cycle_end ? current : latest;
              }, null);
              const expiryDate = latestRenewal?.cycle_end ?? null;
              return {
                id: s.id as string,
                refId: (s.ref_id ?? '') as string,
                name: s.name as string,
                phone: s.phone as string,
                email: (s.email ?? '') as string,
                locationId: s.branch_id as string,
                locationName: branch?.name ?? '',
                sportId: pkg?.sport_id ?? '',
                sportName: pkg?.sports?.name ?? '',
                packageId: (s.current_package_id ?? '') as string,
                packageName: pkg?.name ?? '',
                expiryDate: expiryDate ?? '',
                status: computeStudentStatus(expiryDate, s.joined_at as string | null | undefined),
                joinedAt: s.joined_at as string,
              };
            });
          studentsCache = mapped;
          setData(mapped);
      });
  }, []);

  return { data, loading };
}

// ── Invoices ──────────────────────────────────────────────────────────────────

let invoicesCache: Invoice[] | null = null;

export function useInvoices() {
  const [data, setData] = useState<Invoice[]>(invoicesCache ?? []);
  const [loading, setLoading] = useState(!invoicesCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const storageEventName = 'app:invoices:changed';

    const loadInvoices = () => {
      // Only show the loading state on the very first load. Refetches
      // triggered by focus/visibility/storage events (e.g. switching back
      // to this browser tab) should refresh data silently in the
      // background instead of flashing the list to empty/loading again.
      if (!invoicesCache) setLoading(true);
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, student_id, branch_id, invoice_date, status, subtotal, tax_total, discount_total, total_amount, balance_amount, notes, students(name, ref_id, email), branches(name), payments(method, status), invoice_items(description, quantity, unit_price, line_total, gst_percent)'
        )
        .is('archived_at', null)
        .order('invoice_date', { ascending: false })
        .then(({ data: rows, error }) => {
          setLoading(false);
          if (error) {
            reportOperationalError('query.invoices', 'Failed to load invoices.', error);
            return;
          }
            const r = (rows ?? []) as any[];
            const mapped =
              r.map((inv) => {
                const student = inv.students as { name: string; ref_id: string | null; email: string | null } | null;
                const branch = inv.branches as { name: string } | null;
                const payments = (inv.payments as Array<{ method: string; status: string }>) ?? [];
                const items = (inv.invoice_items as Array<{ description: string; quantity: number; unit_price: number; line_total: number; gst_percent: number | null }>) ?? [];
                const manualBillTo = parseManualInvoiceNotes(inv.notes as string | null | undefined);
                const completedPayment = payments.find((p) => p.status === 'completed');
                return {
                  id: inv.invoice_number as string,
                  studentId: inv.student_id as string,
                  studentRefId: manualBillTo ? undefined : (student?.ref_id ?? undefined),
                  studentName: manualBillTo?.name ?? (student?.name ?? ''),
                  studentEmail: manualBillTo?.email ?? (student?.email ?? undefined),
                  manualCustomerName: manualBillTo?.name,
                  manualCustomerEmail: manualBillTo?.email,
                  manualCustomerPhone: manualBillTo?.phone,
                  manualCustomerGst: manualBillTo?.gst,
                  manualCustomerPan: manualBillTo?.pan,
                  amount: inv.subtotal as number,
                  discountAmount: (inv.discount_total as number) ?? 0,
                  tax: inv.tax_total as number,
                  cgstAmount: Math.round((inv.tax_total as number) / 2 * 100) / 100,
                  sgstAmount: Math.round((inv.tax_total as number) / 2 * 100) / 100,
                  total: inv.total_amount as number,
                  status: (inv.status as Invoice['status']) ?? 'unpaid',
                  balanceAmount: (inv.balance_amount as number) ?? 0,
                  paymentMode: (completedPayment?.method ?? 'cash') as Invoice['paymentMode'],
                  date: inv.invoice_date as string,
                  locationId: inv.branch_id as string,
                  locationName: branch?.name ?? '',
                  packageName: items[0]?.description ?? '',
                  invoiceItems: items.map((item) => ({
                    description: item.description ?? '',
                    quantity: Number(item.quantity ?? 0),
                    unitPrice: Number(item.unit_price ?? 0),
                    lineTotal: Number(item.line_total ?? 0),
                    gstPercent: item.gst_percent != null ? Number(item.gst_percent) : undefined,
                  })),
                };
              });
            invoicesCache = mapped;
            setData(mapped);
        });
    };

    loadInvoices();

    const refreshListener = () => loadInvoices();
    const storageListener = (event: StorageEvent) => {
      if (event.key === storageEventName) {
        loadInvoices();
      }
    };

    window.addEventListener(storageEventName, refreshListener);
    window.addEventListener('storage', storageListener);

    return () => {
      window.removeEventListener(storageEventName, refreshListener);
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  return { data, loading };
}

// ── Renewals ──────────────────────────────────────────────────────────────────

let renewalsCache: Renewal[] | null = null;

export function useRenewals() {
  const [data, setData] = useState<Renewal[]>(renewalsCache ?? []);
  const [loading, setLoading] = useState(!renewalsCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!renewalsCache) setLoading(true);
    supabase
      .from('renewals')
      .select('id, ref_id, student_id, package_id, cycle_end, due_date, status, students(name), packages(name, sports(name))')
      .in('status', ['pending', 'overdue'])
      .order('due_date')
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.renewals', 'Failed to load renewals.', error);
          return;
        }
          const r = (rows ?? []) as any[];
          const mapped = r.map((rv) => {
              const student = rv.students as { name: string } | null;
              const pkg = rv.packages as { name: string; sports: { name: string } | null } | null;
              const daysLeft = differenceInDays(parseISO(rv.cycle_end as string), new Date());
              const status: StudentStatus =
                daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'active';
              const renewalStatus = (rv.status ?? 'pending') as NonNullable<Renewal['renewalStatus']>;
            return {
                id: rv.id as string,
                refId: (rv.ref_id ?? '') as string,
                studentId: rv.student_id as string,
                packageId: (rv.package_id ?? '') as string,
              studentName: student?.name ?? '',
              sportName: pkg?.sports?.name ?? '',
              currentPackageName: pkg?.name ?? '',
                expiryDate: rv.cycle_end as string,
              daysLeft,
              status,
              renewalStatus,
            };
            });
          renewalsCache = mapped;
          setData(mapped);
      });
  }, []);

  return { data, loading };
}

let studentEnrollmentsCache: StudentEnrollment[] | null = null;

export function useStudentEnrollments() {
  const [data, setData] = useState<StudentEnrollment[]>(studentEnrollmentsCache ?? []);
  const [loading, setLoading] = useState(!studentEnrollmentsCache);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    if (!studentEnrollmentsCache) setLoading(true);
    Promise.all([
      supabase
        .from('renewals')
        .select('student_id, package_id, status, packages(name, amount, sports(name))')
        .order('student_id'),
      supabase
        .from('invoices')
        .select('student_id, status, invoice_items(package_id, package_id, description, line_total, packages(name, amount, sports(name)))')
        .is('archived_at', null)
        .order('student_id'),
      supabase
        .from('students')
        .select('id, current_package_id, packages(name, amount, sports(name))')
        .order('id'),
    ]).then(([renewalsResult, invoicesResult, studentsResult]) => {
      setLoading(false);

      if (renewalsResult.error) {
        reportOperationalError('query.student_enrollments', 'Failed to load renewal enrollments.', renewalsResult.error);
        return;
      }

      if (invoicesResult.error) {
        reportOperationalError('query.student_enrollments', 'Failed to load invoice enrollments.', invoicesResult.error);
        return;
      }

      if (studentsResult.error) {
        reportOperationalError('query.student_enrollments', 'Failed to load student package enrollments.', studentsResult.error);
      }

      const enrollmentMap = new Map<string, StudentEnrollment>();

      const upsertEnrollment = (row: any, fallbackStatus: StudentEnrollment['status']) => {
        const packageId = row.package_id as string | undefined;
        if (!packageId) return;

        const pkg = row.packages as { name: string; amount: number; sports: { name: string } | null } | null;
        const key = `${row.student_id}:${packageId}:${pkg?.name ?? ''}`;
        const nextEnrollment: StudentEnrollment = {
          studentId: row.student_id as string,
          packageId,
          packageName: pkg?.name ?? '',
          sportName: pkg?.sports?.name ?? '',
          price: Number(pkg?.amount ?? 0),
          status: ((row.status ?? fallbackStatus) as StudentEnrollment['status']),
        };

        const existing = enrollmentMap.get(key);
        if (!existing || existing.status === 'cancelled') {
          enrollmentMap.set(key, nextEnrollment);
        }
      };

      for (const row of (renewalsResult.data ?? []) as any[]) {
        upsertEnrollment(row, 'pending');
      }

      for (const invoice of (invoicesResult.data ?? []) as any[]) {
        const invoiceItems = (invoice.invoice_items ?? []) as Array<{
          package_id: string | null;
          packages: { name: string; amount: number; sports: { name: string } | null } | null;
        }>;

        invoiceItems.forEach((item) => {
          if (!item.package_id) return;
          const key = `${invoice.student_id}:${item.package_id}:${item.packages?.name ?? ''}`;
          const nextEnrollment: StudentEnrollment = {
            studentId: invoice.student_id as string,
            packageId: item.package_id,
            packageName: item.packages?.name ?? '',
            sportName: item.packages?.sports?.name ?? '',
            price: Number(item.packages?.amount ?? 0),
            status: invoice.status === 'completed' ? 'completed' : 'pending',
          };

          const existing = enrollmentMap.get(key);
          if (!existing || existing.status !== 'completed') {
            enrollmentMap.set(key, nextEnrollment);
          }
        });
      }

      for (const student of (studentsResult.data ?? []) as any[]) {
        const packageId = student.current_package_id as string | null;
        if (!packageId) continue;

        const pkg = student.packages as { name: string; amount: number; sports: { name: string } | null } | null;
        const key = `${student.id}:${packageId}:${pkg?.name ?? ''}`;
        if (enrollmentMap.has(key)) continue;

        enrollmentMap.set(key, {
          studentId: student.id as string,
          packageId,
          packageName: pkg?.name ?? '',
          sportName: pkg?.sports?.name ?? '',
          price: Number(pkg?.amount ?? 0),
          status: 'pending',
        });
      }

      const mapped = Array.from(enrollmentMap.values());
      studentEnrollmentsCache = mapped;
      setData(mapped);
    });
  }, []);

  return { data, loading };
}
