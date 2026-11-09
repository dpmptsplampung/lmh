// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
import type { DetailPesan, MutasiPekerjaan, RingkasanPengawasan } from './types';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const reviewer = randomUUID(), admin = randomUUID(), pengirim = randomUUID(), staf = randomUUID();
async function panggil<T>(uid: string, fn: string, args: string, params: unknown[]) {
  const r = await sebagai(db, 'authenticated', uid, `SELECT public.${fn}(${args}) AS j`, params);
  if (!r.ok) throw new Error(r.pesan);
  return (r.rows[0] as { j: T }).j;
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  for (const uid of [reviewer, admin, pengirim]) {
    expect((await sebagai(db, 'postgres', null, 'INSERT INTO auth.users(id) VALUES ($1)', [uid])).ok).toBe(true);
  }
  expect((await sebagai(db, 'postgres', null,
    `INSERT INTO public.petugas(id,auth_user_id,nama,role,aktif) VALUES
      ($1,$2,'Pemeriksa','petugas',true),($3,$4,'Admin','admin',true)`,
    [staf, reviewer, randomUUID(), admin])).ok).toBe(true);
  await panggil(admin, 'umkm_atur_pemeriksa', '$1,true,$2', [staf, randomUUID()]);
}, 30000);
afterAll(async () => { await db?.close(); });
describe('pekerjaan pesan melalui RPC', () => {
  it('ambil dan selesai mencatat balasan pertama, replay tanpa menggeser waktu atau membocorkan isi', async () => {
    const receipt = await panggil<{ id: string }>(pengirim, 'umkm_kirim_pesan_kontak',
      '$1,$2,$3,$4,$5', ['Pengirim privat', 'Perusahaan privat', '081234567890', 'Pesan privat', randomUUID()]);
    const awal = await panggil<DetailPesan>(reviewer, 'umkm_detail_pesan', '$1', [receipt.id]);
    expect(awal).toMatchObject({ nama_pengirim: 'Pengirim privat', status: 'baru', dibalas_pada: null });
    const ambil = await panggil<MutasiPekerjaan>(reviewer, 'umkm_ambil_pekerjaan', '$1,$2,$3,$4',
      ['pesan', receipt.id, awal.versi, randomUUID()]);
    const key = randomUUID();
    const args = ['pesan', receipt.id, ambil.versi, key];
    const selesai = await panggil<MutasiPekerjaan>(reviewer, 'umkm_selesaikan_pekerjaan', '$1,$2,$3,$4', args);
    expect(selesai.status).toBe('ditangani');
    expect(await panggil(reviewer, 'umkm_selesaikan_pekerjaan', '$1,$2,$3,$4', args)).toEqual(selesai);
    const detail = await panggil<DetailPesan>(reviewer, 'umkm_detail_pesan', '$1', [receipt.id]);
    expect(detail.dibalas_pada).toEqual(expect.any(String));
    const audit = await sebagai(db, 'postgres', null,
      'SELECT to_jsonb(h) j FROM public.umkm_riwayat h WHERE objek_id=$1', [receipt.id]);
    const json = JSON.stringify(audit.rows);
    for (const teks of ['Pengirim privat', 'Perusahaan privat', '081234567890', 'Pesan privat']) {
      expect(json).not.toContain(teks);
    }
    expect(audit.rows).toHaveLength(2);
    const ringkasan = await panggil<RingkasanPengawasan>(admin, 'umkm_ringkasan_pengawasan', '', []);
    expect(ringkasan.pesan.ditangani).toBe(1);
    expect(ringkasan.rata_balasan_pertama_detik).toBeGreaterThanOrEqual(0);
  });
});
