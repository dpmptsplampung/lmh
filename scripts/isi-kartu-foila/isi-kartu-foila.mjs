// Mengisi kartu FOILA (draf) di LMH dari API publik FOILA. Menyentuh DB dan R2 PRODUKSI saat --terapkan.
//   doppler run --project lmh --config prd -- node scripts/isi-kartu-foila/isi-kartu-foila.mjs             # dry-run: baca FOILA + DB, tidak menulis
//   doppler run --project lmh --config prd -- node scripts/isi-kartu-foila/isi-kartu-foila.mjs --terapkan  # tulis
// Idempoten: proyek yang sumber_url-nya sudah ada dilewati. Selalu berstatus draf; tidak menerbitkan, tidak mengubah baris lain.
// Gambar: thumbnail resmi FOILA diunduh, diolah seperti olahGambarIpro (webp 1600 dan 640), diunggah ke R2 publik kita (tanpa hotlink).
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { API_FOILA, petakanProyek, teksAlt, urlThumbnail } from './lib.mjs';

const terapkan = process.argv.includes('--terapkan');
const e = process.env;
for (const k of ['DIRECT_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_PUBLIC']) {
  if (!e[k]) { console.error(`Env ${k} belum ada (jalankan lewat doppler).`); process.exit(1); }
}
const hostDb = new URL(e.DIRECT_URL).hostname;
console.log(`Mode: ${terapkan ? 'TERAPKAN' : 'DRY-RUN'} | DB host: ${hostDb} | R2 akun ${e.R2_ACCOUNT_ID.slice(0, 4)}…`);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY },
});
const UA = { 'User-Agent': 'Mozilla/5.0 (DPMPTSP Lampung)' };

const res = await fetch(API_FOILA, { headers: { ...UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`API FOILA ${res.status}`);
const proyek = (await res.json()).filter((p) => p.status === 'PUBLISHED');
console.log(`Proyek FOILA terbit: ${proyek.length}`);
const baris = proyek.map(petakanProyek); // melempar bila ada yang belum dipetakan: berhenti sebelum menulis apa pun

const db = new pg.Client({ connectionString: e.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const ada = await db.query('SELECT sumber_url, slug FROM public.ipro_proyek');
  const urlAda = new Set(ada.rows.map((r) => r.sumber_url));
  const slugAda = new Set(ada.rows.map((r) => r.slug));
  const rencana = [];
  for (const b of baris) {
    let status = 'BARU';
    if (urlAda.has(b.sumber_url)) status = 'SUDAH ADA (dilewati)';
    else if (slugAda.has(b.slug)) status = 'SLUG BENTROK (dilewati)';
    rencana.push({ b, status });
    console.log(`- ${status.padEnd(24)} ${b.sektor.padEnd(13)} ${b.kab_kota.padEnd(24)} ${b.judul.slice(0, 60)}`);
  }
  if (!terapkan) { console.log('Dry-run selesai: tidak ada yang ditulis.'); process.exit(0); }

  for (const { b, status } of rencana) {
    if (status !== 'BARU') continue;
    const dibuat = [];
    try {
      const img = await fetch(urlThumbnail(b.thumbnail), { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!img.ok) throw new Error(`thumbnail ${img.status}`);
      const bytes = Buffer.from(await img.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new Error('thumbnail > 8 MiB');
      const dasar = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
      const meta = await dasar.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error(`format gambar tak didukung: ${meta.format}`);
      const [besar, kecil] = await Promise.all([
        dasar.clone().resize({ width: 1600, height: 4000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true }),
        dasar.clone().resize({ width: 640, height: 4000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
      ]);
      if (besar.data.length > 2 * 1024 * 1024 || kecil.length > 2 * 1024 * 1024) throw new Error('hasil olahan > 2 MiB');

      await db.query('BEGIN');
      const ins = await db.query(
        `INSERT INTO public.ipro_proyek (sumber, status, slug, judul, judul_en, ringkasan, ringkasan_en, sektor, kab_kota,
           nilai_investasi, mata_uang, nilai_teks, sumber_url, sumber_slug, urutan)
         VALUES ('foila','draf',$1,$2,$3,$4,$5,$6,$7,NULL,'IDR',NULL,$8,$9,0) RETURNING id`,
        [b.slug, b.judul, b.judul_en, b.ringkasan, b.ringkasan_en, b.sektor, b.kab_kota, b.sumber_url, b.sumber_slug]);
      const id = ins.rows[0].id;
      const dasarKunci = `ipro-gambar/${id}/${randomUUID()}`;
      const kunci = `${dasarKunci}.webp`;
      const kunciMini = `${dasarKunci}-640.webp`;
      await r2.send(new PutObjectCommand({ Bucket: e.R2_BUCKET_PUBLIC, Key: kunci, Body: besar.data, ContentType: 'image/webp' }));
      dibuat.push(kunci);
      await r2.send(new PutObjectCommand({ Bucket: e.R2_BUCKET_PUBLIC, Key: kunciMini, Body: kecil, ContentType: 'image/webp' }));
      dibuat.push(kunciMini);
      await db.query(
        `INSERT INTO public.ipro_gambar (proyek_id, kunci, kunci_mini, lebar, tinggi, alt, utama, urutan)
         VALUES ($1,$2,$3,$4,$5,$6,true,0)`,
        [id, kunci, kunciMini, besar.info.width, besar.info.height, teksAlt(b.judul)]);
      await db.query('COMMIT');
      console.log(`  OK ${b.sumber_slug} -> ${id} (${besar.info.width}x${besar.info.height})`);
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      if (dibuat.length) {
        await r2.send(new DeleteObjectsCommand({ Bucket: e.R2_BUCKET_PUBLIC, Delete: { Objects: dibuat.map((Key) => ({ Key })), Quiet: true } })).catch(() => {});
      }
      console.error(`  GAGAL ${b.sumber_slug}: ${err.message} (dibatalkan, tidak ada sisa)`);
      process.exitCode = 1;
    }
  }
} finally {
  await db.end();
}
