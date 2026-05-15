import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Building2,
  User,
  Bell,
  ShieldCheck,
  CreditCard,
  Image as ImageIcon,
  Plus,
  Trash2,
  Pencil,
  Check,
} from 'lucide-react';
import { useLocations, useInvoices } from '@/hooks/useData';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  getOrganizationDetails,
  updateOrganizationDetails,
  uploadOrganizationLogo,
  uploadOrganizationQrCode,
} from '@/lib/adminManagement';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { GSTRate } from '@/types';
import { reportOperationalError } from '@/lib/observability';
import { useAuth } from '@/auth/AuthProvider';
import {
  downloadInvoicesExcelBackup,
  resetInvoicesForOrganization,
} from '@/lib/invoiceReset';

export default function Settings() {
  const { role } = useAuth();
  const { data: locations = [] } = useLocations();
  const { data: invoices = [], loading: invoicesLoading } = useInvoices();

  const [activeTab, setActiveTab] = React.useState('Organization');
  const [organization, setOrganization] = React.useState({
    name: '',
    code: '',
    logoUrl: '',
    upiId: '',
    upiQrUrl: '',
    gstNumber: '',
    panNumber: '',
    phone: '',
    email: '',
    address: '',
  });

  const [isSaving, setIsSaving] = React.useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
  const [isUploadingQr, setIsUploadingQr] = React.useState(false);
  const [isResettingInvoices, setIsResettingInvoices] = React.useState(false);

  const logoInputRef = React.useRef<HTMLInputElement | null>(null);
  const qrInputRef = React.useRef<HTMLInputElement | null>(null);

  const [organizationId, setOrganizationId] = React.useState<string>('');
  const [gstRates, setGstRates] = React.useState<GSTRate[]>([]);
  const [isSavingGst, setIsSavingGst] = React.useState(false);
  const [newGstName, setNewGstName] = React.useState('');
  const [newGstPercentage, setNewGstPercentage] = React.useState('18');
  const [newGstDefault, setNewGstDefault] = React.useState(false);
  const [editingGstId, setEditingGstId] = React.useState<string | null>(null);
  const [editGstName, setEditGstName] = React.useState('');
  const [editGstPercentage, setEditGstPercentage] = React.useState('');
  const [editGstDefault, setEditGstDefault] = React.useState(false);

  const canEditPaymentConfig = role === 'super_admin' || role === 'organization_admin';
  const canResetInvoices = role === 'super_admin' || role === 'organization_admin';

  React.useEffect(() => {
    let isMounted = true;
    getOrganizationDetails()
      .then((org) => {
        if (!isMounted || !org) return;
        setOrganization({
          name: org.name,
          code: org.code,
          logoUrl: org.logo_url || '',
          upiId: org.upi_id || '',
          upiQrUrl: org.upi_qr_url || '',
          gstNumber: org.gst_number || '',
          panNumber: org.pan_number || '',
          phone: org.phone || '',
          email: org.email || '',
          address: org.address || '',
        });
        setOrganizationId(org.id);
      })
      .catch((error) => {
        reportOperationalError('settings.organization', 'Failed to initialize organization settings.', error);
      });
    return () => { isMounted = false; };
  }, []);

  React.useEffect(() => {
    const primaryLocation = locations[0];
    if (!primaryLocation) return;
    setOrganization((prev) => ({
      ...prev,
      phone: prev.phone || primaryLocation.phone || '',
      address: prev.address || primaryLocation.address || '',
    }));
  }, [locations]);

  const loadGstRates = React.useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !organizationId) return;
    const gstRatesTable = supabase.from('gst_rates') as any;
    const { data, error } = await gstRatesTable
      .select('*')
      .eq('organization_id', organizationId)
      .order('is_default', { ascending: false })
      .order('percentage', { ascending: true });
    if (error) { toast.error(error.message || 'Failed to load GST rates.'); return; }
    const rows = (data ?? []) as any[];
    setGstRates(rows.map((rate) => ({
      id: rate.id as string,
      name: rate.name as string,
      percentage: Number(rate.percentage),
      isDefault: Boolean(rate.is_default),
    })));
  }, [organizationId]);

  React.useEffect(() => { void loadGstRates(); }, [loadGstRates]);

  const onOrgFieldChange = (field: keyof typeof organization, value: string) => {
    setOrganization((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveOrganization = async () => {
    if (!organization.name.trim() || !organization.code.trim()) {
      toast.error('Academy name and registration ID are required.');
      return;
    }
    setIsSaving(true);
    try {
      await updateOrganizationDetails({
        name: organization.name.trim(),
        code: organization.code.trim(),
        upiId: organization.upiId.trim(),
        gstNumber: organization.gstNumber.trim(),
        panNumber: organization.panNumber.trim(),
        phone: organization.phone.trim(),
        email: organization.email.trim(),
        address: organization.address.trim(),
      });
      toast.success('Organization details saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save organization details.');
    } finally { setIsSaving(false); }
  };

  const handleLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo size should be under 5MB.'); return; }
    setIsUploadingLogo(true);
    try {
      const url = await uploadOrganizationLogo(file);
      setOrganization((prev) => ({ ...prev, logoUrl: url }));
      toast.success('Organization logo updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload organization logo.');
    } finally { setIsUploadingLogo(false); }
  };

  const handleQrFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('QR size should be under 5MB.'); return; }
    setIsUploadingQr(true);
    try {
      const url = await uploadOrganizationQrCode(file);
      setOrganization((prev) => ({ ...prev, upiQrUrl: url }));
      toast.success('UPI QR code updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload UPI QR code.');
    } finally { setIsUploadingQr(false); }
  };

  const setDefaultGstRate = async (targetId: string) => {
    if (!isSupabaseConfigured || !supabase || !organizationId) return;
    setIsSavingGst(true);
    try {
      const gstRatesTable = supabase.from('gst_rates') as any;
      const { error: clearError } = await gstRatesTable.update({ is_default: false }).eq('organization_id', organizationId);
      if (clearError) throw clearError;
      const { error: setError } = await gstRatesTable.update({ is_default: true }).eq('id', targetId).eq('organization_id', organizationId);
      if (setError) throw setError;
      await loadGstRates();
      toast.success('Default GST rate updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to set default GST rate.');
    } finally { setIsSavingGst(false); }
  };

  const handleAddGstRate = async () => {
    if (!isSupabaseConfigured || !supabase || !organizationId) return;
    const percentage = Number(newGstPercentage);
    const name = newGstName.trim();
    if (!name || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      toast.error('Enter a valid GST name and percentage between 0 and 100.');
      return;
    }
    setIsSavingGst(true);
    try {
      const gstRatesTable = supabase.from('gst_rates') as any;
      if (newGstDefault) {
        const { error: clearError } = await gstRatesTable.update({ is_default: false }).eq('organization_id', organizationId);
        if (clearError) throw clearError;
      }
      const { error } = await gstRatesTable.insert({ organization_id: organizationId, name, percentage, is_default: newGstDefault });
      if (error) throw error;
      setNewGstName(''); setNewGstPercentage('18'); setNewGstDefault(false);
      await loadGstRates();
      toast.success('GST rate added.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add GST rate.');
    } finally { setIsSavingGst(false); }
  };

  const beginEditGst = (rate: GSTRate) => {
    setEditingGstId(rate.id);
    setEditGstName(rate.name);
    setEditGstPercentage(String(rate.percentage));
    setEditGstDefault(rate.isDefault);
  };

  const handleUpdateGstRate = async () => {
    if (!isSupabaseConfigured || !supabase || !organizationId || !editingGstId) return;
    const percentage = Number(editGstPercentage);
    const name = editGstName.trim();
    if (!name || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      toast.error('Enter a valid GST name and percentage between 0 and 100.');
      return;
    }
    setIsSavingGst(true);
    try {
      const gstRatesTable = supabase.from('gst_rates') as any;
      if (editGstDefault) {
        const { error: clearError } = await gstRatesTable.update({ is_default: false }).eq('organization_id', organizationId);
        if (clearError) throw clearError;
      }
      const { error } = await gstRatesTable.update({ name, percentage, is_default: editGstDefault }).eq('id', editingGstId).eq('organization_id', organizationId);
      if (error) throw error;
      setEditingGstId(null);
      await loadGstRates();
      toast.success('GST rate updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update GST rate.');
    } finally { setIsSavingGst(false); }
  };

  const handleDeleteGstRate = async (rate: GSTRate) => {
    if (!isSupabaseConfigured || !supabase || !organizationId) return;
    const activeRates = gstRates.filter((item) => item.id !== rate.id);
    if (activeRates.length === 0) { toast.error('At least one GST rate must remain active.'); return; }
    setIsSavingGst(true);
    try {
      const gstRatesTable = supabase.from('gst_rates') as any;
      const { error } = await gstRatesTable
        .update({ archived_at: new Date().toISOString(), is_default: false })
        .eq('id', rate.id).eq('organization_id', organizationId);
      if (error) throw error;
      if (rate.isDefault) {
        const replacement = activeRates.find((item) => !item.isDefault) ?? activeRates[0];
        const { error: replacementError } = await gstRatesTable.update({ is_default: true }).eq('id', replacement.id).eq('organization_id', organizationId);
        if (replacementError) throw replacementError;
      }
      await loadGstRates();
      toast.success('GST rate archived.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete GST rate.');
    } finally { setIsSavingGst(false); }
  };

  const handleBackupAndResetInvoices = async () => {
    if (!canResetInvoices) { toast.error('Only administrators can reset invoices.'); return; }
    if (!organizationId) { toast.error('Organization is not ready yet.'); return; }
    if (invoicesLoading) { toast.info('Invoices are still loading. Please try again in a moment.'); return; }
    if (!window.confirm('This will download an Excel backup first. Continue?')) return;
    downloadInvoicesExcelBackup(invoices, organization.name || 'Invoices');
    if (!window.confirm('Backup download started. Delete all invoices and reset numbering to 01? This cannot be undone.')) return;
    setIsResettingInvoices(true);
    try {
      const result = await resetInvoicesForOrganization(organizationId);
      const deletedCount = result?.[0]?.deleted_invoices ?? 0;
      toast.success(`Invoice reset complete. ${deletedCount} invoices were removed and numbering restarted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset invoices.');
    } finally { setIsResettingInvoices(false); }
  };

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Manage your organization profile, billing, and staff users.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside className="space-y-1">
          {[
            { label: 'Organization', icon: Building2 },
            { label: 'User Profile', icon: User },
            { label: 'Notifications', icon: Bell },
            { label: 'Billing & GST', icon: CreditCard },
            { label: 'Security', icon: ShieldCheck },
          ].map((item) => (
            <Button
              key={item.label}
              variant={activeTab === item.label ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab(item.label)}
              className={`w-full justify-start gap-3 rounded-xl h-11 ${activeTab === item.label ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500'}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Button>
          ))}
        </aside>

        <div className="lg:col-span-3 space-y-8">
          {activeTab === 'Organization' && (
            <>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg font-display font-bold">Organization Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-2xl bg-indigo-600 overflow-hidden flex items-center justify-center text-white text-4xl font-bold shadow-lg shadow-indigo-100">
                      {organization.logoUrl ? (
                        <img src={organization.logoUrl} alt="Organization logo" width={96} height={96} className="w-full h-full object-cover" />
                      ) : (
                        (organization.name || 'K').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="space-y-2">
                      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
                      <Button variant="outline" className="gap-2 h-9 text-xs" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo}>
                        <ImageIcon className="w-4 h-4" />
                        {isUploadingLogo ? 'Uploading...' : 'Change Logo'}
                      </Button>
                      <p className="text-[10px] text-slate-400">Recommended: Square image, minimum 400x400px.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Academy Name</label>
                      <Input value={organization.name} onChange={(e) => onOrgFieldChange('name', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registration ID</label>
                      <Input value={organization.code} onChange={(e) => onOrgFieldChange('code', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">GST Number</label>
                      <Input value={organization.gstNumber} onChange={(e) => onOrgFieldChange('gstNumber', e.target.value)} placeholder="e.g. 29ABCDE1234F1Z5" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">PAN Number</label>
                      <Input value={organization.panNumber} onChange={(e) => onOrgFieldChange('panNumber', e.target.value)} placeholder="e.g. ABCDE1234F" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Phone</label>
                      <Input value={organization.phone} onChange={(e) => onOrgFieldChange('phone', e.target.value)} placeholder="e.g. +91 9876543210" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email</label>
                      <Input value={organization.email} onChange={(e) => onOrgFieldChange('email', e.target.value)} placeholder="e.g. billing@academy.com" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Headquarters Address</label>
                    <Input value={organization.address} onChange={(e) => onOrgFieldChange('address', e.target.value)} placeholder="Enter full address" />
                  </div>

                  <div className="pt-4 border-t border-gray-100 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600">Payment Configuration</h3>
                      {!canEditPaymentConfig && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Admin only</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-gray-500 tracking-wider">UPI ID</label>
                        <Input value={organization.upiId} onChange={(e) => onOrgFieldChange('upiId', e.target.value)} className="h-11 border-indigo-50 focus:ring-indigo-500" disabled={!canEditPaymentConfig} placeholder="kickstart@upi" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-gray-500 tracking-wider">UPI QR Code Image</label>
                        <div className="flex flex-wrap items-center gap-3">
                          <input ref={qrInputRef} type="file" accept="image/*" className="hidden" onChange={handleQrFileChange} />
                          <Button type="button" variant="outline" className="h-11" onClick={() => qrInputRef.current?.click()} disabled={!canEditPaymentConfig || isUploadingQr}>
                            {isUploadingQr ? 'Uploading...' : 'Upload QR Image'}
                          </Button>
                          {organization.upiQrUrl && <span className="text-xs text-slate-500">Saved</span>}
                        </div>
                      </div>
                    </div>
                    {organization.upiQrUrl && (
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 flex items-center gap-4">
                        <img src={organization.upiQrUrl} alt="UPI QR code" width={80} height={80} className="h-20 w-20 rounded-xl object-cover bg-white border border-indigo-100" />
                        <div className="space-y-1">
                          <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Current QR Code</p>
                          <p className="text-sm text-slate-600">This QR code will appear on the invoice page and printouts.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t flex items-center justify-between">
                    <p className="text-xs text-slate-500">Organization profile values are stored in database and used in invoice templates.</p>
                    <Button onClick={() => void handleSaveOrganization()} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700">
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card border-red-100">
                <CardHeader>
                  <CardTitle className="text-lg font-display font-bold text-slate-900">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-red-700">Deactivate Academy</p>
                      <p className="text-sm text-red-600/80">Temporarily suspend all branch operations and billing.</p>
                    </div>
                    <Button variant="destructive" className="bg-red-600 hover:bg-red-700">Deactivate</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'Billing & GST' && (
            <div className="space-y-8">
              <Card className="glass-card">
                <CardHeader className="flex flex-row justify-between items-center">
                  <CardTitle className="text-lg font-display font-bold">GST Configuration</CardTitle>
                  <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={() => setNewGstDefault(false)}>
                    <Plus className="w-4 h-4" />
                    Add GST Rate
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-slate-500">Add, edit, delete, and set default GST rates for invoice generation.</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 border rounded-2xl bg-slate-50/50">
                    <Input placeholder="Rate name (e.g. Standard GST)" value={newGstName} onChange={(e) => setNewGstName(e.target.value)} />
                    <Input type="number" min="0" max="100" step="0.01" placeholder="Percentage" value={newGstPercentage} onChange={(e) => setNewGstPercentage(e.target.value)} />
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={newGstDefault} onChange={(e) => setNewGstDefault(e.target.checked)} />
                      Set as default
                    </label>
                    <Button onClick={() => void handleAddGstRate()} disabled={isSavingGst} className="bg-indigo-600 hover:bg-indigo-700">Add</Button>
                  </div>
                  <div className="space-y-3">
                    {gstRates.map((rate) => (
                      <div key={rate.id} className="group p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-indigo-200 hover:shadow-sm transition-all">
                        {editingGstId === rate.id ? (
                          <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                            <Input value={editGstName} onChange={(e) => setEditGstName(e.target.value)} />
                            <Input type="number" min="0" max="100" step="0.01" value={editGstPercentage} onChange={(e) => setEditGstPercentage(e.target.value)} />
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="checkbox" checked={editGstDefault} onChange={(e) => setEditGstDefault(e.target.checked)} />
                              Default
                            </label>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void handleUpdateGstRate()} disabled={isSavingGst} className="bg-indigo-600 hover:bg-indigo-700">Save</Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingGstId(null)}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm">
                                {rate.percentage}%
                              </div>
                              <div>
                                <p className="font-bold text-slate-900 flex items-center gap-2">
                                  {rate.name}
                                  {rate.isDefault && (
                                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none text-[10px] uppercase font-black px-2">Default</Badge>
                                  )}
                                </p>
                                <p className="text-xs text-slate-400">Apply {rate.percentage}% tax to invoices</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              {!rate.isDefault && (
                                <Button size="sm" variant="outline" onClick={() => void setDefaultGstRate(rate.id)} disabled={isSavingGst}>
                                  <Check className="w-4 h-4 mr-1" />
                                  Default
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={() => beginEditGst(rate)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => void handleDeleteGstRate(rate)} disabled={isSavingGst}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {gstRates.length === 0 && (
                      <div className="p-6 border border-dashed rounded-2xl text-sm text-slate-500 text-center">
                        No GST rates configured yet. Add one to use it in invoices.
                      </div>
                    )}
                  </div>
                  <div className="pt-6 border-t">
                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                      <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 leading-relaxed">
                        <strong>Important:</strong> Changing global GST rates will only affect new invoices. Existing invoices and receipts will maintain their original tax calculations at the time of issuance for compliance.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {canResetInvoices && (
                <Card className="glass-card border-red-100">
                  <CardHeader>
                    <CardTitle className="text-lg font-display font-bold text-slate-900">Invoice Year Reset</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-red-50 rounded-2xl border border-red-100 space-y-2">
                      <p className="font-bold text-red-700">Backup first, then reset invoices</p>
                      <p className="text-sm text-red-600/80">Downloads an Excel backup of all invoices, removes invoice records from the database, and restarts numbering from 01.</p>
                      <p className="text-xs text-red-500/90">Current invoice count: {invoices.length}</p>
                    </div>
                    <Button variant="destructive" className="w-full bg-red-600 hover:bg-red-700" onClick={() => void handleBackupAndResetInvoices()} disabled={isResettingInvoices || invoicesLoading}>
                      {isResettingInvoices ? 'Resetting Invoices...' : 'Download Backup & Reset Invoices'}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {(activeTab === 'User Profile' || activeTab === 'Notifications' || activeTab === 'Security') && (
            <div className="h-64 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 text-slate-400">
              <p className="font-medium">{activeTab} settings coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}