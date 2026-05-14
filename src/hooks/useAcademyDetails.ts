import { useState, useEffect } from 'react';
import { getOrganizationDetails } from '@/lib/adminManagement';
import { reportOperationalError } from '@/lib/observability';

export type AcademyDetails = {
  name: string;
  code: string;
  logoText: string;
  logoUrl: string;
  gstNumber: string;
  panNumber: string;
  phone: string;
  email: string;
  address: string;
};

const DEFAULT: AcademyDetails = {
  name: '',
  code: '',
  logoText: '',
  logoUrl: '',
  gstNumber: '',
  panNumber: '',
  phone: '',
  email: '',
  address: '',
};

export function useAcademyDetails(): AcademyDetails {
  const [details, setDetails] = useState<AcademyDetails>(DEFAULT);

  useEffect(() => {
    let alive = true;
    getOrganizationDetails()
      .then((org) => {
        if (!alive || !org) return;
        setDetails({
          name: org.name,
          code: org.code,
          logoText: org.name.charAt(0).toUpperCase(),
          logoUrl: org.logo_url ?? '',
          gstNumber: org.gst_number ?? '',
          panNumber: org.pan_number ?? '',
          phone: org.phone ?? '',
          email: org.email ?? '',
          address: org.address ?? '',
        });
      })
      .catch((error) => {
        reportOperationalError('settings.organization', 'Failed to load organization details.', error);
      });
    return () => { alive = false; };
  }, []);

  return details;
}
