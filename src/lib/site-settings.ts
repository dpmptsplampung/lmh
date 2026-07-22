import { createClient } from '@/lib/supabase/client';
import {
  WA_NUMBER,
  WA_DEFAULT_MESSAGE,
  CONTACT_EMAIL_FALLBACK,
} from '@/lib/constants';

const SITE_SETTING_DEFAULTS: Record<string, string> = {
  wa_number: WA_NUMBER,
  wa_default_message: WA_DEFAULT_MESSAGE,
  foila_url: 'https://invest.lampungprov.go.id/',
  contact_address: '',
  contact_hours: '',
  contact_email: CONTACT_EMAIL_FALLBACK,
};

/**
 * Baca site_settings (aman dipanggil dari client component).
 * Mengembalikan map key -> value dengan fallback ke konstanta default.
 * Defensif: bila query gagal, seluruh fallback dipakai.
 */
export async function getSiteSettings(keys?: string[]): Promise<Record<string, string>> {
  const wanted = keys && keys.length > 0 ? keys : Object.keys(SITE_SETTING_DEFAULTS);
  const result: Record<string, string> = {};
  for (const key of wanted) {
    result[key] = SITE_SETTING_DEFAULTS[key] ?? '';
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('site_settings')
      .select('key, value')
      .in('key', wanted);

    if (error || !data) return result;

    for (const row of data as { key: string; value: string | null }[]) {
      if (row.value && row.value.trim() !== '') {
        result[row.key] = row.value;
      }
    }
  } catch {
    // fallback konstanta
  }

  return result;
}
