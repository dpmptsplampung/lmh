// Logika murni skrip migrasi berkas Supabase Storage -> Cloudflare R2 (diuji di lib.test.ts).

/** Pemetaan bucket Supabase -> bucket R2 + awalan kunci. Bucket tak dikenal = galat jelas. */
const PETA = {
  'investment-docs': { bucket: 'private', awalan: 'investment-docs' },
  'absensi-foto': { bucket: 'private', awalan: 'absensi-foto' },
  'pengaduan-bukti': { bucket: 'private', awalan: 'pengaduan-bukti' },
  'umkm-legalitas': { bucket: 'private', awalan: 'umkm-legalitas' },
  'umkm-photos': { bucket: 'public', awalan: 'umkm-photos' },
};

export const BUCKET_SUMBER = Object.keys(PETA);

export function petakanObjek(bucketSupabase, path) {
  const p = PETA[bucketSupabase];
  if (!p) throw new Error(`Bucket tidak dikenal: ${bucketSupabase}`);
  if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`Path tidak valid: ${path}`);
  return { bucket: p.bucket, key: `${p.awalan}/${path}` };
}

/** Lewati bila objek di R2 sudah ada dengan ukuran sama (idempoten, aman diulang). */
export function perluDisalin(ukuranSumber, headR2) {
  return !headR2 || headR2.size !== ukuranSumber;
}

/** Ganti awalan URL publik Supabase `umkm-photos` menjadi basis publik R2; URL lain tidak diubah. */
export function tulisUlangUrl(url, publikBase) {
  const m = /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/umkm-photos\/(.+)$/.exec(url);
  if (!m) return url;
  return `${publikBase.replace(/\/+$/, '')}/umkm-photos/${m[1]}`;
}

export function ringkas(daftar) {
  const per = {};
  for (const d of daftar) {
    per[d.bucket] ??= { jumlah: 0, byte: 0 };
    per[d.bucket].jumlah += 1;
    per[d.bucket].byte += d.ukuran ?? 0;
  }
  return per;
}
