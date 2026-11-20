import { HOST_FOILA } from './konstanta';

export function validasiUrlFoila(s: string): URL | null {
  // Periksa bentuk mentah juga: URL menghapus port :443 dan karakter kontrol.
  if (!s.startsWith(`https://${HOST_FOILA}/`) || /[\s\\]/u.test(s) || s.length > 2048) return null;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' && url.hostname === HOST_FOILA &&
      !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

export function slugFoila(s: string): string {
  const url = validasiUrlFoila(s);
  if (!url) throw new Error('INPUT_TIDAK_VALID');
  const slug = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (!slug || slug.length > 300) throw new Error('INPUT_TIDAK_VALID');
  return slug;
}
