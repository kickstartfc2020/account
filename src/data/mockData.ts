import { Location, Sport, Package, Student, Invoice, Renewal, GSTRate } from '../types';
import { subDays, addDays, format, subMonths } from 'date-fns';

export const GST_RATES: GSTRate[] = [
  { id: 'gst-1', name: 'GST 18%', percentage: 18, isDefault: true },
  { id: 'gst-2', name: 'GST 12%', percentage: 12, isDefault: false },
  { id: 'gst-3', name: 'GST 5%', percentage: 5, isDefault: false },
  { id: 'gst-4', name: 'Exempt', percentage: 0, isDefault: false },
];

export const ACADEMY_DETAILS = {
  name: 'Kickstart Academy',
  registrationNumber: 'KICK-2024-8849',
  address: '123 Sport Street, Mysore, Karnataka - 570001',
  gstNumber: '29AAAAA0000A1Z5',
  panNumber: 'ABCDE1234F',
  email: 'admin@kickstart.com',
  phone: '+91 98765 43210',
  logoText: 'K',
  upiId: 'kickstart@upi',
  upiQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=kickstart@upi&pn=Kickstart%20Academy',
  footerText: 'Kickstart Football Club - Karnataka EST 2016'
};

export const LOCATIONS: Location[] = [
  { id: '1', refId: 'BR-0001', name: 'Mysore Main', address: '123 Sport Street, Mysore', phone: '9876543210', email: 'main@kickstart.com', studentsCount: 150, activeSports: ['Football', 'Badminton'], revenue: 450000, image: 'https://images.unsplash.com/photo-1544105353-83210153ef2a?q=80&w=800&auto=format&fit=crop', region: 'North' },
  { id: '2', refId: 'BR-0002', name: 'South City', address: '456 Stadium Road, Mysore', phone: '9876543211', email: 'south@kickstart.com', studentsCount: 85, activeSports: ['Cricket', 'Tennis'], revenue: 210000, image: 'https://images.unsplash.com/photo-1595030044556-acfaa61edc0f?q=80&w=800&auto=format&fit=crop', region: 'South' },
  { id: '3', refId: 'BR-0003', name: 'East End', address: '789 Academy Ave, Mysore', phone: '9876543212', email: 'east@kickstart.com', studentsCount: 120, activeSports: ['Football', 'Swimming'], revenue: 380000, image: 'https://images.unsplash.com/photo-1526232759533-3d027df9477e?q=80&w=800&auto=format&fit=crop', region: 'East' },
];

export const SPORTS: Sport[] = [
  { id: 's1', name: 'Football', icon: 'Trophy', studentsCount: 120, packagesCount: 4, revenue: 250000 },
  { id: 's2', name: 'Badminton', icon: 'Zap', studentsCount: 80, packagesCount: 3, revenue: 150000 },
  { id: 's3', name: 'Cricket', icon: 'Target', studentsCount: 95, packagesCount: 3, revenue: 180000 },
  { id: 's4', name: 'Tennis', icon: 'Dribbble', studentsCount: 60, packagesCount: 2, revenue: 120000 },
];

export const PACKAGES: Package[] = [
  { id: 'p1', refId: 'PKG-0001', name: 'Monthly Basic', sportId: 's1', sportName: 'Football', billingType: 'one-time', durationMonths: 1, price: 2000, taxPercent: 18, status: 'active' },
  { id: 'p2', refId: 'PKG-0002', name: 'Quarterly Pro', sportId: 's1', sportName: 'Football', billingType: 'recurring', durationMonths: 3, price: 5500, taxPercent: 18, status: 'active' },
  { id: 'p3', refId: 'PKG-0003', name: 'Annual Elite', sportId: 's1', sportName: 'Football', billingType: 'one-time', durationMonths: 12, price: 20000, taxPercent: 18, status: 'active' },
  { id: 'p4', refId: 'PKG-0004', name: 'Summer Camp', sportId: 's2', sportName: 'Badminton', billingType: 'one-time', durationMonths: 1, price: 3000, taxPercent: 18, status: 'active' },
];

export const STUDENTS: Student[] = [
  { 
    id: 'st1', refId: 'STU-000001', name: 'Rahul Sharma', phone: '9988776655', email: 'rahul@example.com', 
    locationId: '1', locationName: 'Mysore Main', sportId: 's1', sportName: 'Football', 
    packageId: 'p1', packageName: 'Monthly Basic', expiryDate: format(addDays(new Date(), 5), 'yyyy-MM-dd'), 
    status: 'expiring', joinedAt: '2025-01-10' 
  },
  { 
    id: 'st2', refId: 'STU-000002', name: 'Priya Singh', phone: '9988776644', email: 'priya@example.com', 
    locationId: '1', locationName: 'Mysore Main', sportId: 's2', sportName: 'Badminton', 
    packageId: 'p4', packageName: 'Summer Camp', expiryDate: format(addDays(new Date(), 45), 'yyyy-MM-dd'), 
    status: 'active', joinedAt: '2025-03-01' 
  },
  { 
    id: 'st3', refId: 'STU-000003', name: 'Anish Kumar', phone: '9988776633', email: 'anish@example.com', 
    locationId: '2', locationName: 'South City', sportId: 's3', sportName: 'Cricket', 
    packageId: 'p2', packageName: 'Quarterly Pro', expiryDate: format(subDays(new Date(), 2), 'yyyy-MM-dd'), 
    status: 'expired', joinedAt: '2024-11-15' 
  },
];

export const INVOICES: Invoice[] = [
  { id: 'INV-001', studentId: 'st1', studentName: 'Rahul Sharma', amount: 2000, tax: 360, total: 2360, paymentMode: 'upi', date: '2025-04-12', locationId: '1', locationName: 'Mysore Main', packageName: 'Monthly Basic' },
  { id: 'INV-002', studentId: 'st2', studentName: 'Priya Singh', amount: 3000, tax: 540, total: 3540, paymentMode: 'card', date: '2025-05-01', locationId: '1', locationName: 'Mysore Main', packageName: 'Summer Camp' },
];

export const RENEWALS: Renewal[] = [
  { id: 'r1', refId: 'REN-2026-000001', studentId: 'st1', studentName: 'Rahul Sharma', sportName: 'Football', currentPackageName: 'Monthly Basic', expiryDate: format(addDays(new Date(), 5), 'yyyy-MM-dd'), daysLeft: 5, status: 'expiring' },
  { id: 'r2', refId: 'REN-2026-000002', studentId: 'st3', studentName: 'Anish Kumar', sportName: 'Cricket', currentPackageName: 'Quarterly Pro', expiryDate: format(subDays(new Date(), 2), 'yyyy-MM-dd'), daysLeft: -2, status: 'expired' },
];

export const DASHBOARD_STATS = [
  { label: 'Total Revenue', value: '₹10.4L', trend: '+12% from last month' },
  { label: "Today's Invoices", value: '18', trend: '4 pending payment' },
  { label: 'Active Students', value: '355', trend: '+15 new this week' },
  { label: 'Pending Renewals', value: '12', trend: 'Due within 7 days' },
];

export const REVENUE_DATA = [
  { month: 'Jan', revenue: 320000, growth: 2400 },
  { month: 'Feb', revenue: 380000, growth: 2200 },
  { month: 'Mar', revenue: 410000, growth: 2600 },
  { month: 'Apr', revenue: 450000, growth: 2800 },
  { month: 'May', revenue: 520000, growth: 3100 },
];
