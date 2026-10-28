// Menyalin berkas Supabase Storage -> Cloudflare R2. TIDAK pernah menghapus apa pun di Supabase.
//   doppler run --project lmh --config prd -- node scripts/migrasi-r2/salin-dari-supabase.mjs            # dry-run (hanya mencacah)
//   doppler run --project lmh --config prd -- node scripts/migrasi-r2/salin-dari-supabase.mjs --jalankan # salin
// Idempoten: objek yang sudah ada di R2 dengan ukuran sama dilewati (aman diulang setelah deploy).
import { createClient } from '@supabase/supabase-js';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BUCKET_SUMBER, perluDisalin, petakanObjek, ringkas } from './lib.mjs';

const jalankan = process.argv.includes('--jalankan');
const e = process.env;
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PRIVATE', 'R2_BUCKET_PUBLIC']) {
  if (!e[k]) { console.error(`Env ${k} belum ada (jalankan lewat doppler).`); process.exit(1); }
}
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
});
const namaBucketR2 = (b) => (b === 'private' ? e.R2_BUCKET_PRIVATE : e.R2_BUCKET_PUBLIC);
console.log(`Mode: ${jalankan ? 'SALIN' : 'DRY-RUN'} | Supabase: ${new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname} | R2 akun ${e.R2_ACCOUNT_ID.slice(0, 4)}…`);

async function daftarSemua(bucket, awalan = '') {
  const hasil = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(awalan, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${awalan}: ${error.message}`);
    if (!data?.length) break;
    for (const o of data) {
      const path = awalan ? `${awalan}/${o.name}` : o.name;
      if (o.id === null || o.metadata == null) hasil.push(...(await daftarSemua(bucket, path))); // folder
      else hasil.push({ bucket, path, ukuran: o.metadata.size ?? 0, mime: o.metadata.mimetype });
    }
    if (data.length < 1000) break;
  }
  return hasil;
}

const semua = [];
for (const b of BUCKET_SUMBER) {
  try {
    semua.push(...(await daftarSemua(b)));
  } catch (err) {
    console.log(`  (lewati bucket ${b}: ${err.message})`);
  }
}
console.log('Inventaris Supabase:', JSON.stringify(ringkas(semua)));

let disalin = 0, dilewati = 0;
const gagal = [];
for (const o of semua) {
  const { bucket, key } = petakanObjek(o.bucket, o.path);
  let head = null;
  try {
    const h = await r2.send(new HeadObjectCommand({ Bucket: namaBucketR2(bucket), Key: key }));
    head = { size: h.ContentLength ?? 0 };
  } catch { head = null; }
  if (!perluDisalin(o.ukuran, head)) { dilewati++; continue; }
  if (!jalankan) { disalin++; continue; }
  try {
    const { data, error } = await sb.storage.from(o.bucket).download(o.path);
    if (error || !data) throw new Error(error?.message ?? 'kosong');
    const bytes = new Uint8Array(await data.arrayBuffer());
    await r2.send(new PutObjectCommand({ Bucket: namaBucketR2(bucket), Key: key, Body: bytes, ContentType: o.mime || data.type || 'application/octet-stream' }));
    disalin++;
  } catch (err) {
    gagal.push(`${o.bucket}/${o.path}: ${err.message}`);
  }
}
console.log(`${jalankan ? 'Disalin' : 'Perlu disalin'}: ${disalin} | dilewati (sudah ada): ${dilewati} | gagal: ${gagal.length}`);
for (const g of gagal.slice(0, 50)) console.log('  GAGAL', g);
process.exit(gagal.length ? 1 : 0);
