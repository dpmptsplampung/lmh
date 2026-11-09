// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
beforeAll(async () => { db = await bukaDbPenuh(); }, 30000);
afterAll(async () => { await db?.close(); });
it('rollback 0007/0006/0005 menutup RPC baru, mempertahankan tabel dan memulihkan sort G2', async () => {
  await db.exec(`INSERT INTO umkm_profil(id,sumber,status)
    VALUES ('10000000-0000-4000-8000-000000000001','kurasi','diajukan');
    INSERT INTO umkm_stat_kejadian(hari,profil_id,jenis,identitas_hash)
    SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date+selisih,
      '10000000-0000-4000-8000-000000000001','dilihat','penanda-' || selisih
    FROM generate_series(-1,1) selisih;`);
  for (const file of ['retensi-202611090007', 'urutan-202611090006', 'statistik-202611090005']) {
    const sql = readFileSync(`docs/rollback-umkm-${file}.sql`, 'utf8');
    expect((await sebagai(db, 'postgres', null, sql)).ok).toBe(true);
  }
  const penanda = await db.query('SELECT identitas_hash FROM umkm_stat_kejadian');
  expect(penanda.rows).toEqual([{ identitas_hash: 'penanda-1' }]);
  const daftar = await sebagai(db, 'anon', null, 'SELECT public.umkm_cari_katalog() j');
  expect(daftar).toMatchObject({ ok: true, rows: [{ j: { items: [], next_cursor: null } }] });
  for (const [role, fn] of [['authenticated', 'umkm_suka(uuid,boolean)'],
    ['anon', 'umkm_serupa(uuid)'], ['service_role', 'umkm_draf_dilindungi(text[])']] as const) {
    const result = await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') boleh", [role, `public.${fn}`]);
    expect(result.rows[0]).toEqual({ boleh: false });
  }
  const retained = await db.query(`SELECT to_regclass('public.umkm_stat_total')::text tabel,
    to_regclass('public.umkm_stat_suka')::text suka`);
  expect(retained.rows[0]).toEqual({ tabel: 'umkm_stat_total', suka: 'umkm_stat_suka' });
});
