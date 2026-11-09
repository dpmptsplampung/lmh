// Uji hak pemilik tahap C dengan data sintetis dalam PGlite lokal.
import { randomUUID } from 'node:crypto';
import { bukaDbPenuh, sebagai } from './harness.mjs';

let db;
let pass = 0, fail = 0;
const akun = Object.fromEntries(['x', 'y', 'mandiri', 'pengklaim', 'lama', 'pemohon', 'petugas', 'admin', 'fo',
  'ganti', 'sembunyi', 'cabut', 'mandiri2']
  .map(k => [k, randomUUID()]));
const pet = Object.fromEntries(['petugas', 'admin', 'fo'].map(k => [k, randomUUID()]));
const nomor = '081297654321';
const data = { nama: 'Kopi Terbit', deskripsi: 'Kopi pilihan', jenis: 'produk', kategori: 'makanan',
  kabupaten_kota: 'Lampung', nomor };
function cek(ok, pesan) { if (!ok) throw new Error(pesan); }
function nilai(r, label) { cek(r.ok, `${label}: ${r.kode} ${r.pesan}`); return r.rows[0]?.j; }
function tolak(r, label) {
  cek(!r.ok && !['42883', '42P01', '42703'].includes(r.kode), `${label}: ${r.kode ?? 'diterima'} ${r.pesan ?? ''}`);
}
async function uji(label, fn) {
  try { await fn(); pass++; console.log(`PASS ${label}`); }
  catch (e) { fail++; console.log(`FAIL ${label}: ${e.message}`); }
}
const rpc = (who, name, args = '', params = []) => sebagai(db, who === null ? 'anon' : 'authenticated',
  who === null ? null : akun[who], `SELECT public.${name}(${args}) AS j`, params);
async function sql(text, params = []) {
  const r = await sebagai(db, 'postgres', null, text, params);
  cek(r.ok, `fixture: ${r.kode} ${r.pesan}`); return r.rows;
}
const profilRpc = (who, name, id) => rpc(who, name, '$1::uuid', [id]);
const detail = (who, id) => profilRpc(who, 'umkm_detail_usaha', id);
const publik = id => profilRpc(null, 'umkm_profil_publik', id);
const draft = (who, p, body) => rpc(who, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
  [p.id, JSON.stringify(body), p.versi, randomUUID()]);
async function terbit() {
  const p = nilai(await rpc('petugas', 'umkm_simpan_profil', '$1::jsonb,$2::uuid,NULL::uuid,NULL::integer',
    [JSON.stringify({ ...data, sumber: 'kurasi' }), randomUUID()]), 'simpan');
  return nilai(await rpc('petugas', 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::text',
    [p.id, p.versi, randomUUID(), 'terbit']), 'terbit');
}
async function owner(who, p) {
  const claim = nilai(await rpc(who, 'umkm_klaim_profil', '$1::uuid,$2::text,$3::uuid',
    [p.id, 'Penanggung jawab usaha', randomUUID()]), 'klaim');
  const taken = nilai(await rpc('petugas', 'umkm_ambil_klaim', '$1::uuid,$2::integer,$3::uuid',
    [claim.id, claim.versi, randomUUID()]), 'ambil klaim');
  nilai(await rpc('petugas', 'umkm_putuskan_klaim', '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::text',
    [claim.id, taken.versi, randomUUID(), 'disetujui']), 'setujui klaim');
}
async function bukaNomor(p) {
  const versi = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [p.id]))[0].versi;
  nilai(await rpc('petugas', 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
    [p.id, versi, randomUUID(), 'diberikan']), 'izin');
  const n = nilai(await rpc('pemohon', 'umkm_simpan_kebutuhan', '$1::text,$2::text,NULL::text,NULL::uuid',
    ['Kebutuhan ' + p.id.slice(0, 8), 'makanan']), 'kebutuhan');
  const req = nilai(await rpc('pemohon', 'umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid',
    [n.id, [p.id], randomUUID()]), 'ajukan').items[0];
  const ambil = nilai(await rpc('petugas', 'umkm_ambil_pekerjaan', '$1::text,$2::uuid,$3::integer,$4::uuid',
    ['permintaan', req.id, req.versi, randomUUID()]), 'ambil');
  const buka = nilai(await rpc('petugas', 'umkm_setujui_dan_buka', '$1::uuid,$2::integer,$3::uuid',
    [req.id, ambil.versi, randomUUID()]), 'buka');
  cek(nilai(await profilRpc('pemohon', 'umkm_baca_nomor', buka.id), 'baca').nomor === nomor, 'nomor salah');
  return buka;
}
const versiProfil = async id => (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [id]))[0].versi;
try {
  db = await bukaDbPenuh();
  const tahap = await rpc(null, 'umkm_tahap_c');
  if (!tahap.ok) throw new Error(`fungsi tahap C belum tersedia: ${tahap.kode} ${tahap.pesan}`);
  cek(nilai(tahap, 'tahap C').aktif === true, 'tahap C tidak aktif');
  await sql('INSERT INTO auth.users(id,email) SELECT x::uuid,x || $2 FROM unnest($1::text[]) x',
    [Object.values(akun), '@example.test']);
  await sql(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm)
    SELECT p::uuid,u::uuid,n,r,true,false FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) v(p,u,n,r)`,
  [Object.values(pet), Object.keys(pet).map(k => akun[k]), Object.keys(pet), ['petugas', 'admin', 'front_office']]);
  nilai(await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid',
    [pet.petugas, randomUUID()]), 'pemeriksa');
  const x = await terbit(), y = await terbit();
  await owner('x', x); await owner('y', y);
  await uji('login, email lama, HP dan klaim belum disetujui tidak memberi hak', async () => {
    const lama = (await sql(`INSERT INTO listing_umkm
      (nama_umkm,kategori_kebutuhan,kontak_nama,kontak_hp,kontak_email,status)
      VALUES('Usaha Lama','lainnya','Lama',$1,$2,'published') RETURNING id`,
    [nomor, `${akun.lama}@example.test`]))[0];
    await sql('INSERT INTO umkm_listing_owner(listing_id,email) VALUES($1::uuid,$2)',
      [lama.id, `${akun.lama}@example.test`]);
    await sql('UPDATE umkm_profil SET sumber_ref=$2 WHERE id=$1::uuid', [x.id, lama.id]);
    for (const who of ['lama', 'pengklaim']) {
      tolak(await profilRpc(who, 'umkm_statistik_pemilik', x.id), `${who} statistik`);
      tolak(await profilRpc(who, 'umkm_akses_draf_pemilik', x.id), `${who} foto`);
      tolak(await draft(who, x, data), `${who} draf`);
    }
    const klaim = nilai(await rpc('pengklaim', 'umkm_klaim_profil', '$1::uuid,$2::text,$3::uuid',
      [x.id, 'Penanggung jawab usaha', randomUUID()]), 'klaim diajukan');
    cek(klaim.status === 'diajukan', 'klaim bukan diajukan');
    tolak(await profilRpc('pengklaim', 'umkm_akses_draf_pemilik', x.id), 'foto sebelum putusan');
    tolak(await profilRpc('pengklaim', 'umkm_statistik_pemilik', x.id), 'statistik sebelum putusan');
    tolak(await draft('pengklaim', x, data), 'draf sebelum putusan');
    const d = nilai(await detail('pengklaim', x.id), 'detail pengklaim');
    cek(!d.revisi && !d.nomor && !d.izin_status && !(d.foto ?? []).length, 'detail klaim memuat data privat');
  });
  await uji('pendaftar mandiri dapat memperbaiki draf tanpa hak nomor dan statistik', async () => {
    const p = nilai(await rpc('mandiri', 'umkm_daftar_usaha', '$1::jsonb,$2::uuid',
      [JSON.stringify(data), randomUUID()]), 'daftar mandiri');
    cek(p.pemilik_status === 'diajukan', 'pemilik langsung disetujui');
    const sendiri = nilai(await detail('mandiri', p.id), 'detail mandiri');
    cek(sendiri.revisi, 'revisi mandiri tidak terlihat');
    cek(nilai(await profilRpc('mandiri', 'umkm_akses_draf_pemilik', p.id), 'foto mandiri').diizinkan,
      'foto mandiri ditolak');
    tolak(await profilRpc('mandiri', 'umkm_statistik_pemilik', p.id), 'statistik mandiri');
    tolak(await rpc('mandiri', 'umkm_cabut_izin_pemilik', '$1::uuid,$2::integer,$3::uuid',
      [p.id, p.versi, randomUUID()]), 'cabut mandiri');
    const taken = nilai(await rpc('petugas', 'umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid',
      [p.id, p.versi, randomUUID()]), 'ambil mandiri');
    const rejected = nilai(await rpc('petugas', 'umkm_putuskan_profil',
      '$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',
      [p.id, taken.versi, randomUUID(), 'ditolak', 'Perlu perbaikan']), 'tolak mandiri');
    const revisi = nilai(await draft('mandiri', rejected, { ...data, nama: 'Perbaikan Mandiri' }), 'perbaiki');
    cek(revisi.status === 'diajukan' && revisi.pemilik_status === 'diajukan', 'status perbaikan salah');
    const publicResult = await publik(p.id);
    cek(!publicResult.ok || !publicResult.rows[0]?.j, 'profil mandiri draf tampil publik');
  });
  await uji('revisi dan foto draf privat, versi terbit tetap sampai disetujui', async () => {
    const before = nilai(await publik(x.id), 'publik sebelum');
    const key = `umkm-draf/${x.id}/${randomUUID()}.jpg`;
    const d = nilai(await draft('x', x, { ...data, nama: 'Nama Draf', foto: [{ asal: 'unggahan', r2_key: key }] }),
      'simpan draf');
    const visible = nilai(await publik(x.id), 'publik setelah draf');
    cek(visible.nama === before.nama && !JSON.stringify(visible).includes(key), 'draf muncul publik');
    tolak(await profilRpc('y', 'umkm_akses_draf_pemilik', x.id), 'pemilik lain akses foto');
    tolak(await detail('y', x.id), 'pemilik lain akses detail');
    cek(nilai(await profilRpc('x', 'umkm_akses_draf_pemilik', x.id), 'akses sendiri').diizinkan, 'foto ditolak');
    const approved = nilai(await rpc('petugas', 'umkm_putuskan_profil',
      '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::text', [x.id, d.versi, randomUUID(), 'terbit']), 'putusan');
    cek(nilai(await publik(x.id), 'publik sesudah putusan').nama === 'Nama Draf', 'revisi tidak terbit');
    x.versi = approved.versi;
  });
  await uji('pencabutan pemilik langsung menutup nomor tahap B', async () => {
    const versi = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [x.id]))[0].versi;
    nilai(await rpc('petugas', 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
      [x.id, versi, randomUUID(), 'diberikan']), 'izin');
    nilai(await rpc('pemohon', 'umkm_simpan_perusahaan', '$1::text,$2::text,true',
      ['Perusahaan Uji', 'Staf']), 'perusahaan');
    const n = nilai(await rpc('pemohon', 'umkm_simpan_kebutuhan', '$1::text,$2::text,NULL::text,NULL::uuid',
      ['KebutuhanRahasia', 'makanan']), 'kebutuhan');
    const req = nilai(await rpc('pemohon', 'umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid',
      [n.id, [x.id], randomUUID()]), 'ajukan').items[0];
    const ambil = nilai(await rpc('petugas', 'umkm_ambil_pekerjaan', '$1::text,$2::uuid,$3::integer,$4::uuid',
      ['permintaan', req.id, req.versi, randomUUID()]), 'ambil');
    const buka = nilai(await rpc('petugas', 'umkm_setujui_dan_buka', '$1::uuid,$2::integer,$3::uuid',
      [req.id, ambil.versi, randomUUID()]), 'buka');
    cek(nilai(await profilRpc('pemohon', 'umkm_baca_nomor', buka.id), 'baca').nomor === nomor, 'nomor salah');
    const v = (await sql('SELECT versi FROM umkm_profil WHERE id=$1::uuid', [x.id]))[0].versi;
    nilai(await rpc('x', 'umkm_cabut_izin_pemilik', '$1::uuid,$2::integer,$3::uuid',
      [x.id, v, randomUUID()]), 'cabut');
    tolak(await profilRpc('pemohon', 'umkm_baca_nomor', buka.id), 'baca setelah cabut');
  });
  await uji('statistik dan penerima hanya pemilik sendiri, tanpa data pemohon', async () => {
    tolak(await profilRpc('x', 'umkm_statistik_pemilik', y.id), 'statistik profil Y');
    tolak(await rpc('x', 'umkm_perusahaan_penerima', '$1::uuid,NULL::text', [y.id]), 'penerima profil Y');
    const statistik = nilai(await profilRpc('x', 'umkm_statistik_pemilik', x.id), 'statistik sendiri');
    cek(statistik.tren.length === 30, 'tren bukan 30 hari');
    const page = nilai(await rpc('x', 'umkm_perusahaan_penerima', '$1::uuid,NULL::text', [x.id]), 'penerima');
    cek(page.items.length > 0 && page.items.length <= 20, 'penerima kosong atau terlalu banyak');
    cek(page.items.some(i => i.nama === 'Perusahaan Uji'), 'perusahaan tidak tercatat');
    cek(page.items.every(i => Object.keys(i).sort().join(',') === 'dibuka_pada,nama'), 'data pemohon terbuka');
  });
  await uji('FO tidak memperoleh data pemilik', async () => {
    tolak(await detail('fo', x.id), 'detail pemilik FO');
    tolak(await profilRpc('fo', 'umkm_statistik_pemilik', x.id), 'statistik FO');
    tolak(await rpc('fo', 'umkm_daftar_tugas', '$1::text', [null]), 'antrean FO');
    const ringkas = nilai(await rpc('fo', 'umkm_ringkasan_pengawasan'), 'ringkasan FO');
    for (const s of [akun.x, `${akun.x}@example.test`, nomor]) {
      cek(!JSON.stringify(ringkas).includes(s), 'data pemilik muncul di antrean FO');
    }
  });
  await uji('pemilik mengganti nomor lewat draf: pembukaan lama langsung tertutup', async () => {
    const g = await terbit(); await owner('ganti', g);
    const buka = await bukaNomor(g);
    g.versi = await versiProfil(g.id);
    nilai(await draft('ganti', g, { ...data, nomor: '081211112222' }), 'draf nomor baru');
    tolak(await profilRpc('pemohon', 'umkm_baca_nomor', buka.id), 'baca nomor lama sesudah draf ganti nomor');
  });
  await uji('jejak FO untuk tindakan pemilik berlabel Pemilik usaha tanpa UID', async () => {
    const g = (await sql(`SELECT p.id,p.versi FROM umkm_pemilik m JOIN umkm_profil p ON p.id=m.profil_id
      WHERE m.akun_uid=$1::uuid`, [akun.ganti]))[0];
    const jejak = nilai(await rpc('fo', 'umkm_jejak_pengawasan'), 'jejak FO');
    const baris = jejak.items.find(i => i.profil_id === g.id && i.aksi === 'simpan');
    cek(baris, 'tindakan pemilik tidak ada di jejak');
    cek(baris.aktor_nama === 'Pemilik usaha', `label aktor: ${baris.aktor_nama}`);
    cek(baris.peran === 'pemilik', `peran: ${baris.peran}`);
    const teks = JSON.stringify(jejak);
    for (const id of Object.values(akun)) cek(!teks.includes(id), 'UID akun muncul di jejak FO');
    cek(!teks.includes('@example.test') && !teks.includes(nomor), 'kontak akun muncul di jejak FO');
  });
  await uji('draf pemilik pada profil disembunyikan ditolak KONFLIK_STATUS', async () => {
    const h = await terbit(); await owner('sembunyi', h);
    h.versi = await versiProfil(h.id);
    nilai(await rpc('fo', 'umkm_tindakan_darurat', '$1::uuid,$2::text,$3::text,$4::integer,$5::uuid',
      [h.id, 'sembunyikan', 'Perlu pemeriksaan', h.versi, randomUUID()]), 'sembunyikan FO');
    h.versi = await versiProfil(h.id);
    const r = await draft('sembunyi', h, { ...data, nama: 'Usaha Disembunyikan' });
    cek(!r.ok && /KONFLIK_STATUS/.test(`${r.pesan}`), `draf diterima atau galat lain: ${r.kode} ${r.pesan}`);
    const sesudah = (await sql('SELECT status,versi FROM umkm_profil WHERE id=$1::uuid', [h.id]))[0];
    cek(sesudah.status === 'disembunyikan' && sesudah.versi === h.versi, 'status atau versi profil berubah');
    const pub = await publik(h.id);
    cek(!pub.ok || !pub.rows[0]?.j, 'profil tersembunyi tampil publik');
  });
  await uji('cabut kepemilikan menutup seluruh akses akun dan boleh klaim lagi', async () => {
    const c = await terbit(); await owner('cabut', c);
    const t = nilai(await profilRpc('petugas', 'umkm_detail_tugas', c.id), 'detail tugas');
    cek(t.pemilik_terdaftar?.length === 1, 'pemilik_terdaftar tidak berisi satu baris');
    const m = t.pemilik_terdaftar[0];
    cek(!Object.keys(m).some(k => /uid|email|hp|kontak/i.test(k)), 'pemilik_terdaftar memuat data akun');
    const cabut = (who, op = randomUUID(), alasan = 'Bukan penanggung jawab') => rpc(who, 'umkm_cabut_kepemilikan',
      '$1::uuid,$2::integer,$3::uuid,$4::text', [m.id, m.versi, op, alasan]);
    nilai(await detail('cabut', c.id), 'detail sebelum cabut');
    nilai(await profilRpc('cabut', 'umkm_statistik_pemilik', c.id), 'statistik sebelum cabut');
    tolak(await cabut('admin'), 'cabut oleh admin tanpa penanda');
    tolak(await cabut('fo'), 'cabut oleh FO');
    tolak(await cabut('petugas', randomUUID(), ''), 'cabut tanpa alasan');
    tolak(await cabut('petugas', randomUUID(), 'Hubungi 081234567890'), 'cabut alasan memuat nomor');
    const op = randomUUID();
    const hasil = nilai(await cabut('petugas', op), 'cabut');
    cek(hasil.status === 'ditolak', `status sesudah cabut: ${hasil.status}`);
    const ulang = nilai(await cabut('petugas', op), 'cabut replay');
    cek(JSON.stringify(ulang) === JSON.stringify(hasil), 'replay menghasilkan hasil berbeda');
    const baris = (await sql(`SELECT status,alasan_tolak,diperiksa_oleh,diperiksa_pada,versi
      FROM umkm_pemilik WHERE id=$1::uuid`, [m.id]))[0];
    cek(baris.status === 'ditolak' && baris.alasan_tolak && baris.diperiksa_oleh && baris.diperiksa_pada,
      'baris belum lengkap');
    cek(baris.versi === m.versi + 1, 'versi tidak naik satu');
    const riwayat = await sql(`SELECT to_jsonb(h)::text t FROM umkm_riwayat h WHERE aksi='cabut_kepemilikan'
      AND objek_id IN ($1::uuid,$2::uuid)`, [m.id, c.id]);
    cek(riwayat.length === 1, `riwayat cabut_kepemilikan: ${riwayat.length} baris`);
    cek(!riwayat[0].t.includes(akun.cabut), 'riwayat memuat UID akun');
    const sisa = await detail('cabut', c.id);
    if (sisa.ok) {
      const d = sisa.rows[0]?.j ?? {};
      cek(!d.revisi && !d.nomor && !d.izin_status && !(d.foto ?? []).length, 'detail masih memuat data privat');
    }
    tolak(await profilRpc('cabut', 'umkm_statistik_pemilik', c.id), 'statistik');
    tolak(await rpc('cabut', 'umkm_perusahaan_penerima', '$1::uuid,NULL::text', [c.id]), 'penerima');
    tolak(await draft('cabut', { id: c.id, versi: await versiProfil(c.id) }, data), 'draf');
    tolak(await profilRpc('cabut', 'umkm_akses_draf_pemilik', c.id), 'akses foto');
    const klaim = nilai(await rpc('cabut', 'umkm_klaim_profil', '$1::uuid,$2::text,$3::uuid',
      [c.id, 'Penanggung jawab usaha', randomUUID()]), 'klaim ulang');
    cek(klaim.status === 'diajukan', `klaim ulang: ${klaim.status}`);
  });
  await uji('petugas menyimpan profil mandiri: sumber tetap, terbit pertama menyetujui pendaftar', async () => {
    const p = nilai(await rpc('mandiri2', 'umkm_daftar_usaha', '$1::jsonb,$2::uuid',
      [JSON.stringify(data), randomUUID()]), 'daftar mandiri');
    const taken = nilai(await rpc('petugas', 'umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid',
      [p.id, p.versi, randomUUID()]), 'ambil');
    const simpan = nilai(await rpc('petugas', 'umkm_simpan_profil', '$1::jsonb,$2::uuid,$3::uuid,$4::integer',
      [JSON.stringify({ ...data, sumber: 'kurasi', nama: 'Dikoreksi Petugas' }), randomUUID(), p.id, taken.versi]),
    'simpan petugas');
    const baris = (await sql('SELECT sumber,sumber_ref FROM umkm_profil WHERE id=$1::uuid', [p.id]))[0];
    cek(baris.sumber === 'mandiri', `sumber berubah menjadi ${baris.sumber}`);
    cek(baris.sumber_ref === null, 'sumber_ref berubah');
    const hasilTerbit = nilai(await rpc('petugas', 'umkm_putuskan_profil',
      '$1::uuid,$2::integer,$3::uuid,$4::text,NULL::text', [p.id, simpan.versi, randomUUID(), 'terbit']), 'terbit');
    cek(hasilTerbit.status === 'terbit', 'profil tidak terbit');
    const m = (await sql('SELECT status FROM umkm_pemilik WHERE profil_id=$1::uuid AND akun_uid=$2::uuid',
      [p.id, akun.mandiri2]))[0];
    cek(m.status === 'disetujui', `pendaftar tidak disetujui: ${m.status}`);
  });
} catch (e) {
  fail++; console.log(`FAIL inisialisasi: ${e.message}`);
} finally {
  if (db) await db.close();
}
console.log(`HASIL: ${pass} PASS, ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
