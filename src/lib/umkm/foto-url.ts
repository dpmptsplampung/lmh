// Validasi tautan foto UMKM eksternal (selain unggahan ke R2). Hanya https, tanpa kredensial, bukan localhost/IP.
// Pemeriksaan serupa dijaga di DB (CHECK foto_produk berawalan https://) karena admin menulis kolom ini langsung dari klien.

export const MAKS_PANJANG_URL_FOTO = 500;

export type HasilUrlFoto = { ok: true; url: string } | { ok: false; alasan: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function validasiUrlFoto(input: string): HasilUrlFoto {
  const teks = input.trim();
  if (!teks) return { ok: false, alasan: 'Tautan foto kosong' };
  if (teks.length > MAKS_PANJANG_URL_FOTO) return { ok: false, alasan: `Tautan terlalu panjang (maks ${MAKS_PANJANG_URL_FOTO} karakter)` };
  let u: URL;
  try {
    u = new URL(teks);
  } catch {
    return { ok: false, alasan: 'Tautan tidak valid' };
  }
  if (u.protocol !== 'https:') return { ok: false, alasan: 'Tautan harus diawali https://' };
  if (u.username || u.password) return { ok: false, alasan: 'Tautan tidak boleh memuat nama pengguna/kata sandi' };
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || IPV4.test(host) || host.includes(':') || host.startsWith('[')) {
    return { ok: false, alasan: 'Alamat tautan tidak diizinkan' };
  }
  if (!host.includes('.')) return { ok: false, alasan: 'Alamat tautan tidak valid' };
  if (u.pathname === '/' || u.pathname === '') return { ok: false, alasan: 'Tautan harus menunjuk ke berkas gambar' };
  return { ok: true, url: teks };
}

/** True bila URL berasal dari bucket publik R2 area umkm-photos. */
export function adalahUrlFotoR2(url: string, publikBase: string): boolean {
  return !!publikBase && url.startsWith(`${publikBase.replace(/\/+$/, '')}/umkm-photos/`);
}
