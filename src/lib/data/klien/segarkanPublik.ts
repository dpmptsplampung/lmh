// Helper klien: setelah admin menyimpan data yang dibaca halaman publik, minta server membuang cache-nya
// (POST /api/admin/revalidasi -> revalidateTag). Rencana refaktor 4.5, SPEC bagian 5 "Cache".
//
// Sengaja DIAM: semua galat (jaringan, 401/403/500, fetch tidak ada) diabaikan, tidak melempar dan tidak memunculkan
// toast. Penyimpanan admin sudah berhasil dan itu yang dilihat pengguna; kegagalan di sini hanya berarti halaman
// publik baru segar paling lama sampai `revalidate = 60` detik berikutnya.
//
// Daftar tag sengaja ditulis ulang di sini (bukan diimpor dari lib/data/publik-server yang `server-only`);
// route.test.ts menjaga agar daftar ini tidak pernah melampaui daftar izin di server.
export const TAG_PUBLIK_KLIEN = {
  beranda: 'publik-beranda',
  layanan: 'publik-layanan',
  faq: 'publik-faq',
} as const;
export type TagPublikKlien = (typeof TAG_PUBLIK_KLIEN)[keyof typeof TAG_PUBLIK_KLIEN];

async function segarkanSatu(tag: TagPublikKlien): Promise<void> {
  try {
    // `keepalive`: permintaan tetap selesai walau admin langsung berpindah halaman setelah menyimpan.
    await fetch('/api/admin/revalidasi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
      keepalive: true,
    });
  } catch {
    // diabaikan dengan sengaja (lihat catatan di atas)
  }
}

/** Satu POST per tag (tag kembar digabung). Tidak pernah melempar; aman dipakai dengan `void segarkanPublik(...)`. */
export async function segarkanPublik(tag: TagPublikKlien | TagPublikKlien[]): Promise<void> {
  const daftar = [...new Set(Array.isArray(tag) ? tag : [tag])];
  await Promise.all(daftar.map(segarkanSatu));
}
