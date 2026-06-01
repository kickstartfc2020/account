import React from 'react';
import { 
  Building2, 
  Globe, 
  Phone, 
  Mail,
  Camera,
  Save,
  Info,
  Image as ImageIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  clearOrganizationQrCode,
  getOrganizationDetails,
  updateOrganizationDetails,
  uploadOrganizationLogo,
  uploadOrganizationQrCode,
} from '@/lib/adminManagement';
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
      })
      .catch((error) => {
        reportOperationalError('superadmin.club_details', 'Failed to load organization details.', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

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
    </div>
  );
}
