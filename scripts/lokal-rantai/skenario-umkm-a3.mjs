// Uji RPC G3 menggunakan data sintetis dan PGlite dalam proses lokal.
import { randomUUID } from 'node:crypto';
import { bukaDbPenuh, sebagai } from './harness.mjs';

const db = await bukaDbPenuh();
const users = Object.fromEntries(['biasa', 'anonim', 'admin', 'fo'].map(x => [x, randomUUID()]));
const officer = randomUUID();
const id = randomUUID();
const revision = randomUUID();
let pass = 0;
let fail = 0;
function check(ok, message) { if (!ok) throw new Error(message); }
async function sql(text, params = []) {
  const result = await sebagai(db, 'postgres', null, text, params);
  if (!result.ok) throw new Error(`${result.kode}: ${result.pesan}`);
  return result.rows;
}
async function rpc(who, name, args = '', params = []) {
  const role = ['anon', 'service_role'].includes(who) ? who : 'authenticated';
  const result = await sebagai(db, role, users[who] ?? null, `SELECT public.${name}(${args}) AS j`, params,
    who === 'anonim' ? { is_anonymous: true } : undefined);
  if (!result.ok) throw new Error(`${result.kode}: ${result.pesan}`);
  return result.rows[0].j;
}
async function rejected(fn) {
  try { await fn(); } catch (e) {
    if (/42883|42P01|42703/.test(e.message)) throw e;
    return;
  }
  throw new Error('akses yang seharusnya ditolak diterima');
}
async function test(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}
try {
  await sql('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [Object.values(users)]);
  await sql("INSERT INTO petugas(id,auth_user_id,nama,role,aktif) VALUES ($1,$2,'Admin','admin',true)",
    [officer, users.admin]);
  await sql("INSERT INTO petugas(auth_user_id,nama,role,aktif) VALUES ($1,'FO','front_office',true)", [users.fo]);
  await sql("INSERT INTO umkm_profil(id,sumber,status,terbit_pada) VALUES ($1,'kurasi','terbit',now())", [id]);
  await sql(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,
    keputusan,dibuat_oleh) VALUES ($1,$2,1,'Kopi A3','Kopi','produk','pangan','Lampung','terbit',$3)`,
  [revision, id, officer]);
  await sql('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1', [id, revision]);

  await test('U-08 suka idempoten, staf dan anonim ditolak', async () => {
    const like = active => rpc('biasa', 'umkm_suka', '$1::uuid,$2::boolean', [id, active]);
    check((await like(true)).suka === 1, 'suka pertama tidak dihitung');
    check((await like(true)).suka === 1, 'suka ulang menambah total');
    const first = (await sql('SELECT pertama_pada FROM umkm_stat_suka WHERE profil_id=$1', [id]))[0];
    check((await like(false)).suka === 0, 'batal tidak mengurangi total');
    check((await like(false)).suka === 0, 'batal ulang mengubah total');
    check((await like(true)).suka === 1, 'suka kembali tidak dihitung');
    const again = (await sql('SELECT pertama_pada FROM umkm_stat_suka WHERE profil_id=$1', [id]))[0];
    check(String(first.pertama_pada) === String(again.pertama_pada), 'tanggal pertama berubah');
    for (const who of ['anon', 'anonim', 'admin', 'fo']) {
      await rejected(() => rpc(who, 'umkm_suka', '$1::uuid,true', [id]));
    }
  });
  await test('U-08 sakelar mati dan deduplikasi telemetri', async () => {
    const record = () => rpc('service_role', 'umkm_catat_statistik', '$1::text,$2::uuid,$3::text',
      ['dilihat', id, 'identitas-sintetis']);
    check((await record()).dicatat === false, 'telemetri mati masih mencatat');
    const off = await rpc('anon', 'umkm_profil_publik', '$1::uuid', [id]);
    check(off.dilihat === null, 'dilihat harus null saat mati');
    await rpc('admin', 'umkm_atur_telemetri', 'true,$1::text,true', ['uji']);
    check((await record()).dicatat === true, 'kejadian pertama tidak dicatat');
    check((await record()).dicatat === false, 'duplikat dicatat');
    const rows = await sql('SELECT dilihat::int FROM umkm_stat_total WHERE profil_id=$1', [id]);
    check(rows[0].dilihat === 1, 'total deduplikasi salah');
  });
  await test('U-09 rumus skor dan mode mati', async () => {
    await sql('SELECT umkm_private.perbarui_skor()');
    let rows = await sql(`SELECT s.l90::int,s.v90::int,s.skor::int,s.mode FROM umkm_skor s
      JOIN umkm_private.statistik t ON t.snapshot_aktif=s.snapshot WHERE s.profil_id=$1`, [id]);
    check(rows.length === 1 && rows[0].skor === 5 * rows[0].l90 + rows[0].v90, 'rumus aktif salah');
    await rpc('admin', 'umkm_atur_telemetri', 'false,$1::text,true', ['uji']);
    rows = await sql(`SELECT s.l90::int,s.skor::int,s.mode FROM umkm_skor s
      JOIN umkm_private.statistik t ON t.snapshot_aktif=s.snapshot WHERE s.profil_id=$1`, [id]);
    check(rows.length === 1 && rows[0].skor === rows[0].l90 && rows[0].mode === 'suka', 'rumus mati salah');
  });
  await test('U-09 serupa tidak menyertakan diri dan maksimal sepuluh', async () => {
    const kandidat = randomUUID();
    const revisiKandidat = randomUUID();
    await sql("INSERT INTO umkm_profil(id,sumber,status,terbit_pada) VALUES ($1,'kurasi','terbit',now())",
      [kandidat]);
    await sql(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,
      keputusan,dibuat_oleh) VALUES ($1,$2,1,'Kopi kandidat','Kopi','produk','pangan','Lampung','terbit',$3)`,
    [revisiKandidat, kandidat, officer]);
    await sql('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1',
      [kandidat, revisiKandidat]);
    const result = await rpc('anon', 'umkm_serupa', '$1::uuid', [id]);
    check(Array.isArray(result.items) && result.items.length > 0 && result.items.length <= 10, 'batas serupa salah');
    check(!result.items.some(item => item.id === id), 'serupa menyertakan diri');
    check(result.items.some(item => item.id === kandidat), 'kandidat serupa tidak ditemukan');
  });
  await test('U-10 laporan mati menunjukkan data tidak dicatat dan FO ditolak', async () => {
    const report = await rpc('admin', 'umkm_laporan_statistik');
    check(report.dilihat === null && report.tanpa_hasil === null, 'laporan mati bukan null');
    await rejected(() => rpc('fo', 'umkm_laporan_statistik'));
  });
  await test('U-12 retensi memangkas yang kedaluwarsa dan menjaga total', async () => {
    const before = await sql('SELECT dilihat::int,suka::int FROM umkm_stat_total WHERE profil_id=$1', [id]);
    await sql("UPDATE umkm_stat_kejadian SET dibuat_pada=now()-interval '8 days',hari=current_date-8");
    await sql('SELECT umkm_private.bersihkan_retensi()');
    const remaining = await sql('SELECT count(*)::int AS n FROM umkm_stat_kejadian WHERE profil_id=$1', [id]);
    const after = await sql('SELECT dilihat::int,suka::int FROM umkm_stat_total WHERE profil_id=$1', [id]);
    check(remaining[0].n === 0, 'dedup kedaluwarsa tidak terhapus');
    check(JSON.stringify(before) === JSON.stringify(after), 'total berubah setelah retensi');
  });
} finally {
  await db.close();
}
console.log(`${pass} PASS, ${fail} FAIL`);
if (fail) process.exitCode = 1;
