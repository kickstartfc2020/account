/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type StudentStatus = 'active' | 'expiring' | 'expired' | 'unknown';
export type PaymentMode = 'cash' | 'card' | 'online' | 'upi';
export type SubscriptionStatus = 'active' | 'expired';

export interface ManualInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Location {
  id: string;
  refId: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  studentsCount: number;
  activeSports: string[];
  revenue: number;
  image?: string;
  region?: string;
}

export interface Sport {
  id: string;
  name: string;
  icon: string;
  studentsCount: number;
  packagesCount: number;
  revenue: number;
  status?: 'active' | 'inactive';
}

export interface Package {
  id: string;
  refId: string;
  name: string;
  sportId: string;
  sportName: string;
  billingType: 'one-time' | 'recurring';
  durationMonths: number;
  price: number;
  taxPercent: number;
  status: 'active' | 'inactive';
}

export interface Student {
  id: string;
  refId: string;
  name: string;
  phone: string;
  email: string;
  locationId: string;
  locationName: string;
  sportId: string;
  sportName: string;
  packageId: string;
  packageName: string;
  expiryDate: string;
  status: StudentStatus;
  joinedAt: string;
}

export interface Invoice {
  id: string;
  studentId: string;
  studentRefId?: string;
  studentName: string;
  manualCustomerName?: string;
  manualCustomerEmail?: string;
  manualCustomerPhone?: string;
  manualCustomerGst?: string;
  manualCustomerPan?: string;
  amount: number;
  tax: number;
  total: number;
  status: 'draft' | 'unpaid' | 'partial' | 'completed' | 'cancelled';
  balanceAmount: number;
  paymentMode: PaymentMode;
  date: string;
  locationId: string;
  locationName: string;
  packageName: string;
  invoiceItems?: ManualInvoiceItem[];
}

export interface GSTRate {
  id: string;
  name: string;
  percentage: number;
  isDefault: boolean;
}

export interface Renewal {
  id: string;
  refId: string;
  studentId: string;
  packageId?: string;
  studentName: string;
  sportName: string;
  currentPackageName: string;
  expiryDate: string;
  daysLeft: number;
  status: StudentStatus;
  renewalStatus?: 'pending' | 'overdue' | 'completed' | 'cancelled';
}

export interface StudentEnrollment {
  studentId: string;
  packageId: string;
  packageName: string;
  sportName: string;
  price: number;
  status: 'pending' | 'overdue' | 'completed' | 'cancelled';
}
