import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { bukaPdf, MAKS_BYTE, renderHalaman } from '../src/app/api/investment-docs/_logika/pdf';
import { metadataDokumen } from '../src/app/api/investment-docs/_logika/metadata';
import { barisDokumenOffline, idDokumenOffline, kunciDokumenOffline } from '../src/app/api/investment-docs/_logika/terbit-offline';

const argumen = z.object({
  berkas: z.string().min(1),
  judul: metadataDokumen.judul,
  kategori: z.literal('Peta Potensi'),
  deskripsi: metadataDokumen.deskripsi,
  urutan: z.string().regex(/^\d+$/).transform(Number).pipe(metadataDokumen.urutan_tampil),
  'render-lokal': z.string().min(1).optional(),
  terbitkan: z.boolean().optional(),
  terapkan: z.boolean().optional(),
  yes: z.boolean().optional(),
});

class GalatTerbit extends Error {}

function bacaArgumen() {
  const { values } = parseArgs({
    options: {
      berkas: { type: 'string' }, judul: { type: 'string' }, kategori: { type: 'string' },
      deskripsi: { type: 'string' }, urutan: { type: 'string' }, 'render-lokal': { type: 'string' },
      terbitkan: { type: 'boolean' }, terapkan: { type: 'boolean' }, yes: { type: 'boolean' },
    },
  });
  const parsed = argumen.safeParse(values);
  if (!parsed.success || Boolean(values['render-lokal']) === Boolean(values.terbitkan)
    || (!values.terbitkan && (values.terapkan || values.yes))) {
    throw new GalatTerbit("Gunakan --berkas <pdf> --judul <judul> --kategori 'Peta Potensi' --deskripsi <teks> --urutan <angka> dengan --render-lokal <dir> atau --terbitkan [--terapkan] [--yes].");
  }
  return parsed.data;
}

async function tujuanTerbit(terapkan: boolean, yes: boolean) {
  const supabase = URL.parse(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const akunR2 = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET_PRIVATE?.trim();
  if (!supabase || supabase.protocol !== 'https:' || supabase.username || supabase.password
    || supabase.pathname !== '/' || supabase.search || supabase.hash
    || !akunR2 || !/^[\da-f]{32}$/i.test(akunR2) || !bucket || !/^[a-z\d][a-z\d-]*[a-z\d]$/.test(bucket)) {
    throw new GalatTerbit('Isi NEXT_PUBLIC_SUPABASE_URL, R2_ACCOUNT_ID dan R2_BUCKET_PRIVATE dari lingkungan tujuan.');
  }
  console.log(`Supabase ${supabase.host}, R2 ${akunR2}.r2.cloudflarestorage.com (bucket privat ${bucket}).`);
  console.log(terapkan ? 'Mode terapkan.' : 'Dry-run. Rencana dihitung secara lokal.');
  if (!yes) {
    if (!process.stdin.isTTY) throw new GalatTerbit('Gunakan terminal interaktif untuk konfirmasi atau berikan --yes.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (await rl.question('Ketik LANJUT untuk mengonfirmasi tujuan: ') !== 'LANJUT') {
        throw new GalatTerbit('Tujuan belum dikonfirmasi.');
      }
    } finally { rl.close(); }
  }
  return { url: supabase.origin, endpoint: `https://${akunR2}.r2.cloudflarestorage.com`, bucket };
}

type Rencana = ReturnType<typeof kunciDokumenOffline>;
type Baris = ReturnType<typeof barisDokumenOffline>;

async function sambungProduksi(tujuan: Awaited<ReturnType<typeof tujuanTerbit>>, id: string, rencana: Rencana) {
  const [{ createClient }, { S3Client, HeadObjectCommand, PutObjectCommand }] = await Promise.all([
    import('@supabase/supabase-js'), import('@aws-sdk/client-s3'),
  ]);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketPublik = process.env.R2_BUCKET_PUBLIC?.trim();
  if (!key || !accessKeyId || !secretAccessKey || !bucketPublik || tujuan.bucket === bucketPublik) {
    throw new GalatTerbit('Kredensial Supabase dan konfigurasi R2 dengan bucket privat terpisah diperlukan.');
  }
  const r2 = new S3Client({ region: 'auto', endpoint: tujuan.endpoint, credentials: { accessKeyId, secretAccessKey } });
  const tabel = createClient(tujuan.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).from('investment_documents');

  async function bacaBaris() {
    const { data, error } = await tabel.select('id, status, file_path, jumlah_halaman, halaman_selesai, halaman_gambar')
      .eq('id', id).maybeSingle();
    if (error) throw new GalatTerbit('Pemeriksaan baris Supabase gagal.');
    const jumlah = rencana.halaman.length;
    if (data && (data.file_path !== rencana.sumber.path || data.jumlah_halaman !== jumlah
      || data.halaman_selesai !== jumlah || !['nonaktif', 'aktif'].includes(data.status)
      || !Array.isArray(data.halaman_gambar) || data.halaman_gambar.length !== jumlah
      || rencana.halaman.some(({ path }, index) => data.halaman_gambar[index] !== path))) {
      throw new GalatTerbit(`Baris ${id} sudah ada dengan aset atau status berbeda.`);
    }
    return data;
  }

  const sudahAda = await bacaBaris();
  const statusS3 = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  async function bacaObjek(Key: string) {
    try {
      return await r2.send(new HeadObjectCommand({ Bucket: tujuan.bucket, Key }));
    } catch (error) {
      if (statusS3(error) === 404) return null;
      throw new GalatTerbit(`Pemeriksaan objek R2 gagal untuk ${Key}.`);
    }
  }
  return {
    async simpanObjek(kunci: string, bytes: Buffer, tipe: 'image/png' | 'application/pdf') {
      // PUT tunggal Cloudflare R2 menghasilkan ETag MD5, termasuk untuk PDF sumber.
      const etag = createHash('md5').update(bytes).digest('hex');
      let objek = await bacaObjek(kunci);
      let tindakan = 'sudah ada';
      if (!objek) {
        try {
          await r2.send(new PutObjectCommand({
            Bucket: tujuan.bucket, Key: kunci, Body: bytes, ContentType: tipe, IfNoneMatch: '*',
          }));
          tindakan = 'diunggah';
        } catch (error) {
          if (statusS3(error) !== 412) throw new GalatTerbit(`Unggah R2 gagal untuk ${kunci}. Ulangi perintah yang sama.`);
        }
        objek = await bacaObjek(kunci);
      }
      if (objek?.ContentLength !== bytes.length || objek.ContentType !== tipe || objek.ETag?.replaceAll('"', '') !== etag) {
        throw new GalatTerbit(`Ukuran, tipe, atau checksum R2 tidak cocok untuk ${kunci}.`);
      }
      return tindakan;
    },
    async simpanBaris(baris: Baris) {
      if (sudahAda) return { id: sudahAda.id, baru: false };
      const { data, error } = await tabel.upsert(baris, { onConflict: 'id', ignoreDuplicates: true })
        .select('id').maybeSingle();
      if (error) throw new GalatTerbit('Penulisan baris Supabase gagal. Ulangi perintah yang sama untuk melanjutkan.');
      if (data) return { id: data.id, baru: true };
      const tersimpan = await bacaBaris();
      if (!tersimpan) throw new GalatTerbit('Baris Supabase belum terkonfirmasi.');
      return { id: tersimpan.id, baru: false };
    },
  };
}

async function bacaBerkas(path: string): Promise<Buffer> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size < 5 || info.size > MAKS_BYTE) {
    throw new GalatTerbit('Berkas harus berupa PDF dengan ukuran paling banyak 50 MiB.');
  }
  return readFile(path).catch(() => { throw new GalatTerbit('PDF sumber tidak dapat dibaca.'); });
}

async function utama() {
  const mulai = performance.now();
  const args = bacaArgumen();
  const direktori = args['render-lokal'];
  const tujuan = args.terbitkan ? await tujuanTerbit(!!args.terapkan, !!args.yes) : undefined;
  const bytes = await bacaBerkas(args.berkas);
  const id = idDokumenOffline(bytes);
  // PDF.js dapat mengambil alih Uint8Array. Lepaskan salinan yang diberikan dari buffer PDF asli.
  const pdf = await bukaPdf(new Uint8Array(bytes), 'offline').catch(() => {
    throw new GalatTerbit('PDF tidak valid, terenkripsi, atau melampaui batas halaman tersaji.');
  });
  const halamanSelesai: string[] = [];
  let pngBytes = 0;
  let terlama = { halaman: 0, ms: 0 };
  let terbesar = { halaman: 0, byte: 0 };
  try {
    const rencana = kunciDokumenOffline(id, pdf.doc.numPages);
    const produksi = tujuan && args.terapkan ? await sambungProduksi(tujuan, id, rencana) : undefined;
    if (direktori) await mkdir(direktori, { recursive: true });
    for (const [index, objek] of rencana.halaman.entries()) {
      const halaman = index + 1;
      const awal = performance.now();
      const png = await renderHalaman(pdf.doc, halaman).catch(() => {
        console.warn(`Peringatan: halaman ${halaman} gagal dirender.`);
        return null;
      });
      const ms = performance.now() - awal;
      if (ms > terlama.ms) terlama = { halaman, ms };
      if (!png) continue;
      if (png.length > terbesar.byte) terbesar = { halaman, byte: png.length };
      if (direktori) {
        await writeFile(join(direktori, `page-${halaman}.png`), png, { flag: 'wx' });
      } else {
        const tindakan = await produksi?.simpanObjek(objek.kunci, png, 'image/png');
        console.log(`${objek.kunci} ${png.length} byte${tindakan ? ` (${tindakan})` : ''}`);
      }
      pngBytes += png.length;
      halamanSelesai.push(objek.path);
    }
    const baris = barisDokumenOffline(id, {
      judul: args.judul, kategori: args.kategori, deskripsi: args.deskripsi, urutan_tampil: args.urutan,
    }, rencana, halamanSelesai);
    if (direktori) return;
    const tindakan = await produksi?.simpanObjek(rencana.sumber.kunci, bytes, 'application/pdf');
    console.log(`${rencana.sumber.kunci} ${bytes.length} byte${tindakan ? ` (${tindakan})` : ''}`);
    if (!produksi) console.log(JSON.stringify({ tabel: 'investment_documents', baris }, null, 2));
    else {
      const hasil = await produksi.simpanBaris(baris);
      console.log(hasil.baru ? `Baris nonaktif dibuat dengan ID ${hasil.id}.` : `Baris sudah ada dengan ID ${hasil.id}.`);
    }
  } finally {
    await pdf.tutup();
    const gagal = pdf.doc.numPages - halamanSelesai.length;
    console.log(JSON.stringify({
      id, jumlah_halaman: pdf.doc.numPages, selesai: halamanSelesai.length, gagal_atau_belum_diproses: gagal,
      total_ms: Math.round(performance.now() - mulai),
      render_terlama: { ...terlama, ms: Math.round(terlama.ms) }, png_terbesar: terbesar,
      puncak_rss_byte: process.resourceUsage().maxRSS * 1024,
      png_byte: pngBytes, pdf_byte: bytes.length, total_byte: pngBytes + bytes.length,
    }));
  }
}

utama().catch(error => {
  const aman = error instanceof GalatTerbit || (error instanceof Error && (
    error.message.startsWith('Pemeriksaan kelengkapan') || error.name === 'TypeError' && 'code' in error
    && String(error.code).startsWith('ERR_PARSE_ARGS_')
  ));
  console.error(aman ? error.message : 'Proses gagal saat mengakses aset atau layanan tujuan. Periksa izin, direktori kosong, dan konfigurasi.');
  process.exitCode = 1;
});
