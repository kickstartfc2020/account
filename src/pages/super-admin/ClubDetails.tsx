import React from 'react';
import {
  Globe,
  Phone,
  Mail,
  Camera,
  Save,
  Info,
  Image as ImageIcon,
  Plus,
  Trash2,
  Pencil,
  Check,
  Bell,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  clearOrganizationQrCode,
  getOrganizationDetails,
  updateOrganizationDetails,
  uploadOrganizationLogo,
  uploadOrganizationQrCode,
} from '@/lib/adminManagement';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { GSTRate } from '@/types';
import { toast } from 'sonner';
import { reportOperationalError } from '@/lib/observability';

export default function ClubDetails() {
  const [organization, setOrganization] = React.useState({
    name: 'Kickstart Academy',
    code: 'KICK-2024-8849',
    address: '',
    gstNumber: '',
    panNumber: '',
    email: '',
    phone: '',
    logoUrl: '',
    upiId: '',
    upiQrUrl: '',
  });
  const [isSaving, setIsSaving] = React.useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = React.useState(false);
  const [isUploadingQr, setIsUploadingQr] = React.useState(false);
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

  React.useEffect(() => {
    let isMounted = true;
    getOrganizationDetails()
      .then((org) => {
        if (!isMounted || !org) return;
        setOrganization({
          name: org.name,
          code: org.code,
          address: org.address ?? '',
          gstNumber: org.gst_number ?? '',
          panNumber: org.pan_number ?? '',
          email: org.email ?? '',
          phone: org.phone ?? '',
          logoUrl: org.logo_url ?? '',
          upiId: org.upi_id ?? '',
          upiQrUrl: org.upi_qr_url ?? '',
        });
        setOrganizationId(org.id);
      })
      .catch((error) => {
        reportOperationalError('superadmin.club_details', 'Failed to load organization details.', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

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

  const handleSave = async () => {
    if (!organization.name.trim() || !organization.code.trim()) {
      toast.error('Organization name and registration number are required.');
      return;
    }

    setIsSaving(true);
    try {
      await updateOrganizationDetails({
        name: organization.name.trim(),
        code: organization.code.trim(),
        address: organization.address.trim(),
        gstNumber: organization.gstNumber.trim(),
        panNumber: organization.panNumber.trim(),
        email: organization.email.trim(),
        phone: organization.phone.trim(),
        upiId: organization.upiId.trim(),
      });
      toast.success('Organization details updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save organization settings.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const onFieldChange = (field: keyof typeof organization, value: string) => {
    setOrganization((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (file: File) => {
    setIsUploadingLogo(true);
    try {
      const logoUrl = await uploadOrganizationLogo(file);
      setOrganization((prev) => ({ ...prev, logoUrl }));
      toast.success('Organization logo updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload logo.';
      toast.error(message);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleQrUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('QR size should be under 5MB.');
      return;
    }

    setIsUploadingQr(true);
    try {
      const upiQrUrl = await uploadOrganizationQrCode(file);
      setOrganization((prev) => ({ ...prev, upiQrUrl }));
      toast.success('UPI QR code updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload UPI QR code.';
      toast.error(message);
    } finally {
      setIsUploadingQr(false);
    }
  };

  const handleClearQr = async () => {
    setIsUploadingQr(true);
    try {
      await clearOrganizationQrCode();
      setOrganization((prev) => ({ ...prev, upiQrUrl: '' }));
      toast.success('UPI QR code removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove UPI QR code.';
      toast.error(message);
    } finally {
      setIsUploadingQr(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Club Details</h1>
          <p className="text-gray-500 mt-1">Global branding and organization settings for Kickstart Academy.</p>
        </div>
        <Button className="btn-primary gap-2 h-11 px-8 shadow-indigo-100" onClick={() => void handleSave()} disabled={isSaving}>
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          {/* General Information */}
          <Card className="glass-card">
            <CardHeader className="border-b border-gray-100">
              <CardTitle className="text-lg font-bold">General Information</CardTitle>
              <CardDescription>Core details visible across all branch invoices and reports.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 grid gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Academy Name</Label>
                  <Input value={organization.name} onChange={(e) => onFieldChange('name', e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Registration Number</Label>
                  <Input value={organization.code} onChange={(e) => onFieldChange('code', e.target.value)} className="h-11" />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Registered Address</Label>
                <Textarea 
                  placeholder="Enter complete club address..." 
                  className="min-h-[80px] resize-none" 
                  value={organization.address}
                  onChange={(e) => onFieldChange('address', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">GST Number</Label>
                  <Input value={organization.gstNumber} onChange={(e) => onFieldChange('gstNumber', e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">PAN Card Number</Label>
                  <Input value={organization.panNumber} onChange={(e) => onFieldChange('panNumber', e.target.value)} className="h-11" />
                </div>
              </div>

              {/* UPI Payment Configuration */}
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600">Payment Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">UPI ID for QR Code</Label>
                    <Input value={organization.upiId} onChange={(e) => onFieldChange('upiId', e.target.value)} className="h-11 border-indigo-50 focus:ring-indigo-500" placeholder="kickstart@upi" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">UPI QR Code Image</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" className="h-11 gap-2" onClick={() => qrInputRef.current?.click()} disabled={isUploadingQr}>
                        <ImageIcon className="w-4 h-4" />
                        {isUploadingQr ? 'Processing...' : organization.upiQrUrl ? 'Replace QR Image' : 'Upload QR Image'}
                      </Button>
                      {organization.upiQrUrl && (
                        <Button type="button" variant="outline" className="h-11 text-red-600 hover:text-red-700" onClick={() => void handleClearQr()} disabled={isUploadingQr}>
                          Remove QR
                        </Button>
                      )}
                    </div>
                    <input
                      ref={qrInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void handleQrUpload(file);
                        }
                        e.target.value = '';
                      }}
                    />
                    <p className="text-[10px] text-gray-400">Accepted formats: JPG, PNG, WEBP. Max 5MB.</p>
                  </div>
                </div>
                {organization.upiQrUrl && (
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 flex items-center gap-4">
                    <img src={organization.upiQrUrl} alt="UPI QR code" width={80} height={80} className="h-20 w-20 rounded-xl object-cover bg-white border border-indigo-100" />
                    <div className="space-y-1">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">Current QR Code</p>
                      <p className="text-sm text-slate-600">Used across invoices where UPI payment details are shown.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Global Support Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input value={organization.email} onChange={(e) => onFieldChange('email', e.target.value)} className="h-11 pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Primary Contact</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input value={organization.phone} onChange={(e) => onFieldChange('phone', e.target.value)} className="h-11 pl-10" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Presence */}
          <Card className="glass-card">
            <CardHeader className="border-b border-gray-100">
              <CardTitle className="text-lg font-bold">Social & Web</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Website URL</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input defaultValue="www.kickstartacademy.com" className="h-11 pl-10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="Instagram Handle" className="h-11" />
                <Input placeholder="Facebook Page" className="h-11" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Branding Card */}
          <Card className="glass-card">
            <CardHeader className="text-center">
              <CardTitle className="text-base font-bold">Global Logo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <div className="relative group">
                {organization.logoUrl ? (
                  <img
                    src={organization.logoUrl}
                    alt="Organization logo"
                    className="w-32 h-32 rounded-2xl object-cover shadow-xl shadow-indigo-100 transition-transform group-hover:scale-95 duration-300"
                    width={128}
                    height={128}
                  />
                ) : (
                  <div className="w-32 h-32 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-5xl font-bold shadow-xl shadow-indigo-100 transition-transform group-hover:scale-95 duration-300">
                    {(organization.name || 'K').charAt(0).toUpperCase()}
                  </div>
                )}
                <button
                  className="absolute -bottom-2 -right-2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 text-gray-600 hover:text-indigo-600 transition-colors disabled:opacity-50"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={isUploadingLogo}
                  type="button"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleLogoUpload(file);
                    }
                    e.target.value = '';
                  }}
                />
              </div>
              <div className="text-center">
                <p className="text-xs font-bold text-gray-900">Kickstart Branding</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Default for all branches</p>
              </div>
            </CardContent>
          </Card>

          {/* Tips Card */}
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="pt-6 flex gap-4">
              <div className="p-2 bg-amber-100 rounded-lg h-fit">
                <Info className="w-4 h-4 text-amber-700" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-amber-900">Branding Synergy</p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  The colors and logos defined here will be applied as regional defaults for all new branches created in the dashboard.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* GST Configuration */}
      <Card className="glass-card">
        <CardHeader className="border-b border-gray-100 flex flex-row justify-between items-center">
          <div>
            <CardTitle className="text-lg font-bold">GST Configuration</CardTitle>
            <CardDescription className="mt-1">Add, edit, delete, and set default GST rates for invoice generation.</CardDescription>
          </div>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-2" disabled={isSavingGst}>
            <Plus className="w-4 h-4" />
            Add GST Rate
          </Button>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 border rounded-2xl bg-slate-50/50">
            <Input placeholder="Rate name (e.g. Standard GST)" value={newGstName} onChange={(e) => setNewGstName(e.target.value)} />
            <Input type="number" min="0" max="100" step="0.01" placeholder="Percentage" value={newGstPercentage} onChange={(e) => setNewGstPercentage(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
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
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
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

          <div className="pt-4 border-t">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
              <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>Important:</strong> Changing global GST rates will only affect new invoices. Existing invoices and receipts will maintain their original tax calculations at the time of issuance for compliance.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
