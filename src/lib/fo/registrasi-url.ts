// URL halaman Registrasi Pengunjung (/admin/fo/registrasi) yang menggabungkan Walk-in dan Scan QR dalam satu halaman
// bertab. Tab disimpan di query `?tab=walkin|scan` supaya bisa di-bookmark dan tautan lama tetap bekerja:
// /admin/fo/daftar -> ?tab=walkin, /admin/scan -> ?tab=scan (query lain diteruskan).

export type TabRegistrasi = 'walkin' | 'scan';

export const PATH_REGISTRASI = '/admin/fo/registrasi';
export const TAB_REGISTRASI_DEFAULT: TabRegistrasi = 'walkin';

/** Nilai `?tab=` apa pun -> tab sah; tak dikenal/kosong = default (walk-in). */
export function tabDariParam(nilai: string | string[] | null | undefined): TabRegistrasi {
  const v = Array.isArray(nilai) ? nilai[0] : nilai;
  return v === 'scan' ? 'scan' : TAB_REGISTRASI_DEFAULT;
}

/** Bangun URL registrasi untuk sebuah tab; `sisa` = query lain yang diteruskan (parameter `tab` lama diabaikan). */
export function urlRegistrasi(
  tab: TabRegistrasi,
  sisa: Record<string, string | string[] | undefined> | URLSearchParams = {},
): string {
  const q = new URLSearchParams();
  q.set('tab', tab);
  const pasang = (k: string, v: string) => {
    if (k !== 'tab') q.append(k, v);
  };
  if (sisa instanceof URLSearchParams) {
    sisa.forEach((v, k) => pasang(k, v));
  } else {
    for (const [k, v] of Object.entries(sisa)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) pasang(k, item);
    }
  }
  return `${PATH_REGISTRASI}?${q.toString()}`;
}
