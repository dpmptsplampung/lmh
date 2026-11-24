import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { bukaPdf, buatVarianWeb } from '../src/app/api/investment-docs/_logika/pdf';
import { ekstrakTautan } from '../src/app/api/investment-docs/_logika/ekstraksi-tautan';
import { pathTautan, pathVarianWeb } from '../src/lib/investasi/aset-halaman';
import { jumlahHalamanSiapBaca } from '../src/lib/investasi/dokumen';
import { cocokMagicBytes, kunciObjek } from '../src/lib/storage/area';

class GalatBackfill extends Error {}

export function bacaOpsiBackfill(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'doc-id': { type: 'string' }, pdf: { type: 'string' }, 'dry-run': { type: 'boolean' },
      terapkan: { type: 'boolean' }, paksa: { type: 'boolean' },
    },
  });
  const id = z.uuid().safeParse(values['doc-id']?.toLowerCase());
  if (!id.success || !values.pdf?.trim() || (values.terapkan && values['dry-run'])) {
    throw new GalatBackfill('Gunakan --doc-id <uuid> --pdf <path> [--dry-run | --terapkan] [--paksa].');
  }
  return { id: id.data, pdf: values.pdf, terapkan: values.terapkan ?? false, paksa: values.paksa ?? false };
}

type Dokumen = Parameters<typeof jumlahHalamanSiapBaca>[0];
type HasilSimpan = 'ditulis' | 'dilewati';
type TipeBerkas = 'image/webp' | 'application/json';
type Layanan = {
  bacaDokumen(id: string): Promise<Dokumen | null>;
  adaObjek(key: string): Promise<boolean>;
  bacaObjek(key: string): Promise<Uint8Array | null>;
  simpanObjek(key: string, data: Buffer, tipe: TipeBerkas, paksa: boolean): Promise<HasilSimpan>;
};

async function bacaTautanLokal(path: string, jumlah: number) {
  try {
    const berkas = await readFile(path);
    const bytes = new Uint8Array(berkas.buffer, berkas.byteOffset, berkas.byteLength);
    const pdf = await bukaPdf(bytes, 'tautan-lokal');
    try {
      if (pdf.doc.numPages !== jumlah) throw new GalatBackfill('Jumlah halaman PDF lokal berbeda dari dokumen tujuan.');
      return await ekstrakTautan(pdf.doc);
    } finally { await pdf.tutup(); }
  } catch (error) {
    if (error instanceof GalatBackfill) throw error;
    throw new GalatBackfill('PDF lokal tidak dapat dibaca atau ekstraksi tautan gagal.');
  }
}

export async function lengkapiVarianWeb(opsi: ReturnType<typeof bacaOpsiBackfill>, layanan: Layanan) {
  const { id, pdf, terapkan, paksa } = opsi;
  const doc = await layanan.bacaDokumen(id);
  if (!doc) throw new GalatBackfill('Dokumen tujuan tidak ditemukan.');
  const jumlah = jumlahHalamanSiapBaca(doc);
  if (!jumlah || jumlah !== doc.jumlah_halaman || doc.halaman_gambar?.length !== jumlah) {
    throw new GalatBackfill('Metadata halaman dokumen tujuan belum lengkap.');
  }

  const keKunci = (path: string) => kunciObjek('investment-docs', path);
  const halaman = doc.halaman_gambar.map((png, index) => {
    const nomor = index + 1;
    const web = png ? pathVarianWeb(png) : null;
    if (!png || !png.startsWith(`pages/${id}/`) || basename(png) !== `page-${nomor}.png` || !web) {
      throw new GalatBackfill(`Path halaman ${nomor} di metadata dokumen tidak sesuai.`);
    }
    return { nomor, png: keKunci(png), web: keKunci(web) };
  });

  const kunciTautan = keKunci(pathTautan(id));
  const adaTautan = !paksa && await layanan.adaObjek(kunciTautan);
  const tautan = adaTautan ? null : await bacaTautanLokal(pdf, jumlah);
  const hasilHalaman = { total: jumlah, rencana: 0, ditulis: 0, dilewati: 0, gagal: [] as number[] };
  let lanjut = 0;
  async function pekerja() {
    while (lanjut < halaman.length) {
      const { nomor, png, web } = halaman[lanjut++];
      try {
        if (!paksa && await layanan.adaObjek(web)) hasilHalaman.dilewati++;
        else if (!terapkan) hasilHalaman.rencana++;
        else {
          const bytes = await layanan.bacaObjek(png);
          if (!bytes || !cocokMagicBytes('image/png', bytes)) throw new Error('PNG tidak tersedia atau rusak');
          const data = await buatVarianWeb(bytes);
          const hasil = await layanan.simpanObjek(web, data, 'image/webp', paksa);
          hasilHalaman[hasil]++;
        }
      } catch { hasilHalaman.gagal.push(nomor); }
    }
  }
  await Promise.all([pekerja(), pekerja(), pekerja()]);
  hasilHalaman.gagal.sort((a, b) => a - b);

  let status: HasilSimpan | 'rencana' | 'tertunda' | 'gagal' = 'dilewati';
  if (tautan) {
    if (hasilHalaman.gagal.length) status = 'tertunda';
    else if (!terapkan) status = 'rencana';
    else {
      try {
        status = await layanan.simpanObjek(kunciTautan, Buffer.from(JSON.stringify(tautan)), 'application/json', paksa);
      } catch { status = 'gagal'; }
    }
  }
  return {
    mode: terapkan ? 'terapkan' : 'dry-run', halaman: hasilHalaman,
    tautan: { status, jumlah: tautan?.tautan.length },
  };
}

async function sambung(terapkan: boolean): Promise<Layanan> {
  const supabase = URL.parse(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const akun = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET_PRIVATE?.trim();
  const bucketPublik = process.env.R2_BUCKET_PUBLIC?.trim();
  if (!supabase || supabase.protocol !== 'https:' || supabase.username || supabase.password
    || supabase.pathname !== '/' || supabase.search || supabase.hash || !akun || !/^[\da-f]{32}$/i.test(akun)
    || !bucket || !/^[a-z\d][a-z\d-]*[a-z\d]$/.test(bucket) || !bucketPublik || bucket === bucketPublik) {
    throw new GalatBackfill('Isi URL Supabase dan konfigurasi R2 dengan bucket privat terpisah dari lingkungan tujuan.');
  }
  const endpoint = `https://${akun}.r2.cloudflarestorage.com`;
  console.log(`Supabase ${supabase.host}, R2 ${new URL(endpoint).host} (bucket privat ${bucket}).`);
  console.log(terapkan ? 'Mode terapkan.' : 'Dry-run. Hanya baca metadata dokumen dan keberadaan varian.');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!key || !accessKeyId || !secretAccessKey) throw new GalatBackfill('Kredensial Supabase dan R2 belum tersedia.');

  const [{ createClient }, { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand }] = await Promise.all([
    import('@supabase/supabase-js'), import('@aws-sdk/client-s3'),
  ]);
  const r2 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
  const client = createClient(supabase.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const statusS3 = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return {
    async bacaDokumen(id) {
      const { data, error } = await client.from('investment_documents').select('jumlah_halaman, halaman_gambar').eq('id', id).maybeSingle();
      if (error) throw new GalatBackfill('Pemeriksaan baris Supabase gagal.');
      return data;
    },
    async adaObjek(Key) {
      try {
        await r2.send(new HeadObjectCommand({ Bucket: bucket, Key }));
        return true;
      } catch (error) {
        if (statusS3(error) === 404) return false;
        throw error;
      }
    },
    async bacaObjek(Key) {
      try {
        const hasil = await r2.send(new GetObjectCommand({ Bucket: bucket, Key }));
        return await hasil.Body?.transformToByteArray() ?? null;
      } catch (error) {
        if (statusS3(error) === 404) return null;
        throw error;
      }
    },
    async simpanObjek(Key, Body, ContentType, paksa) {
      try {
        await r2.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType, IfNoneMatch: paksa ? undefined : '*' }));
        return 'ditulis';
      } catch (error) {
        if (!paksa && statusS3(error) === 412) return 'dilewati';
        throw error;
      }
    },
  };
}

async function utama() {
  const opsi = bacaOpsiBackfill(process.argv.slice(2));
  const mulai = performance.now();
  const hasil = await lengkapiVarianWeb(opsi, await sambung(opsi.terapkan));
  console.log(JSON.stringify({ id: opsi.id, ...hasil, total_ms: Math.round(performance.now() - mulai) }));
  if (hasil.halaman.gagal.length || hasil.tautan.status === 'gagal') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  utama().catch((error: unknown) => {
    console.error(error instanceof GalatBackfill ? error.message
      : 'Backfill gagal. Periksa argumen, berkas PDF lokal, atau koneksi layanan tujuan.');
    process.exitCode = 1;
  });
}
