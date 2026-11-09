// Skenario database G2: data sintetis dalam PGlite lokal.
import { randomUUID } from 'node:crypto';
import { bukaDbPenuh, sebagai } from './harness.mjs';

const db = await bukaDbPenuh();
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const akun = Object.fromEntries(['petugas', 'fo', 'foflag', 'admin', 'biasa', 'pengunjung', 'anon'].map(k =>
  [k, randomUUID()]));
const pet = Object.fromEntries(['petugas', 'fo', 'foflag', 'admin', 'biasa'].map(k => [k, randomUUID()]));
const nomor = '081297654321';
const rahasia = ['PemilikRahasia', 'pemilik@example.test', 'AlamatRahasia', nomor, 'PesanRahasia', 'CatatanRahasia'];
const data = { nama: 'Kopi Aman', deskripsi: 'Kopi pilihan',
  alamat: 'AlamatRahasia PemilikRahasia pemilik@example.test', jenis: 'produk',
  kategori: 'makanan', kabupaten_kota: 'Lampung', sumber: 'kurasi', nomor };
let lulus = 0;
let gagal = 0;
let pemeriksaan = 0;
function cek(kondisi, pesan) { pemeriksaan++; if (!kondisi) throw new Error(pesan); }
function nilai(r, konteks) { cek(r.ok, `${konteks}: ${r.kode} ${r.pesan}`); return r.rows[0]?.j; }
async function sql(teks, params) { const r = await pg(teks, params); cek(r.ok, `fixture: ${r.kode} ${r.pesan}`);
  return r.rows; }
const rpc = (who, nama, arg = '', params = []) => sebagai(db, who === null ? 'anon' : 'authenticated',
  who === null || who === 'kosong' ? null : akun[who], `SELECT public.${nama}(${arg}) AS j`, params,
  who === 'anon' ? { is_anonymous: true } : undefined);
const simpan = (body = data, id = null, versi = null) => rpc('petugas', 'umkm_simpan_profil',
  '$1::jsonb,$2::uuid,$3::uuid,$4::integer', [JSON.stringify(body), randomUUID(), id, versi]);
const putus = (id, versi, keputusan = 'terbit') => rpc('petugas', 'umkm_putuskan_profil',
  '$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',
  [id, versi, randomUUID(), keputusan, keputusan === 'ditolak' ? 'Tidak sesuai' : null]);
const buat = async (body = data) => nilai(await simpan(body), 'simpan');
const terbit = async (body = data) => {
  const p = await buat(body); return nilai(await putus(p.id, p.versi), 'terbit');
};
const publik = (who, id) => rpc(who, 'umkm_profil_publik', '$1::uuid', [id]);
const cari = (who, q = null, cursor = null) => rpc(who, 'umkm_cari_katalog',
  '$1::text,NULL::text,NULL::text,NULL::text,NULL::text,$2::text,$3::text', [q, 'paling_sesuai', cursor]);
const pesan = (who, op, teks = 'PesanRahasia', profil = null) => rpc(who, 'umkm_kirim_pesan_kontak',
  '$1::text,$2::text,$3::text,$4::text,$5::uuid,$6::uuid,$7::text',
  ['PengirimRahasia', 'PerusahaanRahasia', nomor, teks, op, profil, null]);
const lapor = (who, profil, op, alasan = 'penipuan', catatan = 'CatatanRahasia') => rpc(who, 'umkm_laporkan',
  '$1::uuid,$2::text,$3::uuid,$4::uuid,$5::text', [profil, alasan, op, null, catatan]);
const darurat = (who, id, versi, aksi, alasan = 'Perlu pemeriksaan') => rpc(who, 'umkm_tindakan_darurat',
  '$1::uuid,$2::text,$3::text,$4::integer,$5::uuid', [id, aksi, alasan, versi, randomUUID()]);
function ditolak(r, label) {
  cek(!r.ok && !['42883', '42P01', '42703'].includes(r.kode), `${label}: ${r.kode ?? 'diterima'} ${r.pesan ?? ''}`);
}
function aman(x, tambahan = []) { const teks = JSON.stringify(x); for (const s of [...rahasia, ...tambahan])
  cek(!teks.includes(s), `respons mengandung ${s}`); }
async function uji(label, fn) { const awal = pemeriksaan; try { await fn(); lulus++;
  console.log(`PASS ${label} (${pemeriksaan - awal} pemeriksaan)`); } catch (e) {
  gagal++; console.log(`FAIL ${label}: ${e.message} (${pemeriksaan - awal} pemeriksaan)`); } }

await sql('INSERT INTO auth.users(id,email) SELECT x::uuid,x || $2 FROM unnest($1::text[]) x',
  [Object.values(akun), '@example.test']);
await sql(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm)
  SELECT p::uuid,u::uuid,n,r,true,false FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) v(p,u,n,r)`,
[Object.values(pet), Object.keys(pet).map(k => akun[k]), Object.keys(pet),
  ['petugas', 'front_office', 'front_office', 'admin', 'petugas']]);
nilai(await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid',
  [pet.petugas, true, randomUUID()]), 'penanda pemeriksa');
// Simulasikan penanda lama yang tertinggal setelah perubahan peran FO.
await sql('ALTER TABLE petugas DISABLE TRIGGER USER');
await sql('UPDATE petugas SET pemeriksa_umkm=true WHERE id=$1::uuid', [pet.foflag]);
await sql('ALTER TABLE petugas ENABLE TRIGGER USER');

await uji('publik hanya revisi disetujui dan tanpa data privat', async () => {
  const tampil = await terbit();
  const draft = await buat({ ...data, nama: `Draf ${nomor}`, kategori: 'kategori-draf' });
  const tolak = await buat({ ...data, nama: 'NamaDitolak', kategori: 'kategori-tolak' });
  nilai(await putus(tolak.id, tolak.versi, 'ditolak'), 'tolak');
  const sembunyi = await terbit({ ...data, nama: 'NamaTersembunyi', kategori: 'kategori-sembunyi' });
  nilai(await rpc('petugas', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
    [sembunyi.id, sembunyi.versi, randomUUID(), 'sembunyikan', null]), 'sembunyi');
  nilai(await simpan({ ...data, nama: 'NamaKoreksiBelumDisetujui', kategori: 'kategori-koreksi' },
    tampil.id, tampil.versi), 'koreksi');
  for (const who of [null, 'anon']) {
    const daftar = nilai(await cari(who), 'katalog');
    const filter = nilai(await rpc(who, 'umkm_filter_katalog'), 'filter');
    const detail = nilai(await publik(who, tampil.id), 'detail');
    cek(detail?.nama === data.nama, 'bukan revisi disetujui');
    aman([daftar, filter, detail], ['NamaKoreksiBelumDisetujui', 'kategori-koreksi', 'kategori-draf',
      'kategori-tolak', 'kategori-sembunyi', 'NamaDitolak', 'NamaTersembunyi']);
    for (const id of [draft.id, tolak.id, sembunyi.id]) {
      cek(!daftar.items.some(x => x.id === id), 'profil privat muncul');
      const r = await publik(who, id); cek(!r.ok || !r.rows[0]?.j, 'detail privat muncul');
    }
    for (const q of ['NamaDitolak', 'NamaTersembunyi', 'NamaKoreksiBelumDisetujui']) {
      const hasil = nilai(await cari(who, q), 'pencarian privat');
      cek(hasil.items.length === 0, `${q} muncul di pencarian`);
    }
  }
});

await uji('akses langsung tabel baru ditolak semua role', async () => {
  for (const table of ['public.umkm_pesan_kontak', 'public.umkm_laporan', 'umkm_private.operasi_publik',
    'umkm_private.foto_hapus']) for (const role of ['anon', 'authenticated', 'service_role']) {
    const r = await sebagai(db, role, role === 'authenticated' ? akun.anon : null, `SELECT * FROM ${table}`);
    cek(!r.ok && r.kode === '42501', `${role} ${table}: ${r.kode} ${r.pesan}`);
  }
});

await uji('cursor katalog menelusuri 1000 profil tanpa duplikat atau kehilangan', async () => {
  const prefix = `Massa${randomUUID().slice(0, 8)}`;
  const ids = await sql(`INSERT INTO umkm_profil(sumber,status,terbit_pada)
    SELECT 'kurasi','terbit',now() FROM generate_series(1,1000) RETURNING id`);
  await sql(`INSERT INTO umkm_revisi(profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,keputusan,dibuat_oleh)
    SELECT x::uuid,1,$2,'Kopi','produk','makanan','Lampung','terbit',$3::uuid FROM unnest($1::text[]) x`,
  [ids.map(x => x.id), prefix, pet.petugas]);
  await sql(`UPDATE umkm_profil p SET revisi_disetujui_id=r.id,revisi_terakhir_id=r.id
    FROM umkm_revisi r WHERE p.id=r.profil_id AND p.id=ANY($1::uuid[])`, [ids.map(x => x.id)]);
  const diharap = new Set(ids.map(x => x.id)); const ditemukan = new Set(); let cursor = null; let halaman = 0;
  do {
    const page = nilai(await cari(null, prefix, cursor), 'halaman');
    cek(page.items.length <= 20, 'halaman melebihi 20');
    for (const item of page.items) { cek(diharap.has(item.id), 'hasil asing');
      cek(!ditemukan.has(item.id), 'duplikat'); ditemukan.add(item.id); }
    cursor = page.next_cursor; cek(++halaman <= 51, 'cursor berulang');
  } while (cursor);
  cek(ditemukan.size === 1000, `hanya ${ditemukan.size} profil`);
  for (const x of ['%', '_']) {
    const page = nilai(await cari(null, prefix + x), 'wildcard literal');
    cek(page.items.length === 0, `wildcard ${x} berlaku sebagai pola`);
  }
  ditolak(await cari(null, prefix, 'cursor-rusak'), 'cursor rusak');
});

await uji('profil disembunyikan di tengah cursor hilang', async () => {
  const prefix = `Cursor${randomUUID().slice(0, 8)}`; const ids = [];
  for (let i = 0; i < 22; i++) ids.push((await terbit({ ...data, nama: prefix })).id);
  const first = nilai(await cari(null, prefix), 'halaman pertama');
  cek(first.next_cursor && first.items.length === 20, 'halaman pertama tidak lengkap');
  const target = ids.find(id => !first.items.some(x => x.id === id));
  const row = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [target]))[0];
  nilai(await rpc('petugas', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
    [target, row.versi, randomUUID(), 'sembunyikan', null]), 'sembunyikan');
  const next = nilai(await cari(null, prefix, first.next_cursor), 'halaman berikut');
  cek(!next.items.some(x => x.id === target), 'profil tersembunyi masih muncul');
});

await uji('foto unggahan memerlukan bukti dan hilang saat disembunyikan', async () => {
  const nama = `FotoUnik${randomUUID().slice(0, 8)}`;
  const p = await buat({ ...data, nama, foto: [{ asal: 'unggahan', r2_key: 'umkm-draf/contoh.jpg' }] });
  const foto = (await sql('SELECT id FROM umkm_foto WHERE revisi_id=$1::uuid', [p.revisi_id]))[0].id;
  const t = nilai(await putus(p.id, p.versi), 'terbit foto');
  const tanpaBukti = await pg(`UPDATE umkm_foto SET r2_key_publik=$1,url_publik=$2 WHERE id=$3::uuid`,
    ['umkm-katalog/12345678-1234-1234-1234-123456789012.jpg', 'https://example.test/foto.jpg', foto]);
  cek(!tanpaBukti.ok && tanpaBukti.kode === '23514', 'constraint bukti unggah tidak menolak kunci publik');
  const tautkan = () => rpc('petugas', 'umkm_terbitkan_foto', '$1::uuid,$2::uuid,$3::text,$4::text,$5::text',
    [p.id, foto, 'abcdef0123456789', 'umkm-katalog/abcdefab-cdef-4abc-abcd-abcdefabcdef.jpg',
      'https://example.test/umkm-katalog/abcdefab-cdef-4abc-abcd-abcdefabcdef.jpg']);
  const rencana = () => rpc('petugas', 'umkm_rencana_foto', '$1::uuid,$2::uuid,$3::text',
    [p.id, foto, 'umkm-katalog/abcdefab-cdef-4abc-abcd-abcdefabcdef.jpg']);
  ditolak(await rencana(), 'rencana tanpa bukti');
  ditolak(await tautkan(), 'publikasi tanpa bukti');
  cek(!(nilai(await publik(null, p.id), 'detail').foto ?? []).some(x => x.id === foto), 'foto tanpa kunci muncul');
  cek(!nilai(await cari(null, nama), 'kartu tanpa kunci').items[0]?.foto, 'kartu memuat foto tanpa kunci');
  nilai(await rpc('petugas', 'umkm_bukti_foto', '$1::uuid,$2::uuid,$3::text,$4::bigint,$5::text',
    [p.id, foto, 'abcdef0123456789', 1234, 'image/jpeg']), 'bukti');
  ditolak(await tautkan(), 'publikasi tanpa rencana salin');
  nilai(await rencana(), 'rencana salin');
  nilai(await tautkan(), 'tautkan foto');
  cek(nilai(await publik(null, p.id), 'detail').foto.some(x => x.id === foto), 'foto terbukti tidak muncul');
  cek(nilai(await cari(null, nama), 'kartu foto').items[0]?.foto?.id === foto, 'foto tidak muncul pada kartu');
  nilai(await rpc('petugas', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
    [p.id, t.versi, randomUUID(), 'sembunyikan', foto]), 'sembunyikan foto');
  cek(!nilai(await publik(null, p.id), 'detail').foto.some(x => x.id === foto), 'foto tersembunyi muncul');
  cek(!nilai(await cari(null, nama), 'kartu foto tersembunyi').items[0]?.foto, 'foto tersembunyi muncul pada kartu');
});

await uji('form dan laporan: sesi, replay, konflik dan privasi', async () => {
  const p = await terbit(); const op = randomUUID();
  for (const who of [null, 'kosong']) { ditolak(await pesan(who, randomUUID()), 'pesan tanpa UID');
    ditolak(await lapor(who, p.id, randomUUID()), 'laporan tanpa UID'); }
  const a = nilai(await pesan('anon', op, 'PesanRahasia', p.id), 'pesan');
  const b = nilai(await pesan('anon', op, 'PesanRahasia', p.id), 'replay pesan');
  cek(JSON.stringify(a) === JSON.stringify(b), 'replay pesan berubah'); aman([a, b], ['PengirimRahasia']);
  const konflikPesan = await pesan('anon', op, 'PesanBerbeda', p.id);
  ditolak(konflikPesan, 'konflik pesan');
  cek(/KONFLIK_OPERASI/.test(konflikPesan.pesan), 'kode konflik pesan salah');
  const lop = randomUUID(); const l = nilai(await lapor('anon', p.id, lop), 'lapor');
  const ulang = nilai(await lapor('anon', p.id, lop), 'replay laporan');
  cek(JSON.stringify(l) === JSON.stringify(ulang), 'replay laporan berubah'); aman([l, ulang]);
  const konflikLaporan = await lapor('anon', p.id, lop, 'lainnya');
  ditolak(konflikLaporan, 'konflik laporan');
  cek(/KONFLIK_OPERASI/.test(konflikLaporan.pesan), 'kode konflik laporan salah');
  for (const table of ['umkm_riwayat', 'audit_log']) {
    const rows = await sql(`SELECT row_to_json(t)::text AS isi FROM ${table} t`);
    aman(rows, ['PengirimRahasia', 'PerusahaanRahasia']);
  }
});

await uji('penjaga laju menolak ledakan tanpa membocorkan ambang', async () => {
  const user = randomUUID(); await sql('INSERT INTO auth.users(id,email) VALUES ($1::uuid,$2)',
    [user, `${user}@example.test`]); akun.burst = user;
  await sql(`INSERT INTO anon_rate_limit(user_id,action) SELECT $1::uuid,'umkm_pesan' FROM generate_series(1,10)`,
    [user]);
  const r = await pesan('burst', randomUUID()); ditolak(r, 'ledakan');
  cek(/TERLALU_BANYAK/.test(r.pesan), `kode laju: ${r.pesan}`);
  cek(!/\b(10|30|200|600|1000|86400)\b/.test(r.pesan), 'ambang laju bocor');
  const p = await terbit();
  await sql(`INSERT INTO anon_rate_limit(user_id,action)
    SELECT $1::uuid,'umkm_laporan' FROM generate_series(1,10)`, [user]);
  const laporan = await lapor('burst', p.id, randomUUID());
  ditolak(laporan, 'ledakan laporan');
  cek(/TERLALU_BANYAK/.test(laporan.pesan), `kode laju laporan: ${laporan.pesan}`);
  cek(!/\b(10|600|1000)\b/.test(laporan.pesan), 'ambang laju laporan bocor');
});

await uji('daftar tugas campuran, mendesak dan cursor', async () => {
  const p = await terbit(); const m = nilai(await pesan('pengunjung', randomUUID(), 'PesanRahasia', p.id), 'pesan');
  const l = nilai(await lapor('pengunjung', p.id, randomUUID(), 'penipuan'), 'laporan');
  const n = nilai(await lapor('pengunjung', p.id, randomUUID(), 'nomor_tampil'), 'laporan nomor');
  const draft = await buat({ ...data, nama: 'DrafAntrean' });
  const semua = []; let cursor = null; let count = 0;
  do { const page = nilai(await rpc('petugas', 'umkm_daftar_tugas', '$1::text', [cursor]), 'daftar');
    cek(page.items.length <= 20, 'lebih dari 20'); semua.push(...page.items); cursor = page.next_cursor;
    cek(++count < 100, 'cursor berulang'); } while (cursor);
  const ids = semua.map(x => `${x.jenis}:${x.id}`); cek(new Set(ids).size === ids.length, 'duplikat antrean');
  for (const [jenis, id] of [['profil', draft.id], ['pesan', m.id], ['laporan', l.id], ['laporan', n.id]])
    cek(ids.includes(`${jenis}:${id}`), `tidak ada ${jenis}`);
  for (const id of [l.id, n.id]) cek(semua.find(x => x.id === id)?.mendesak, 'laporan tidak mendesak');
  for (let i = 1; i < semua.length; i++) {
    const a = semua[i - 1], b = semua[i];
    cek(!(b.mendesak && !a.mendesak), 'prioritas mendesak salah');
    if (a.mendesak === b.mendesak) cek(a.dibuat_pada <= b.dibuat_pada, 'urutan waktu salah');
  }
  aman(semua.filter(x => x.jenis !== 'profil'));
  ditolak(await rpc('petugas', 'umkm_daftar_tugas', '$1::text', ['rusak']), 'cursor tugas rusak');
  for (const who of [null, 'anon', 'pengunjung', 'fo', 'foflag', 'admin']) {
    for (const [fn, id] of [['umkm_detail_pesan', m.id], ['umkm_detail_laporan', l.id]])
      ditolak(await rpc(who, fn, '$1::uuid', [id]), `${who} ${fn}`);
  }
});

await uji('pengawasan FO/admin aman dan peran lain ditolak', async () => {
  const p = await buat({ ...data, nama: `Draf ${nomor}`, deskripsi: `Rahasia ${nomor}` });
  await pesan('anon', randomUUID(), `Pesan ${nomor}`);
  const terbitPublik = await terbit();
  nilai(await lapor('pengunjung', terbitPublik.id, randomUUID(), 'lainnya', `Catatan ${nomor}`), 'lapor');
  for (const who of ['fo', 'foflag', 'admin']) {
    const ringkas = nilai(await rpc(who, 'umkm_ringkasan_pengawasan'), 'ringkasan');
    const jejak = nilai(await rpc(who, 'umkm_jejak_pengawasan', '$1::text', [null]), 'jejak');
    const cariHasil = nilai(await rpc(who, 'umkm_cari_pengawasan', '$1::text,$2::uuid', ['Kopi', null]), 'cari');
    aman([ringkas, jejak, cariHasil]);
    const row = jejak.items.find(x => x.profil_id === p.id);
    cek(row?.profil_nama === 'Profil belum terbit', 'label draf tidak netral');
  }
  for (const who of [null, 'anon', 'pengunjung', 'biasa']) {
    ditolak(await rpc(who, 'umkm_ringkasan_pengawasan'), 'ringkasan');
    ditolak(await rpc(who, 'umkm_jejak_pengawasan', '$1::text', [null]), 'jejak');
    ditolak(await rpc(who, 'umkm_cari_pengawasan', '$1::text,$2::uuid', ['Kopi', null]), 'cari');
  }
});

await uji('darurat FO/admin, audit dan penyelesaian petugas', async () => {
  for (const who of ['fo', 'admin']) {
    const p = await terbit();
    ditolak(await darurat(who, p.id, p.versi, 'sembunyikan', `Telepon ${nomor}`), 'alasan bernomor');
    const h = nilai(await darurat(who, p.id, p.versi, 'sembunyikan'), 'sembunyikan darurat');
    cek(h.mendesak === true && h.status === 'disembunyikan', 'status darurat salah');
    const detail = await publik(null, p.id); cek(!detail.ok || !detail.rows[0]?.j, 'masih terbit');
    const tugas = nilai(await rpc('petugas', 'umkm_daftar_tugas', '$1::text', [null]), 'antrean');
    cek(tugas.items.some(x => x.id === p.id && x.mendesak), 'tidak masuk antrean');
    const sejarah = await sql('SELECT * FROM umkm_riwayat WHERE objek_id=$1::uuid', [p.id]);
    cek(sejarah.some(x => x.peran === (who === 'fo' ? 'front_office' : 'admin') && x.alasan), 'audit hilang');
    const sebelum = await sql(`SELECT p.status,p.revisi_disetujui_id,p.revisi_terakhir_id,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM umkm_izin i WHERE i.profil_id=p.id) izin,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM umkm_revisi r WHERE r.profil_id=p.id) revisi
      FROM umkm_profil p WHERE p.id=$1::uuid`, [p.id]);
    const selesai = nilai(await rpc('petugas', 'umkm_selesaikan_mendesak', '$1::uuid,$2::integer,$3::uuid',
      [p.id, h.versi, randomUUID()]), 'selesaikan');
    cek(selesai.mendesak === false, 'mendesak tetap aktif');
    const sesudah = await sql(`SELECT p.status,p.revisi_disetujui_id,p.revisi_terakhir_id,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM umkm_izin i WHERE i.profil_id=p.id) izin,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM umkm_revisi r WHERE r.profil_id=p.id) revisi
      FROM umkm_profil p WHERE p.id=$1::uuid`, [p.id]);
    cek(JSON.stringify(sebelum) === JSON.stringify(sesudah), 'isi atau izin berubah');
    const riwayat = await sql('SELECT * FROM umkm_riwayat WHERE objek_id=$1::uuid', [p.id]);
    cek(riwayat.length > sejarah.length, 'penyelesaian tidak dicatat');
    const setelah = await publik(null, p.id); cek(!setelah.ok || !setelah.rows[0]?.j, 'pulih tanpa review');
  }
  for (const who of ['fo', 'admin']) {
    const p = await terbit();
    const cabut = nilai(await darurat(who, p.id, p.versi, 'catat_pencabutan'), 'cabut');
    cek(cabut.mendesak === true, 'pencabutan tidak mendesak'); aman(cabut);
    const izin = await sql('SELECT status FROM umkm_izin WHERE profil_id=$1::uuid ORDER BY dibuat_pada DESC', [p.id]);
    cek(izin[0]?.status === 'dicabut', 'izin tidak dicabut');
    const sejarah = await sql('SELECT * FROM umkm_riwayat WHERE objek_id=$1::uuid', [p.id]);
    cek(sejarah.some(x => x.peran === (who === 'fo' ? 'front_office' : 'admin') && x.alasan), 'audit cabut hilang');
    const tugas = nilai(await rpc('petugas', 'umkm_daftar_tugas', '$1::text', [null]), 'antrean pencabutan');
    cek(tugas.items.some(x => x.id === p.id && x.mendesak), 'pencabutan tidak masuk antrean');
  }
});

await uji('FO termasuk penanda basi tidak dapat keputusan, izin atau kontak', async () => {
  for (const who of ['fo', 'foflag']) {
    const p = await buat();
    for (const keputusan of ['terbit', 'ditolak']) ditolak(await rpc(who, 'umkm_putuskan_profil',
      '$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',
      [p.id, p.versi, randomUUID(), keputusan, keputusan === 'ditolak' ? 'Alasan' : null]), keputusan);
    ditolak(await rpc(who, 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
      [p.id, p.versi, randomUUID(), 'diberikan']), 'izin');
    ditolak(await rpc(who, 'umkm_akses_kontak_petugas', '$1::uuid', [p.id]), 'kontak');
    ditolak(await rpc(who, 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
      [p.id, p.versi, randomUUID(), 'pulihkan', null]), 'pulihkan');
  }
});

await uji('deteksi kontak: jarak panjang, UUID, dan nominal rupiah', async () => {
  const deteksi = async teks => (await sql('SELECT umkm_private.ada_kontak($1) AS ada', [teks]))[0].ada;
  for (const teks of ['0812    3456    7890', '0812\n\n\n\n3456 7890', 'Rp 0812-3456-7890', '0812-3456-7890',
    '0812\u00a03456\u20137890', 'cek@example.test', 'wa . me/62812']) {
    cek(await deteksi(teks), `lolos: ${JSON.stringify(teks)}`);
  }
  for (const teks of ['Rp 10.000.000', 'Rp 1.000.000.000', 'sejak 2010', 'foto_1699999999.jpg', 'kode pos 35111',
    'NIB 1234567890123', 'Rp 850.000.000', 'Rp 620.000.000', 'Rp. 850.000.000', 'omzet Rp850.000.000 per tahun',
    `https://example.test/foto/${randomUUID()}.jpg`]) {
    cek(!(await deteksi(teks)), `tertahan: ${teks}`);
  }
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM generate_series(1,2000)
    WHERE umkm_private.ada_kontak('https://example.test/umkm-katalog/' || gen_random_uuid()::text || '.jpg')`);
  cek(n === 0, `${n} dari 2000 UUID dianggap nomor`);
});

await uji('penjaga laju: batas harian per UID dan batas global', async () => {
  const bersih = r => cek(/TERLALU_BANYAK/.test(r.pesan) && !/\b(10|30|200|600|86400)\b/.test(r.pesan),
    `pesan laju: ${r.pesan}`);
  for (const nama of ['harian', 'pembanjir']) {
    akun[nama] = randomUUID();
    await sql('INSERT INTO auth.users(id,email) VALUES ($1::uuid,$2)', [akun[nama], `${akun[nama]}@example.test`]);
  }
  await sql(`INSERT INTO anon_rate_limit(user_id,action,created_at)
    SELECT $1::uuid,'umkm_pesan',now()-interval '2 hours' FROM generate_series(1,30)`, [akun.harian]);
  const harian = await pesan('harian', randomUUID()); ditolak(harian, 'batas 24 jam'); bersih(harian);
  await sql(`INSERT INTO anon_rate_limit(user_id,action,created_at)
    SELECT $1::uuid,'umkm_pesan',now()-interval '25 hours' FROM generate_series(1,30)`, [akun.pembanjir]);
  nilai(await pesan('pembanjir', randomUUID()), 'jendela 24 jam sudah lewat');
  await sql(`DELETE FROM anon_rate_limit WHERE user_id=$1::uuid`, [akun.pembanjir]);
  await sql(`INSERT INTO anon_rate_limit(user_id,action)
    SELECT $1::uuid,'umkm_laporan' FROM generate_series(1,200)`, [akun.pembanjir]);
  const p = await terbit();
  const global = await lapor('pengunjung', p.id, randomUUID(), 'lainnya', 'Catatan biasa');
  ditolak(global, 'batas global'); bersih(global);
  await sql(`DELETE FROM anon_rate_limit WHERE user_id=$1::uuid`, [akun.pembanjir]);
  nilai(await lapor('pengunjung', p.id, randomUUID(), 'lainnya', 'Catatan biasa'), 'sesudah beban turun');
});

await uji('ukuran isi formulir dibatasi', async () => {
  const p = await terbit();
  ditolak(await pesan('anon', randomUUID(), 'a'.repeat(1001)), 'pesan 1001 karakter');
  nilai(await pesan('anon', randomUUID(), 'a'.repeat(1000)), 'pesan 1000 karakter');
  ditolak(await lapor('anon', p.id, randomUUID(), 'lainnya', 'b'.repeat(501)), 'catatan 501 karakter');
  nilai(await lapor('anon', p.id, randomUUID(), 'lainnya', 'b'.repeat(500)), 'catatan 500 karakter');
});

await uji('laporan kembar memakai satu baris sampai ditutup', async () => {
  const p = await terbit();
  const a = nilai(await lapor('pengunjung', p.id, randomUUID(), 'data_salah', 'Catatan pertama'), 'laporan pertama');
  const b = nilai(await lapor('anon', p.id, randomUUID(), 'data_salah', 'Catatan kedua'), 'laporan kembar');
  cek(a.id === b.id, 'kembar membuat receipt baru');
  const hitung = async () => (await sql(`SELECT count(*)::int AS n FROM umkm_laporan WHERE profil_id=$1::uuid
    AND alasan='data_salah'`, [p.id]))[0].n;
  cek(await hitung() === 1, 'kembar menambah baris');
  const lain = nilai(await lapor('pengunjung', p.id, randomUUID(), 'lainnya'), 'alasan lain');
  cek(lain.id !== a.id, 'alasan lain ikut digabung');
  const ambil = nilai(await rpc('petugas', 'umkm_ambil_pekerjaan', '$1::text,$2::uuid,$3::integer,$4::uuid',
    ['laporan', a.id, 1, randomUUID()]), 'ambil laporan');
  nilai(await rpc('petugas', 'umkm_selesaikan_pekerjaan', '$1::text,$2::uuid,$3::integer,$4::uuid',
    ['laporan', a.id, ambil.versi, randomUUID()]), 'selesai laporan');
  const baru = nilai(await lapor('pengunjung', p.id, randomUUID(), 'data_salah'), 'laporan sesudah ditutup');
  cek(baru.id !== a.id && await hitung() === 2, 'laporan sesudah ditutup tidak masuk');
});

await uji('antrean hapus foto: rencana salin, pointer aktif, dan FO tidak menutup', async () => {
  const kunci = () => `umkm-katalog/${randomUUID()}.jpg`;
  const url = k => `https://example.test/${k}`;
  const p = await buat({ ...data, nama: `Antre${randomUUID().slice(0, 8)}`,
    foto: [{ asal: 'unggahan', r2_key: 'umkm-draf/antre.jpg' }] });
  const foto = (await sql('SELECT id FROM umkm_foto WHERE revisi_id=$1::uuid', [p.revisi_id]))[0].id;
  const t = nilai(await putus(p.id, p.versi), 'terbit');
  const antrean = async (who = 'petugas') => nilai(await rpc(who, 'umkm_antrian_hapus_foto', '$1::uuid', [p.id]),
    'antrean').items;
  const tertunda = async () => nilai(await rpc('petugas', 'umkm_detail_tugas', '$1::uuid', [p.id]), 'detail')
    .foto_hapus_tertunda;
  nilai(await rpc('petugas', 'umkm_bukti_foto', '$1::uuid,$2::uuid,$3::text,$4::bigint,$5::text',
    [p.id, foto, 'abcd', 1234, 'image/jpeg']), 'bukti');
  const rencana = k => rpc('petugas', 'umkm_rencana_foto', '$1::uuid,$2::uuid,$3::text', [p.id, foto, k]);
  const tautkan = k => rpc('petugas', 'umkm_terbitkan_foto', '$1::uuid,$2::uuid,$3::text,$4::text,$5::text',
    [p.id, foto, 'abcd', k, url(k)]);
  for (const who of ['fo', 'admin', null, 'anon', 'biasa']) {
    ditolak(await rpc(who, 'umkm_rencana_foto', '$1::uuid,$2::uuid,$3::text', [p.id, foto, kunci()]), `${who} rencana`);
  }
  ditolak(await rencana('umkm-draf/antre.jpg'), 'rencana memakai kunci draf');
  const gagal = kunci(); nilai(await rencana(gagal), 'rencana gagal');
  cek((await antrean()).length === 0 && await tertunda() === 0, 'rencana muda masuk antrean');
  await sql(`UPDATE umkm_private.foto_hapus SET dibuat_pada=now()-interval '6 minutes' WHERE r2_key_publik=$1`,
    [gagal]);
  cek((await antrean()).some(x => x.r2_key_publik === gagal) && await tertunda() === 1, 'rencana tua tidak muncul');
  const batch = Array.from({ length: 21 }, kunci);
  await sql(`INSERT INTO umkm_private.foto_hapus(profil_id,foto_id,r2_key_publik,rencana,dibuat_pada)
    SELECT $1::uuid,$2::uuid,k,true,now()-interval '6 minutes' FROM unnest($3::text[]) k`, [p.id, foto, batch]);
  const terbatas = nilai(await rpc('petugas', 'umkm_antrian_hapus_foto', '$1::uuid', [p.id]), 'batch antrean');
  cek(terbatas.items.length === 20 && terbatas.total === 22, 'batch atau total antrean salah');
  cek(await tertunda() === 22, 'detail tidak menghitung sisa di luar batch');
  await sql('DELETE FROM umkm_private.foto_hapus WHERE r2_key_publik=ANY($1::text[])', [batch]);
  ditolak(await tautkan(kunci()), 'tautan tanpa rencana');
  const pakai = kunci(); nilai(await rencana(pakai), 'rencana dipakai'); nilai(await tautkan(pakai), 'tautan');
  const baris = await sql('SELECT count(*)::int AS n FROM umkm_private.foto_hapus WHERE r2_key_publik=$1', [pakai]);
  cek(baris[0].n === 0, 'penautan tidak menutup rencana');
  nilai(await tautkan(pakai), 'tautan ulang kunci sama');
  await sql(`INSERT INTO umkm_private.foto_hapus(profil_id,foto_id,r2_key_publik,rencana,dibuat_pada)
    VALUES($1::uuid,$2::uuid,$3,true,now()-interval '6 minutes')`, [p.id, foto, pakai]);
  cek(!(await antrean()).some(x => x.r2_key_publik === pakai), 'pointer aktif masuk antrean');
  cek(await tertunda() === 1, 'pointer aktif dihitung hapus tertunda');
  await sql('DELETE FROM umkm_private.foto_hapus WHERE r2_key_publik=$1', [pakai]);
  nilai(await rpc('petugas', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
    [p.id, t.versi, randomUUID(), 'sembunyikan', foto]), 'sembunyikan foto');
  const item = (await antrean('fo')).find(x => x.r2_key_publik === pakai);
  cek(item, 'salinan tersembunyi tidak masuk antrean'); cek(await tertunda() === 2, 'hapus tertunda salah');
  for (const who of ['fo', 'foflag', 'admin', null, 'anon']) {
    ditolak(await rpc(who, 'umkm_selesai_hapus_foto', '$1::uuid', [item.id]), `${who} menutup antrean`);
  }
  cek((await antrean()).some(x => x.id === item.id), 'antrean tertutup oleh peran lain');
  nilai(await rpc('petugas', 'umkm_selesai_hapus_foto', '$1::uuid', [item.id]), 'pemeriksa menutup');
  cek(!(await antrean()).some(x => x.id === item.id), 'antrean tidak tertutup');
});

await db.close();
console.log(`HASIL: ${lulus} PASS, ${gagal} FAIL`);
process.exitCode = gagal ? 1 : 0;
