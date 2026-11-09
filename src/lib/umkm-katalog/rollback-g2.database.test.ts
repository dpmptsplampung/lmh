// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
afterAll(async () => { await db?.close(); });
describe('rollback operasional G2 mempertahankan bukti', () => {
  it('migrasi katalog juga berjalan bila pg_trgm terpasang di public', async () => {
    const lokal = await bukaDbPenuh({ sampai: '202611090001' });
    try {
      await lokal.exec('ALTER EXTENSION pg_trgm SET SCHEMA public');
      await lokal.exec(readFileSync('supabase/migrations/202611090002_umkm_katalog.sql', 'utf8'));
      const hasil = await lokal.query(`SELECT count(*)::int n FROM pg_catalog.pg_indexes
        WHERE schemaname='public' AND indexname IN ('umkm_katalog_nama','umkm_katalog_deskripsi')`);
      expect(hasil.rows[0].n).toBe(2);
    } finally { await lokal.close(); }
  }, 30000);
  it('menolak urutan salah, menutup RPC dalam urutan 0004/0003/0002 dan menyimpan isi privat', async () => {
    db = await bukaDbPenuh();
    const uid = randomUUID();
    await db.query('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
    await db.query(`INSERT INTO public.umkm_pesan_kontak(nama,perusahaan,nomor,pesan,aktor_uid)
      VALUES ('Pengirim','Perusahaan','081234567890','Pesan privat',$1)`, [uid]);
    const baca = (name: string) => readFileSync(`docs/rollback-umkm-${name}.sql`, 'utf8');
    await expect(db.exec(baca('pesan-laporan-202611090003'))).rejects.toThrow('lebih dahulu');
    for (const name of ['pengawasan-darurat-202611090004','pesan-laporan-202611090003',
      'katalog-202611090002']) await db.exec(baca(name));
    expect((await db.query('SELECT count(*)::int count FROM public.umkm_pesan_kontak'))
      .rows[0].count).toBe(1);
    const kontak = await db.query("SELECT umkm_private.ada_kontak('Rp 850.000.000') ada");
    expect(kontak.rows[0].ada).toBe(true);
    const rencana = await db.query("SELECT to_regprocedure('public.umkm_rencana_foto(uuid,uuid,text)') fn");
    expect(rencana.rows[0].fn).toBeNull();
    const r = await sebagai(db, 'anon', null, 'SELECT public.umkm_cari_katalog()');
    expect(r.ok).toBe(false);
    expect('kode' in r && r.kode).toBe('42883');
    for (const table of ['umkm_pesan_kontak','umkm_laporan','umkm_foto']) {
      const direct = await sebagai(db, 'authenticated', uid, `SELECT * FROM public.${table}`);
      expect(direct.ok).toBe(false);
    }
  }, 30000);
});
