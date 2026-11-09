// Pengukuran sintetis di PGlite lokal; angka bukan kapasitas produksi.
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { bukaDbPenuh, sebagai } from './harness.mjs';

const db = await bukaDbPenuh();
const officer = randomUUID();
let failures = 0;
async function query(role, text, params = []) {
  const result = await sebagai(db, role, null, text, params);
  if (!result.ok) throw new Error(`${result.kode}: ${result.pesan}`);
  return result.rows;
}
const sql = (text, params = []) => query('postgres', text, params);
const search = async (q, cursor = null) => (await query('anon',
  'SELECT public.umkm_cari_katalog($1,NULL,NULL,NULL,NULL,$2,$3) AS j', [q, 'paling_sesuai', cursor]))[0].j;
async function timed(label, fn) {
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  console.log(`${label}: ${ms.toFixed(2)} ms`);
  return value;
}
try {
  const user = randomUUID();
  await sql('INSERT INTO auth.users(id) VALUES ($1)', [user]);
  await sql("INSERT INTO petugas(id,auth_user_id,nama,role,aktif) VALUES ($1,$2,'Uji beban','petugas',true)",
    [officer, user]);
  let prior = 0;
  for (const count of [1000, 5000, 10000]) {
    await timed(`fixture ${count}`, async () => {
      await sql(`WITH p AS (INSERT INTO umkm_profil(sumber,status,terbit_pada)
        SELECT 'kurasi','terbit',now()-interval '60 days' FROM generate_series(1,$1) RETURNING id),
        r AS (INSERT INTO umkm_revisi(profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,
          keputusan,dibuat_oleh)
        SELECT id,1,'Kopi '||id,'Produk sintetis','produk','pangan','Lampung','terbit',$2 FROM p
        RETURNING id,profil_id) SELECT count(*) FROM r`,
      [count - prior, officer]);
      await sql(`UPDATE umkm_profil p SET revisi_disetujui_id=r.id,revisi_terakhir_id=r.id
        FROM umkm_revisi r WHERE p.id=r.profil_id AND p.revisi_disetujui_id IS NULL`);
    });
    prior = count;
    await timed(`data ${count}`, async () => {
      await sql('DELETE FROM umkm_stat_suka');
      await sql('DELETE FROM umkm_stat_harian');
      await sql('DELETE FROM umkm_stat_kejadian');
      await sql('DELETE FROM umkm_stat_tanpa_hasil');
      await sql('DELETE FROM umkm_stat_bulanan');
      await sql('DELETE FROM umkm_pesan_kontak');
      await sql(`INSERT INTO umkm_stat_suka(aktor_uid,profil_id,aktif,pertama_pada)
        SELECT $1,id,true,now()-CASE WHEN row_number() OVER (ORDER BY id)%2=0
          THEN interval '100 days' ELSE interval '10 days' END FROM umkm_profil`, [user]);
      await sql(`INSERT INTO umkm_stat_harian(hari,profil_id,dilihat)
        SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date-n,id,1
        FROM umkm_profil CROSS JOIN generate_series(0,89) n`);
      await sql(`INSERT INTO umkm_stat_harian(hari,profil_id,dilihat)
        SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date-95-n,id,1
        FROM umkm_profil CROSS JOIN generate_series(0,20) n LIMIT 20001`);
      await sql(`INSERT INTO umkm_stat_kejadian(hari,profil_id,jenis,identitas_hash,dibuat_pada)
        SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date-8,id,'dilihat',n::text,now()-interval '8 days'
        FROM umkm_profil CROSS JOIN generate_series(1,21) n LIMIT 20001`);
      await sql(`INSERT INTO umkm_pesan_kontak(nama,perusahaan,nomor,pesan,aktor_uid,aktivitas_pada)
        SELECT 'Uji','Uji','08123456789','Uji',$1,now()-interval '181 days' FROM generate_series(1,501)`, [user]);
      await sql(`INSERT INTO umkm_stat_tanpa_hasil(hari,kategori,kabupaten_kota,jumlah)
        SELECT (date_trunc('month',(now() AT TIME ZONE 'Asia/Jakarta')::date)-interval '4 months')::date
          - ((n%4)/2)*31-(n%2),'kategori-'||(n/4),'Lampung',1 FROM generate_series(0,20003) n`);
      await sql('UPDATE umkm_private.statistik SET telemetri_opsional_aktif=true WHERE tunggal');
    });
    const masuk = (await sql(`SELECT
      (SELECT count(*)::int FROM umkm_pesan_kontak) pesan,
      (SELECT count(*)::int FROM umkm_stat_kejadian) dedup,
      (SELECT count(*)::int FROM umkm_stat_harian) harian,
      (SELECT count(*)::int FROM umkm_stat_tanpa_hasil) tanpa_hasil,
      (SELECT count(*)::int FROM umkm_stat_suka WHERE aktif AND pertama_pada>=now()-interval '90 days') suka_baru,
      (SELECT count(*)::int FROM umkm_stat_suka WHERE aktif AND pertama_pada<now()-interval '90 days') suka_lama`))[0];
    console.log(`masuk ${count}: ${JSON.stringify(masuk)}`);
    await timed(`skor ${count}`, () => sql('SELECT umkm_private.perbarui_skor()'));
    const skor = (await sql(`SELECT count(*)::int n FROM umkm_skor s
      JOIN umkm_private.statistik t ON t.snapshot_aktif=s.snapshot
      WHERE s.mode='telemetri' AND s.v90=90 AND s.l90 IN (0,1) AND s.skor=5*s.l90+s.v90`))[0].n;
    if (skor !== count) throw new Error(`skor sintetis salah: ${skor}/${count}`);
    const broad = await timed(`luas ${count}`, () => search(null));
    if (broad.items.length !== 20 || !broad.next_cursor) throw new Error('halaman luas tidak lengkap');
    const sampleId = broad.items[0].id;
    const selected = await timed(`selektif ${count}`, () => search(sampleId));
    if (selected.items.length !== 1 || selected.items[0].id !== sampleId) throw new Error('hasil selektif salah');
    const related = await timed(`serupa ${count}`, () => query('anon',
      'SELECT public.umkm_serupa($1::uuid) AS j', [sampleId]));
    if (related[0].j.items.length > 10) throw new Error('serupa lebih dari 10');
    for (let putaran = 1; putaran <= 3; putaran++) {
      const hasil = await timed(`retensi ${count} putaran ${putaran}`,
        async () => (await sql('SELECT umkm_private.bersihkan_retensi() AS hasil'))[0].hasil);
      const sisa = (await sql(`SELECT
        (SELECT count(*)::int FROM umkm_pesan_kontak) pesan,
        (SELECT count(*)::int FROM umkm_stat_kejadian) dedup,
        (SELECT count(*)::int FROM umkm_stat_harian) harian,
        (SELECT count(*)::int FROM umkm_stat_tanpa_hasil) tanpa_hasil,
        (SELECT coalesce(sum(tanpa_hasil),0)::int FROM umkm_stat_bulanan) bulanan`))[0];
      console.log(`retensi ${count} putaran ${putaran} terhapus=${JSON.stringify(hasil)} tersisa=${JSON.stringify(sisa)}`);
      const expected = putaran === 1 ? [500, 20000, 20000, 20000, 20000]
        : putaran === 2 ? [1, 1, 1, 4, 20004] : [0, 0, 0, 0, 20004];
      if ([hasil.pesan, hasil.dedup, hasil.harian, hasil.tanpa_hasil, sisa.bulanan]
        .some((value, index) => value !== expected[index])) throw new Error(`retensi putaran ${putaran} salah`);
      if (sisa.harian !== count * 90 + (putaran === 1 ? 1 : 0)) throw new Error('sisa harian salah');
    }
    const found = new Set();
    let page = broad;
    let pages = 0;
    const start = performance.now();
    let last = 0;
    while (true) {
      pages++;
      if (page.items.length > 20) throw new Error('halaman lebih dari 20');
      for (const item of page.items) {
        if (found.has(item.id)) throw new Error(`id ganda pada halaman ${pages}`);
        found.add(item.id);
      }
      if (!page.next_cursor) break;
      if (pages > Math.ceil(count / 20)) throw new Error('cursor berulang');
      const t = performance.now();
      page = await search(null, page.next_cursor);
      last = performance.now() - t;
    }
    console.log(`telusur ${count}: ${pages} halaman, ${found.size} id, ${(performance.now() - start).toFixed(2)} ms`);
    console.log(`dalam ${count}: ${last.toFixed(2)} ms`);
    if (found.size !== count) throw new Error(`id hilang: ${found.size}/${count}`);
    console.log(`PASS ${count}`);
  }
} catch (error) {
  failures++;
  console.log(`FAIL ${error.message}`);
} finally {
  await db.close();
}
console.log(`${failures} FAIL`);
if (failures) process.exitCode = 1;
