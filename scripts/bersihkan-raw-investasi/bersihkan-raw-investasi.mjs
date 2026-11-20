// Menyapu objek PDF sementara investasi (`investment-docs/raw/<uid>/<uuid>.pdf`) yang yatim lebih dari 24 jam di R2.
//   doppler run --project lmh --config prd -- node scripts/bersihkan-raw-investasi/bersihkan-raw-investasi.mjs             # dry-run (hanya mencacah)
//   doppler run --project lmh --config prd -- node scripts/bersihkan-raw-investasi/bersihkan-raw-investasi.mjs --hapus     # hapus
// Hanya menyentuh awalan raw/ dengan pola kunci sah; tidak pernah menyentuh src/ atau pages/. DB tidak disentuh.
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { AWALAN_RAW, BATAS_JAM, pilihYatim, ringkasan } from './lib.mjs';

const hapus = process.argv.includes('--hapus');
const e = process.env;
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PRIVATE']) {
  if (!e[k]) { console.error(`Env ${k} belum ada (jalankan lewat doppler).`); process.exit(1); }
}
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
});
console.log(`Mode: ${hapus ? 'HAPUS' : 'DRY-RUN'} | R2 akun ${e.R2_ACCOUNT_ID.slice(0, 4)}… | awalan ${AWALAN_RAW} | batas ${BATAS_JAM} jam`);

let cursor;
let totalLihat = 0;
const terpilihSemua = [];
do {
  const res = await r2.send(new ListObjectsV2Command({ Bucket: e.R2_BUCKET_PRIVATE, Prefix: AWALAN_RAW, ContinuationToken: cursor, MaxKeys: 1000 }));
  const daftar = (res.Contents ?? []).filter((o) => o.Key && o.LastModified)
    .map((o) => ({ key: o.Key, lastModified: o.LastModified, ukuran: o.Size ?? 0 }));
  totalLihat += daftar.length;
  const terpilih = pilihYatim(daftar);
  if (hapus && terpilih.length) {
    const h = await r2.send(new DeleteObjectsCommand({ Bucket: e.R2_BUCKET_PRIVATE, Delete: { Objects: terpilih.map((o) => ({ Key: o.key })), Quiet: true } }));
    if (h.Errors?.length) throw new Error(`Penghapusan sebagian gagal (${h.Errors.length} objek); hentikan dan periksa.`);
  }
  terpilihSemua.push(...terpilih);
  if (res.IsTruncated && !res.NextContinuationToken) throw new Error('Halaman objek belum lengkap');
  cursor = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (cursor);

const r = ringkasan(terpilihSemua);
console.log(`Objek raw/ dilihat: ${totalLihat} | yatim > ${BATAS_JAM} jam: ${r.jumlah} (${(r.byte / 1048576).toFixed(1)} MiB) | ${hapus ? 'DIHAPUS' : 'belum dihapus (dry-run)'}`);
