import { useState, useEffect } from 'react';
import { getOrganizationDetails } from '@/lib/adminManagement';

export type AcademyDetails = {
  name: string;
  code: string;
  logoText: string;
};

const DEFAULT: AcademyDetails = { name: '', code: '', logoText: '' };

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
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return details;
}
