// Mengganti URL publik Supabase `umkm-photos` di listing_umkm.foto_produk dan investment_documents.image_url menjadi URL R2.
//   doppler run --project lmh --config prd -- node scripts/migrasi-r2/tulis-ulang-url-umkm.mjs            # dry-run (hanya menghitung)
//   doppler run --project lmh --config prd -- node scripts/migrasi-r2/tulis-ulang-url-umkm.mjs --jalankan # tulis (SATU transaksi)
// Jalankan SETELAH salin-dari-supabase.mjs --jalankan. Hanya host DB yang dicetak (tanpa kredensial).
import pg from 'pg';
import { tulisUlangUrl } from './lib.mjs';

const jalankan = process.argv.includes('--jalankan');
const { DIRECT_URL, R2_PUBLIC_BASE_URL } = process.env;
if (!DIRECT_URL || !R2_PUBLIC_BASE_URL) { console.error('DIRECT_URL / R2_PUBLIC_BASE_URL belum ada (jalankan lewat doppler).'); process.exit(1); }
console.log(`Mode: ${jalankan ? 'TULIS' : 'DRY-RUN'} | host DB: ${new URL(DIRECT_URL).hostname}`);

const c = new pg.Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let terdampak = 0;
try {
  await c.query('BEGIN');
  const { rows } = await c.query('SELECT id, foto_produk FROM public.listing_umkm WHERE foto_produk IS NOT NULL');
  for (const r of rows) {
    const baru = r.foto_produk.map((u) => tulisUlangUrl(u, R2_PUBLIC_BASE_URL));
    if (baru.some((u, i) => u !== r.foto_produk[i])) {
      terdampak++;
      if (jalankan) await c.query('UPDATE public.listing_umkm SET foto_produk = $1 WHERE id = $2', [baru, r.id]);
    }
  }
  const kol = await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='investment_documents' AND column_name='image_url'");
  let gambar = 0;
  if (kol.rowCount) {
    const { rows: docs } = await c.query('SELECT id, image_url FROM public.investment_documents WHERE image_url IS NOT NULL');
    for (const d of docs) {
      const baru = tulisUlangUrl(d.image_url, R2_PUBLIC_BASE_URL);
      if (baru !== d.image_url) {
        gambar++;
        if (jalankan) await c.query('UPDATE public.investment_documents SET image_url = $1 WHERE id = $2', [baru, d.id]);
      }
    }
  }
  console.log(`listing_umkm terdampak: ${terdampak} | investment_documents.image_url terdampak: ${gambar}`);
  await c.query(jalankan ? 'COMMIT' : 'ROLLBACK');
  console.log(jalankan ? 'DITULIS (COMMIT).' : 'Dry-run: tidak ada perubahan (ROLLBACK).');
} catch (err) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('GAGAL:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
