// Kompresi foto di browser sebelum diunggah: sisi terpanjang dibatasi lalu dikodekan JPEG berkualitas tinggi.
// 1280 px + kualitas 0,82 menghasilkan sekitar 80-200 KB untuk foto wajah/webcam tanpa penurunan yang terlihat.

export const SISI_MAKS_PX = 1280;
export const KUALITAS_JPEG = 0.82;

/** Ukuran tujuan dengan rasio tetap; tidak pernah memperbesar. */
export function hitungUkuran(lebar: number, tinggi: number, maks = SISI_MAKS_PX): { lebar: number; tinggi: number } {
  if (!(lebar > 0) || !(tinggi > 0)) return { lebar: 0, tinggi: 0 };
  const skala = Math.min(1, maks / Math.max(lebar, tinggi));
  return { lebar: Math.max(1, Math.round(lebar * skala)), tinggi: Math.max(1, Math.round(tinggi * skala)) };
}

/** Gambar (video/gambar/bitmap) -> Blob JPEG terkompresi. Melempar bila kanvas tidak tersedia. */
export async function kompresKeJpeg(
  sumber: CanvasImageSource,
  lebarAsli: number,
  tinggiAsli: number,
  opsi: { maks?: number; kualitas?: number } = {},
): Promise<Blob> {
  const { lebar, tinggi } = hitungUkuran(lebarAsli, tinggiAsli, opsi.maks);
  if (!lebar) throw new Error('Gambar kosong');
  const canvas = document.createElement('canvas');
  canvas.width = lebar;
  canvas.height = tinggi;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kanvas tidak tersedia');
  ctx.drawImage(sumber, 0, 0, lebar, tinggi);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Gagal memampatkan foto'))),
      'image/jpeg',
      opsi.kualitas ?? KUALITAS_JPEG,
    );
  });
}

/** Berkas gambar pilihan pengguna (galeri/kamera ponsel) -> JPEG terkompresi. */
export async function kompresBerkas(berkas: File): Promise<Blob> {
  const bitmap = await createImageBitmap(berkas);
  try {
    return await kompresKeJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
