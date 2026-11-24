// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const admin = '00000000-0000-4000-8000-000000000001';
const warga = '00000000-0000-4000-8000-000000000002';
const docs = [1, 2, 3, 4].map(n => `10000000-0000-4000-8000-00000000000${n}`);
async function urutan(): Promise<{ id: string; urutan_tampil: number }[]> {
  const hasil = await db.query('SELECT id, urutan_tampil FROM public.investment_documents ORDER BY urutan_tampil, id');
  return hasil.rows;
}
const tukar = (uid: string | null, a: number, b: number, lamaA: number, lamaB: number) => sebagai(
  db, uid ? 'authenticated' : 'anon', uid,
  'SELECT public.investasi_tukar_urutan_dokumen($1, $2, $3, $4)', [docs[a], docs[b], lamaA, lamaB],
);

beforeAll(async () => {
  db = await bukaDbPenuh({ sampai: '202611240001' });
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id, email) VALUES ('${admin}', 'admin@example.invalid'), ('${warga}', 'warga@example.invalid');
    INSERT INTO public.petugas(auth_user_id, nama, role, aktif) VALUES ('${admin}', 'Admin Uji', 'admin', true);
    INSERT INTO public.investment_documents(id, judul, file_path, urutan_tampil, status) VALUES
      ('${docs[0]}', 'A', 'a.pdf', 10, 'aktif'), ('${docs[1]}', 'B', 'b.pdf', 20, 'nonaktif'),
      ('${docs[2]}', 'C', 'c.pdf', 30, 'aktif'), ('${docs[3]}', 'D', 'd.pdf', 30, 'diproses');
    INSERT INTO public.ipro_proyek(sumber, status, slug, judul, ringkasan, sektor, kab_kota, sumber_url, diterbitkan_pada) VALUES
      ('ptsp', 'terbit', 'publik-a', 'Proyek A', 'Ringkasan', 'energi', 'Kota A', NULL, now()),
      ('ptsp', 'terbit', 'publik-b', 'Proyek B', 'Ringkasan', 'energi', 'Kota B', NULL, now()),
      ('ptsp', 'draf', 'rancangan', 'Rancangan', 'Ringkasan', 'perikanan', 'Kota C', NULL, NULL),
      ('foila', 'terbit', 'kartu-foila', 'FOILA', 'Ringkasan', 'pariwisata', 'Kota D', 'https://invest.lampungprov.go.id/project/foila', now());
    SET session_replication_role = origin;
  `);
}, 60_000);
afterAll(async () => { await db?.close(); });

it('staf menukar tetangga, menolak harapan usang, dan mengatasi angka urutan seri', async () => {
  expect(await tukar(warga, 0, 1, 10, 20)).toMatchObject({ ok: false, kode: '42501' });
  expect(await tukar(null, 0, 1, 10, 20)).toMatchObject({ ok: false, kode: '42501' });
  expect(await tukar(admin, 0, 2, 10, 30)).toMatchObject({ ok: false, kode: '40001' });
  expect(await tukar(admin, 0, 1, 10, 20)).toMatchObject({ ok: true });
  expect(await tukar(admin, 0, 1, 10, 20)).toMatchObject({ ok: false, kode: '40001' });
  expect(await urutan()).toEqual([
    { id: docs[1], urutan_tampil: 10 }, { id: docs[0], urutan_tampil: 20 },
    { id: docs[2], urutan_tampil: 30 }, { id: docs[3], urutan_tampil: 30 },
  ]);
  expect(await tukar(admin, 2, 3, 30, 30)).toMatchObject({ ok: true });
  expect((await urutan()).map(d => d.id)).toEqual([docs[1], docs[0], docs[3], docs[2]]);
});

it('anonim memperoleh hitungan yang sama dengan admin, tanpa proyek FOILA atau draf', async () => {
  const angka = { jumlah_proyek: 2, jumlah_dokumen: 2, jumlah_sektor: 1, jumlah_wilayah: 2 };
  const sql = 'SELECT jumlah_proyek, jumlah_dokumen, jumlah_sektor, jumlah_wilayah FROM public.investasi_angka_publik()';
  expect(await sebagai(db, 'anon', null, sql)).toMatchObject({ ok: true, rows: [angka] });
  expect(await sebagai(db, 'authenticated', admin, sql)).toMatchObject({ ok: true, rows: [angka] });
});
