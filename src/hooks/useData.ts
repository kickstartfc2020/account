import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Location, Sport, Package, Student, Invoice, Renewal, StudentStatus, GSTRate } from '@/types';
import { differenceInDays, parseISO } from 'date-fns';
import { reportOperationalError } from '@/lib/observability';

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

export function useLocations() {
  const [data, setData] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    supabase
      .from('branches')
        .select('id, ref_id, name, address, phone, email, image, region')
      .is('archived_at', null)
      .order('name')
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.branches', 'Failed to load branches.', error);
          return;
        }
        const r = (rows ?? []) as any[];
        setData(
          r.map((b) => ({
            id: b.id as string,
            refId: (b.ref_id ?? '') as string,
            name: b.name as string,
            address: (b.address ?? '') as string,
            phone: (b.phone ?? '') as string,
            email: (b.email ?? '') as string,
            studentsCount: 0,
            activeSports: [],
            revenue: 0,
            image: (b.image ?? undefined) as string | undefined,
            region: (b.region ?? undefined) as string | undefined,
          }))
        );
      });
  }, []);

  return { data, loading };
}

// ── GST Rates ────────────────────────────────────────────────────────────────

export function useGstRates() {
  const [data, setData] = useState<GSTRate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    supabase
      .from('gst_rates')
      .select('id, name, percentage, is_default')
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('percentage', { ascending: true })
      .then(({ data: rows, error }) => {
        setLoading(false);
        if (error) {
          reportOperationalError('query.gst_rates', 'Failed to load GST rates.', error);
          return;
        }
        const r = (rows ?? []) as any[];
        setData(
          r.map((rate) => ({
            id: rate.id as string,
            name: rate.name as string,
            percentage: Number(rate.percentage),
            isDefault: Boolean(rate.is_default),
          }))
        );
      });
  }, []);

  return { data, loading };
}

// ── Sports ────────────────────────────────────────────────────────────────────

  export function useSports() {
    const [data, setData] = useState<Sport[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
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
          setData(
            r.map((s) => ({
              id: s.id as string,
              name: s.name as string,
              icon: SPORT_ICON_MAP[s.name as string] ?? 'Trophy',
              studentsCount: 0,
              packagesCount: 0,
              revenue: 0,
              status: (s.status === 'active' ? 'active' : 'inactive') as 'active' | 'inactive',
            }))
          );
        });
    }, []);

    return { data, loading };
  }

  // ── Packages ──────────────────────────────────────────────────────────────────

  export function usePackages() {
    const [data, setData] = useState<Package[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
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
          setData(
            r.map((p) => ({
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
            }))
          );
        });
    }, []);

    return { data, loading };
  }

  // ── Students ──────────────────────────────────────────────────────────────────

export function useStudents() {
  const [data, setData] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
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
          setData(
            r.map((s) => {
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
            })
        );
      });
  }, []);

  return { data, loading };
}

// ── Invoices ──────────────────────────────────────────────────────────────────

export function useInvoices() {
  const [data, setData] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, student_id, branch_id, invoice_date, status, subtotal, tax_total, discount_total, total_amount, balance_amount, students(name, ref_id), branches(name), payments(method, status), invoice_items(description)'
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
          setData(
            r.map((inv) => {
              const student = inv.students as { name: string; ref_id: string | null } | null;
              const branch = inv.branches as { name: string } | null;
              const payments = (inv.payments as Array<{ method: string; status: string }>) ?? [];
              const items = (inv.invoice_items as Array<{ description: string }>) ?? [];
              const completedPayment = payments.find((p) => p.status === 'completed');
              return {
                id: inv.invoice_number as string,
                studentId: inv.student_id as string,
                studentRefId: student?.ref_id ?? undefined,
                studentName: student?.name ?? '',
                amount: inv.subtotal as number,
                tax: inv.tax_total as number,
                total: inv.total_amount as number,
                status: (inv.status as Invoice['status']) ?? 'unpaid',
                balanceAmount: (inv.balance_amount as number) ?? 0,
                paymentMode: (completedPayment?.method ?? 'cash') as Invoice['paymentMode'],
                date: inv.invoice_date as string,
                locationId: inv.branch_id as string,
                locationName: branch?.name ?? '',
                packageName: items[0]?.description ?? '',
              };
            })
        );
      });
  }, []);

  return { data, loading };
}

// ── Renewals ──────────────────────────────────────────────────────────────────

export function useRenewals() {
  const [data, setData] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
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
          setData(
            r.map((rv) => {
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
              studentName: student?.name ?? '',
              sportName: pkg?.sports?.name ?? '',
              currentPackageName: pkg?.name ?? '',
                expiryDate: rv.cycle_end as string,
              daysLeft,
              status,
              renewalStatus,
            };
            })
          );
      });
  }, []);

  return { data, loading };
}
