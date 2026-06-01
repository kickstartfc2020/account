import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const PUBLIC_BRANCH_IMAGES_SEGMENT = '/storage/v1/object/public/branch-images/';

function stripQueryAndHash(value: string) {
  return value.split('#')[0].split('?')[0];
}

export function toBranchImagesObjectPath(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const markerIndex = trimmed.indexOf(PUBLIC_BRANCH_IMAGES_SEGMENT);
    if (markerIndex >= 0) {
      const rawPath = trimmed.slice(markerIndex + PUBLIC_BRANCH_IMAGES_SEGMENT.length);
      return decodeURIComponent(stripQueryAndHash(rawPath));
    }

    return trimmed;
  }

  return stripQueryAndHash(trimmed);
}

export async function resolveBranchImagesUrl(
  value: string | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<string | null> {
  const normalized = toBranchImagesObjectPath(value);
  if (!normalized) return null;

  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from('branch-images')
    .createSignedUrl(normalized, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}
