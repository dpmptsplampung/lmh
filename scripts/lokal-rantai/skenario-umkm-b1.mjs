// Uji tahap B dengan data sintetis di PGlite lokal.
import { randomUUID } from 'node:crypto';
import { bukaDbPenuh, sebagai } from './harness.mjs';

let db;
try { db = await bukaDbPenuh(); } catch (e) {
  console.log(`FAIL inisialisasi migrasi: ${e.message}`);
  console.log('HASIL: 0 PASS, 1 FAIL');
  process.exit(1);
}
const names = ['pemohon', 'rekan', 'lain', 'hapus', 'hapus2', 'anonim', 'petugas', 'kedua', 'fo', 'admin'];
const users = Object.fromEntries(names.map(x => [x, randomUUID()]));
const staff = Object.fromEntries(['petugas', 'kedua', 'fo', 'admin'].map(x => [x, randomUUID()]));
const nomor = '081297654321';
let pass = 0, fail = 0;
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
async function sql(text, params = []) {
  const r = await sebagai(db, 'postgres', null, text, params);
  check(r.ok, `fixture ${r.kode}: ${r.pesan}`); return r.rows;
}
async function call(who, name, args = '', params = []) {
  const role = who === 'tanpa' ? 'anon' : 'authenticated';
  return sebagai(db, role, users[who] ?? null, `SELECT public.${name}(${args}) AS j`, params,
    who === 'anonim' ? { is_anonymous: true } : undefined);
}
function value(r, label) { check(r.ok, `${label}: ${r.kode} ${r.pesan}`); return r.rows[0].j; }
function reject(r, label) {
  check(!r.ok && !['42883', '42P01', '42703'].includes(r.kode), `${label}: ${r.kode ?? 'diterima'} ${r.pesan ?? ''}`);
}
async function test(label, fn) {
  try { await fn(); pass++; console.log(`PASS ${label}`); }
  catch (e) { fail++; console.log(`FAIL ${label}: ${e.message}`); }
}
const company = who => call(who, 'umkm_simpan_perusahaan', '$1::text,$2::text,true', ['Perusahaan Uji', 'Staf']);
const need = who => call(who, 'umkm_simpan_kebutuhan', '$1::text,$2::text,NULL::text,NULL::uuid',
  ['KebutuhanRahasia', 'makanan']);
const request = (who, n, ids, op = randomUUID()) => call(who, 'umkm_ajukan_kontak',
  '$1::uuid,$2::uuid[],$3::uuid', [n, ids, op]);
const take = (who, r) => call(who, 'umkm_ambil_pekerjaan', '$1::text,$2::uuid,$3::integer,$4::uuid',
  ['permintaan', r.id, r.versi, randomUUID()]);
const approve = (who, r, op = randomUUID()) => call(who, 'umkm_setujui_dan_buka',
  '$1::uuid,$2::integer,$3::uuid', [r.id, r.versi, op]);
const read = (who, id) => call(who, 'umkm_baca_nomor', '$1::uuid', [id]);
const cancel = (who, id) => call(who, 'umkm_batalkan_permintaan', '$1::uuid', [id]);
async function profile() {
  const data = { nama: 'Kopi Uji', deskripsi: 'Kopi pilihan', jenis: 'produk', kategori: 'makanan',
    kabupaten_kota: 'Lampung', sumber: 'kurasi', nomor };
  const p = value(await call('petugas', 'umkm_simpan_profil', '$1::jsonb,$2::uuid,NULL::uuid,NULL::integer',
    [JSON.stringify(data), randomUUID()]), 'profil');
  return value(await call('petugas', 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::text',
    [p.id, p.versi, randomUUID(), 'terbit']), 'terbit');
}
async function permission(p, status) {
  const v = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [p.id]))[0].versi;
  return value(await call('petugas', 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
    [p.id, v, randomUUID(), status]), 'izin');
}
async function setup(who = 'pemohon', consent = true) {
  const p = await profile();
  if (consent) await permission(p, 'diberikan');
  const n = value(await need(who), 'kebutuhan');
  const r = value(await request(who, n.id, [p.id]), 'ajukan').items[0];
  return { p, n, r: value(await take('petugas', r), 'ambil') };
}
async function opened(who = 'pemohon') {
  const x = await setup(who);
  x.r = value(await approve('petugas', x.r), 'setujui');
  check(x.r.status === 'nomor_dibuka', 'nomor tidak dibuka'); return x;
}
try {
  await sql('INSERT INTO auth.users(id,email) SELECT x::uuid,x || $2 FROM unnest($1::text[]) x',
    [Object.values(users), '@example.test']);
  await sql(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm)
    SELECT p::uuid,u::uuid,n,r,true,false FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) v(p,u,n,r)`,
  [Object.values(staff), Object.keys(staff).map(x => users[x]), Object.keys(staff),
    ['petugas', 'petugas', 'front_office', 'admin']]);
  for (const who of ['petugas', 'kedua']) value(await call('admin', 'umkm_atur_pemeriksa',
    '$1::uuid,true,$2::uuid', [staff[who], randomUUID()]), 'pemeriksa');

  await test('fungsi tahap B tersedia', async () => {
    check(value(await call('tanpa', 'umkm_tahap_b'), 'tahap B').aktif === true, 'tahap B tidak aktif');
    for (const who of ['pemohon', 'rekan', 'lain', 'hapus', 'hapus2']) value(await company(who), 'perusahaan');
  });
  await test('U-04 izin menunggu tanpa pembukaan otomatis dan perlu Setujui', async () => {
    const x = await setup('pemohon', false);
    let r = value(await approve('petugas', x.r), 'setujui tanpa izin');
    check(r.status === 'menunggu_izin', 'tidak menunggu izin');
    reject(await read('pemohon', r.id), 'sebelum izin');
    await permission(x.p, 'diberikan');
    reject(await read('pemohon', r.id), 'izin membuka otomatis');
    r = value(await approve('petugas', r), 'setujui dengan izin');
    check(r.status === 'nomor_dibuka' && !JSON.stringify(r).includes(nomor), 'hasil pembukaan salah');
    check(value(await read('pemohon', r.id), 'baca').nomor === nomor, 'nomor salah');
    const n2 = value(await need('pemohon'), 'kebutuhan kedua');
    const r2 = value(await request('pemohon', n2.id, [x.p.id]), 'permintaan kedua').items[0];
    check(r2.status === 'diajukan', 'perusahaan pernah diperiksa membuka otomatis');
    reject(await read('pemohon', r2.id), 'permintaan kedua sebelum Setujui');
  });
  await test('U-05 hanya pemohon dan sesi bukan anonim dapat baca', async () => {
    const x = await opened();
    for (const who of ['tanpa', 'anonim', 'rekan', 'lain', 'fo', 'admin']) reject(await read(who, x.r.id), who);
    reject(await read('pemohon', randomUUID()), 'UID tebakan');
    const anonymousOwner = await sebagai(db, 'authenticated', users.pemohon,
      'SELECT public.umkm_baca_nomor($1::uuid) AS j', [x.r.id], { is_anonymous: true });
    reject(anonymousOwner, 'pemohon dengan sesi anonim');
    check(value(await read('pemohon', x.r.id), 'pemohon').nomor === nomor, 'nomor pemohon salah');
    const daftar = value(await call('pemohon', 'umkm_permintaan_saya', '$1::text', [null]), 'daftar');
    check(!JSON.stringify(daftar).includes(nomor), 'nomor muncul dalam daftar pemohon');
    const deleted = await opened('hapus');
    await sql('DELETE FROM auth.users WHERE id=$1::uuid', [users.hapus]);
    reject(await read('hapus', deleted.r.id), 'akun terhapus');
  });
  await test('U-04 dan U-05 pencabutan, izin baru dan nomor baru menutup pembukaan lama', async () => {
    const x = await opened();
    await permission(x.p, 'dicabut');
    reject(await read('pemohon', x.r.id), 'pencabutan');
    const baru = value(await request('pemohon', x.n.id, [x.p.id]), 'pasangan setelah cabut').items[0];
    check(baru.id !== x.r.id && baru.status === 'diajukan', 'pencabutan tidak membuat permintaan baru');
    let r = value(await take('petugas', baru), 'ambil baru');
    r = value(await approve('petugas', r), 'setujui sesudah cabut');
    check(r.status === 'menunggu_izin', 'membuka sesudah cabut');
    await permission(x.p, 'diberikan');
    reject(await read('pemohon', x.r.id), 'izin baru menghidupkan pembukaan lama');
    const old = (await sql('SELECT kontak_terakhir_id FROM umkm_profil WHERE id=$1::uuid', [x.p.id]))[0];
    const k = (await sql(`INSERT INTO umkm_kontak_versi(profil_id,nomor,dibuat_oleh)
      VALUES($1::uuid,'081288887777',$2::uuid) RETURNING id`, [x.p.id, staff.petugas]))[0];
    await sql('UPDATE umkm_profil SET kontak_terakhir_id=$2::uuid WHERE id=$1::uuid', [x.p.id, k.id]);
    reject(await read('pemohon', x.r.id), 'nomor pengganti');
    check(old.kontak_terakhir_id !== k.id, 'fixture kontak tidak berubah');
  });
  await test('U-04 profil tersembunyi dan tahan mencegah pembukaan', async () => {
    const x = await setup();
    const v = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [x.p.id]))[0].versi;
    value(await call('petugas', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::uuid',
      [x.p.id, v, randomUUID(), 'sembunyikan']), 'sembunyikan');
    const hidden = await approve('petugas', x.r);
    if (!hidden.ok) reject(hidden, 'profil tersembunyi');
    else check(hidden.rows[0].j.status !== 'nomor_dibuka', 'profil tersembunyi terbuka');
    const y = await setup();
    const held = value(await call('fo', 'umkm_tahan_permintaan', '$1::uuid,$2::text,$3::integer,$4::uuid',
      [y.r.id, 'Perlu pemeriksaan', y.r.versi, randomUUID()]), 'tahan');
    const result = await approve('petugas', held);
    if (!result.ok) reject(result, 'permintaan ditahan');
    else check(result.rows[0].j.status !== 'nomor_dibuka', 'permintaan ditahan terbuka');
    reject(await call('fo', 'umkm_lepas_tahan', '$1::uuid,$2::integer,$3::uuid',
      [held.id, held.versi, randomUUID()]), 'FO lepas tahan');
    const released = value(await call('petugas', 'umkm_lepas_tahan', '$1::uuid,$2::integer,$3::uuid',
      [held.id, held.versi, randomUUID()]), 'petugas lepas tahan');
    check(released.tahan_darurat === false, 'tahan tidak dilepas');
  });
  await test('U-05 bantuan perlu kode sekali pakai dan akun tertaut', async () => {
    const p = await profile(); await permission(p, 'diberikan');
    const help = async (op = randomUUID()) => value(await call('petugas', 'umkm_bantu_permintaan',
      '$1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid,$9::uuid',
      ['Perusahaan Bantuan', 'Staf', 'PemohonRahasia', '081211112222', 'KebutuhanRahasia', 'makanan',
        'Lampung', p.id, op]), 'bantuan');
    const op = randomUUID();
    const a = await help(op), again = await help(op), b = await help();
    check(again.id === a.id && again.kode_tautan === null, 'replay bantuan mengulang kode atau permintaan');
    const held = value(await take('petugas', a), 'ambil bantuan');
    reject(await approve('petugas', held), 'bantuan belum tertaut');
    const invalid = value(await call('pemohon', 'umkm_tautkan_akun', '$1::text', ['SALAH']), 'kode salah');
    check(invalid.tertaut === false, 'kode salah diterima');
    const linked = value(await call('pemohon', 'umkm_tautkan_akun', '$1::text', [a.kode_tautan]), 'tautkan');
    check(linked.id === a.id && linked.id !== b.id, 'kode menautkan permintaan lain');
    const replay = await call('rekan', 'umkm_tautkan_akun', '$1::text', [a.kode_tautan]);
    if (!replay.ok) reject(replay, 'kode dipakai ulang');
    else check(replay.rows[0].j.tertaut === false, 'kode dipakai ulang');
    const bLinked = value(await call('rekan', 'umkm_tautkan_akun', '$1::text', [b.kode_tautan]), 'kode kedua');
    check(bLinked.id === b.id, 'kode kedua menautkan permintaan salah');
    const detail = value(await call('petugas', 'umkm_detail_permintaan', '$1::uuid', [held.id]), 'detail tertaut');
    const result = value(await approve('petugas', detail), 'setujui tertaut');
    check(result.status === 'nomor_dibuka', 'bantuan tertaut tidak terbuka');
  });
  await test('U-03 U-05 pasangan, batal, versi dan kunci operasi', async () => {
    const x = await setup(); const op = randomUUID();
    const pair = value(await request('pemohon', x.n.id, [x.p.id]), 'pasangan ulang').items[0];
    check(pair.id === x.r.id, 'pasangan aktif digandakan');
    const decision = value(await approve('petugas', x.r, op), 'setujui');
    const replay = value(await approve('petugas', x.r, op), 'setujui ulang');
    check(JSON.stringify(decision) === JSON.stringify(replay), 'replay berubah');
    reject(await approve('kedua', x.r), 'keputusan versi basi');
    reject(await cancel('pemohon', x.r.id), 'batal setelah buka');
    const count = await sql('SELECT count(*)::int n FROM umkm_pembukaan_nomor WHERE permintaan_id=$1::uuid', [x.r.id]);
    check(count[0].n === 1, 'pembukaan digandakan');
    const y = await setup(); value(await cancel('pemohon', y.r.id), 'batal sebelum buka');
    const z = await setup();
    const second = value(await take('kedua', z.r), 'petugas kedua mengambil');
    reject(await approve('petugas', z.r), 'keputusan petugas pertama versi basi');
    const winner = value(await approve('kedua', second), 'keputusan petugas kedua');
    check(winner.status === 'nomor_dibuka', 'keputusan petugas kedua tidak menang');
    const wins = await sql('SELECT count(*)::int n FROM umkm_pembukaan_nomor WHERE permintaan_id=$1::uuid', [z.r.id]);
    check(wins[0].n === 1, 'lebih dari satu keputusan menang');
  });
  await test('U-10 hasil awal belum diketahui dan replay tidak menggandakan', async () => {
    const x = await opened();
    let rows = await sql('SELECT hasil FROM umkm_pembukaan_nomor WHERE permintaan_id=$1::uuid', [x.r.id]);
    check(rows[0].hasil === 'belum_diketahui', 'pembukaan dihitung sebagai kerja sama');
    value(await call('petugas', 'umkm_catat_hasil', '$1::uuid,$2::text', [x.r.id, 'kerja_sama']), 'hasil');
    const before = await sql('SELECT count(*)::int n FROM umkm_riwayat WHERE objek_id=$1::uuid', [x.r.id]);
    value(await call('petugas', 'umkm_catat_hasil', '$1::uuid,$2::text', [x.r.id, 'kerja_sama']), 'ulang hasil');
    const after = await sql('SELECT count(*)::int n FROM umkm_riwayat WHERE objek_id=$1::uuid', [x.r.id]);
    check(before[0].n === after[0].n, 'replay hasil menambah riwayat');
    rows = await sql('SELECT hasil FROM umkm_pembukaan_nomor WHERE permintaan_id=$1::uuid', [x.r.id]);
    check(rows.length === 1 && rows[0].hasil === 'kerja_sama', 'hasil digandakan');
  });
  await test('U-06 akses tabel dan ringkasan FO/admin tidak membocorkan data', async () => {
    const x = await opened();
    const bantuan = value(await call('petugas', 'umkm_bantu_permintaan',
      '$1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid,$9::uuid',
      ['Perusahaan Bantuan', 'Staf', 'PemohonRahasia', '081211112222', 'KebutuhanRahasia', 'makanan',
        'Lampung', x.p.id, randomUUID()]), 'bantuan privat');
    for (const role of ['anon', 'authenticated', 'service_role']) for (const table of
      ['umkm_perusahaan', 'umkm_kebutuhan', 'umkm_permintaan_kontak', 'umkm_pembukaan_nomor']) {
      const r = await sebagai(db, role, users.fo, `SELECT * FROM public.${table}`);
      check(!r.ok && r.kode === '42501', `${role} dapat membaca ${table}`);
    }
    for (const who of ['fo', 'admin']) {
      reject(await call(who, 'umkm_detail_permintaan', '$1::uuid', [x.r.id]), 'detail privat');
      reject(await approve(who, x.r), 'setujui privat');
      reject(await call(who, 'umkm_permintaan_saya', '$1::text', [null]), 'daftar pemohon privat');
      const ringkas = value(await call(who, 'umkm_ringkasan_pengawasan'), 'ringkasan');
      const jejak = value(await call(who, 'umkm_jejak_pengawasan', '$1::text', [null]), 'jejak');
      const cari = value(await call(who, 'umkm_cari_pengawasan', '$1::text,$2::uuid', ['Kopi', null]), 'cari');
      const teks = JSON.stringify([ringkas, jejak, cari]);
      for (const secret of [nomor, 'KebutuhanRahasia', 'Perusahaan Uji', '@example.test', bantuan.kode_tautan,
        'PemohonRahasia', '081211112222'])
        check(!teks.includes(secret), `data privat muncul: ${secret}`);
    }
    const report = value(await call('admin', 'umkm_laporan_statistik'), 'laporan');
    for (const secret of [nomor, 'KebutuhanRahasia', 'Perusahaan Uji', '@example.test'])
      check(!JSON.stringify(report).includes(secret), 'data privat dalam laporan');
  });
  await test('U-06 laporan dan ekspor tidak memuat data privat dan FO ditolak', async () => {
    const p = await profile();
    const bantuan = value(await call('petugas', 'umkm_bantu_permintaan',
      '$1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid,$9::uuid',
      ['Perusahaan Bantuan', 'Staf', 'PemohonRahasia', '081211112222', 'KebutuhanRahasia', 'makanan',
        'Lampung', p.id, randomUUID()]), 'bantuan laporan');
    for (const rpc of ['umkm_laporan_statistik', 'umkm_ekspor_statistik']) {
      reject(await call('fo', rpc), `FO ${rpc}`);
      const data = JSON.stringify(value(await call('admin', rpc), rpc));
      for (const secret of [nomor, 'KebutuhanRahasia', 'Perusahaan Bantuan', 'PemohonRahasia',
        '081211112222', '@example.test', bantuan.kode_tautan]) {
        check(!data.includes(secret), `${rpc} membocorkan ${secret}`);
      }
    }
  });
  await test('akun terhapus menutup kebutuhan dan membatalkan permintaan', async () => {
    const x = await setup('hapus2');
    const y = await opened('hapus2');
    value(await call('fo', 'umkm_tahan_permintaan', '$1::uuid,$2::text,$3::integer,$4::uuid',
      [x.r.id, 'Perlu pemeriksaan', x.r.versi, randomUUID()]), 'tahan sebelum akun dihapus');
    value(await call('fo', 'umkm_tahan_permintaan', '$1::uuid,$2::text,$3::integer,$4::uuid',
      [y.r.id, 'Perlu pemeriksaan', y.r.versi, randomUUID()]), 'tahan pembukaan sebelum akun dihapus');
    await sql('DELETE FROM auth.users WHERE id=$1::uuid', [users.hapus2]);
    const kebutuhan = await sql('SELECT status FROM umkm_kebutuhan WHERE id=ANY($1::uuid[])', [[x.n.id, y.n.id]]);
    check(kebutuhan.every(k => k.status === 'ditutup'), 'kebutuhan akun terhapus masih aktif');
    const rows = await sql('SELECT id,status,ditutup_pada FROM umkm_permintaan_kontak WHERE id=ANY($1::uuid[])',
      [[x.r.id, y.r.id]]);
    check(rows.find(r => r.id === x.r.id)?.status === 'dibatalkan', 'permintaan belum terbuka tidak dibatalkan');
    check(rows.length === 2 && rows.every(r => r.ditutup_pada), 'waktu tutup permintaan tidak lengkap');
    let cursor = null;
    do {
      const page = value(await call('petugas', 'umkm_daftar_tugas', '$1::text', [cursor]), 'antrean');
      for (const id of [x.r.id, y.r.id]) {
        check(!JSON.stringify(page.items).includes(id), 'permintaan akun terhapus masih di antrean');
      }
      cursor = page.next_cursor;
    } while (cursor);
    reject(await read('hapus2', y.r.id), 'nomor akun terhapus');
  });
  await test('retensi kebutuhan lama tanpa permintaan dan kebutuhan aktif', async () => {
    const closed = value(await need('pemohon'), 'kebutuhan lama');
    const active = value(await need('pemohon'), 'kebutuhan aktif');
    value(await call('pemohon', 'umkm_tutup_kebutuhan', '$1::uuid', [closed.id]), 'tutup kebutuhan');
    await sql("UPDATE umkm_kebutuhan SET ditutup_pada=now()-interval '731 days' WHERE id=$1::uuid", [closed.id]);
    await sql('SELECT umkm_private.bersihkan_retensi()');
    const rows = await sql('SELECT id,teks FROM umkm_kebutuhan WHERE id=ANY($1::uuid[])', [[closed.id, active.id]]);
    check(rows.find(r => r.id === closed.id)?.teks === '', 'teks kebutuhan lama belum dikosongkan');
    check(rows.find(r => r.id === active.id)?.teks === 'KebutuhanRahasia', 'teks kebutuhan aktif dikosongkan');
  });
  await test('retensi menyimpan kebutuhan dengan permintaan dalam masa simpan', async () => {
    const x = await setup();
    value(await call('pemohon', 'umkm_tutup_kebutuhan', '$1::uuid', [x.n.id]), 'tutup kebutuhan');
    await sql("UPDATE umkm_kebutuhan SET ditutup_pada=now()-interval '731 days' WHERE id=$1::uuid", [x.n.id]);
    await sql('SELECT umkm_private.bersihkan_retensi()');
    const rows = await sql('SELECT teks FROM umkm_kebutuhan WHERE id=$1::uuid', [x.n.id]);
    check(rows[0].teks === 'KebutuhanRahasia', 'kebutuhan dengan permintaan baru dikosongkan');
  });
  await test('retensi tidak mengosongkan kebutuhan aktif meski permintaan lama', async () => {
    const x = await setup();
    value(await cancel('pemohon', x.r.id), 'batal lama');
    await sql("UPDATE umkm_permintaan_kontak SET ditutup_pada=now()-interval '731 days' WHERE id=$1::uuid",
      [x.r.id]);
    await sql('SELECT umkm_private.bersihkan_retensi()');
    const rows = await sql('SELECT teks FROM umkm_kebutuhan WHERE id=$1::uuid', [x.n.id]);
    check(rows[0].teks === 'KebutuhanRahasia', 'kebutuhan aktif dengan permintaan lama dikosongkan');
  });
  await test('retensi menetralkan perusahaan tanpa akun dan mempertahankan akun aktif', async () => {
    const orphan = (await sql(`INSERT INTO umkm_perusahaan(nama,jabatan,dibuat_pada)
      VALUES('Nama Lama Rahasia','Jabatan Lama Rahasia',now()-interval '731 days') RETURNING id`))[0];
    const active = (await sql('SELECT id,nama,jabatan FROM umkm_perusahaan WHERE pemohon_uid=$1::uuid',
      [users.pemohon]))[0];
    await sql('SELECT umkm_private.bersihkan_retensi()');
    const rows = await sql('SELECT id,nama,jabatan FROM umkm_perusahaan WHERE id=ANY($1::uuid[])',
      [[orphan.id, active.id]]);
    const old = rows.find(r => r.id === orphan.id), live = rows.find(r => r.id === active.id);
    check(old.nama !== 'Nama Lama Rahasia' && old.jabatan !== 'Jabatan Lama Rahasia',
      'perusahaan tanpa akun belum dinetralkan');
    check(live.nama === active.nama && live.jabatan === active.jabatan, 'perusahaan aktif berubah');
  });
  await test('tahan ditolak pada permintaan dibatalkan', async () => {
    const x = await setup();
    value(await cancel('pemohon', x.r.id), 'batal');
    const row = (await sql('SELECT versi FROM umkm_permintaan_kontak WHERE id=$1::uuid', [x.r.id]))[0];
    reject(await call('fo', 'umkm_tahan_permintaan', '$1::uuid,$2::text,$3::integer,$4::uuid',
      [x.r.id, 'Perlu pemeriksaan', row.versi, randomUUID()]), 'tahan permintaan dibatalkan');
  });
  await test('permintaan ditahan lalu dibatalkan tetap dapat diambil dan dilepas', async () => {
    const x = await setup();
    value(await call('fo', 'umkm_tahan_permintaan', '$1::uuid,$2::text,$3::integer,$4::uuid',
      [x.r.id, 'Perlu pemeriksaan', x.r.versi, randomUUID()]), 'tahan');
    value(await cancel('pemohon', x.r.id), 'batal saat ditahan');
    const row = (await sql('SELECT id,versi FROM umkm_permintaan_kontak WHERE id=$1::uuid', [x.r.id]))[0];
    const taken = value(await take('kedua', row), 'ambil ditahan dan batal');
    const released = value(await call('kedua', 'umkm_lepas_tahan', '$1::uuid,$2::integer,$3::uuid',
      [taken.id, taken.versi, randomUUID()]), 'lepas ditahan dan batal');
    check(released.status === 'dibatalkan' && released.tahan_darurat === false, 'tahan belum dilepas');
  });
  await test('U-12 satu akun 300 permintaan dan replay potongan', async () => {
    const n = value(await need('pemohon'), 'kebutuhan massal');
    const ids = (await sql(`INSERT INTO umkm_profil(sumber,status,terbit_pada)
      SELECT 'kurasi','terbit',now() FROM generate_series(1,300) RETURNING id`)).map(x => x.id);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50), op = randomUUID();
      const a = value(await request('pemohon', n.id, chunk, op), 'potongan');
      const b = value(await request('pemohon', n.id, chunk, op), 'replay potongan');
      check(a.items.length === 50 && JSON.stringify(a) === JSON.stringify(b), 'potongan hilang atau berubah');
    }
    const rows = await sql(`SELECT count(*)::int n FROM umkm_permintaan_kontak
      WHERE kebutuhan_id=$1::uuid AND status='diajukan'`, [n.id]);
    check(rows[0].n === 300, `jumlah aktif ${rows[0].n}`);
  });
} catch (e) {
  fail++; console.log(`FAIL inisialisasi fixture: ${e.message}`);
} finally {
  await db.close();
}
console.log(`HASIL: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
