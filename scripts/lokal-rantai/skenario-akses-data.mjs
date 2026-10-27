// Skenario perilaku RLS Fase 3 (akses data per orang/Koordinator) pada skema ASLI (seluruh rantai migrasi).
// Jalankan: node scripts/lokal-rantai/skenario-akses-data.mjs  (PGlite; tanpa jaringan; tidak masuk `npm test`)
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

const U = Object.fromEntries(
  ['admin', 'fo1', 'fo2', 'fok', 'p1', 'p2', 'pk1', 'p3', 'v1', 'v2', 'anon'].map((n, i) => [n, `00000000-0000-0000-0000-0000000000${String(i + 1).padStart(2, '0')}`]),
);
const db = await bukaDbPenuh();
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);

const seed = await pg(`
  INSERT INTO auth.users(id, email) SELECT x::uuid, 'u' || right(x, 1) || '@x.id' FROM unnest(ARRAY[
    '${U.admin}','${U.fo1}','${U.fo2}','${U.fok}','${U.p1}','${U.p2}','${U.pk1}','${U.p3}','${U.v1}','${U.v2}']) x;
  INSERT INTO layanan(id, nama, prefiks_antrean, slug) VALUES
    ('10000000-0000-0000-0000-000000000001','L1','AA','l1'),('10000000-0000-0000-0000-000000000002','L2','BB','l2');
  INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif, koordinator) VALUES
    ('20000000-0000-0000-0000-000000000001','${U.admin}','Admin','admin',NULL,true,false),
    ('20000000-0000-0000-0000-000000000002','${U.fo1}','FO1','front_office',NULL,true,false),
    ('20000000-0000-0000-0000-000000000003','${U.fo2}','FO2','front_office',NULL,true,false),
    ('20000000-0000-0000-0000-000000000004','${U.fok}','FOK','front_office',NULL,true,true),
    ('20000000-0000-0000-0000-000000000005','${U.p1}','P1','petugas','10000000-0000-0000-0000-000000000001',true,false),
    ('20000000-0000-0000-0000-000000000006','${U.p2}','P2','petugas','10000000-0000-0000-0000-000000000002',true,false),
    ('20000000-0000-0000-0000-000000000007','${U.pk1}','PK1','petugas','10000000-0000-0000-0000-000000000001',true,true),
    ('20000000-0000-0000-0000-000000000008','${U.p3}','P3','petugas','10000000-0000-0000-0000-000000000001',true,false);
  INSERT INTO pengunjung(id, auth_user_id, nama) VALUES
    ('60000000-0000-0000-0000-000000000001','${U.v1}','V1'),('60000000-0000-0000-0000-000000000002','${U.v2}','V2');
  -- Kc1: selesai 10 hari lalu, FO1 + P1 (L1). Kc2: idem, FO2 + P2 (L2). Ko: terbuka hari ini, dibuat FO2, antre di L1.
  INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh) VALUES
    ('30000000-0000-0000-0000-000000000001','Warga Satu','walk_in', current_date - 10,'selesai','20000000-0000-0000-0000-000000000002'),
    ('30000000-0000-0000-0000-000000000002','Warga Dua','walk_in', current_date - 10,'selesai','20000000-0000-0000-0000-000000000003'),
    ('30000000-0000-0000-0000-000000000003','Warga Tiga','walk_in', current_date,'menunggu','20000000-0000-0000-0000-000000000003');
  INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh) VALUES
    ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', current_date - 10,1,'AA-001','selesai','20000000-0000-0000-0000-000000000005'),
    ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002', current_date - 10,1,'BB-001','selesai','20000000-0000-0000-0000-000000000006'),
    ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001', current_date,1,'AA-002','menunggu',NULL);
  INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at, selesai_at, hasil, catatan, topik) VALUES
    ('50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fo',NULL,NULL,'walk_in','selesai','20000000-0000-0000-0000-000000000002', now()-interval '10 days', now()-interval '10 days','dieskalasi','catatan','topik'),
    ('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'layanan','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','walk_in','selesai','20000000-0000-0000-0000-000000000005', now()-interval '10 days', now()-interval '10 days','selesai','catatan','topik'),
    ('50000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002',1,'fo',NULL,NULL,'walk_in','selesai','20000000-0000-0000-0000-000000000003', now()-interval '10 days', now()-interval '10 days','dieskalasi','catatan','topik'),
    ('50000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000002',2,'layanan','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','walk_in','selesai','20000000-0000-0000-0000-000000000006', now()-interval '10 days', now()-interval '10 days','selesai','catatan','topik'),
    ('50000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000003',1,'fo',NULL,NULL,'walk_in','selesai','20000000-0000-0000-0000-000000000003', now(), now(),'dieskalasi','catatan','topik'),
    ('50000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000003',2,'layanan','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','walk_in','menunggu',NULL,NULL,NULL,NULL,NULL,NULL);
`);
await pg("UPDATE kunjungan SET asal_instansi = 'CV Maju', kontak_hp = '081234567890' WHERE id = '30000000-0000-0000-0000-000000000001'");
if (!seed.ok) { console.error('SEED GAGAL:', seed.pesan); process.exit(2); }

const K = (n) => `30000000-0000-0000-0000-00000000000${n}`;
async function lihat(who, tabel, kolom = 'id') {
  const r = await sebagai(db, who === 'anon' ? 'anon' : 'authenticated', who === 'anon' ? null : U[who], `SELECT ${kolom}::text AS k FROM public.${tabel}`);
  if (!r.ok && r.kode === '42501') return new Set(); // hak tabel ditolak = tidak melihat apa pun
  return r.ok ? new Set(r.rows.map((x) => x.k)) : new Set(['!ERR:' + r.pesan]);
}
const sama = (s, arr) => s.size === arr.length && arr.every((x) => s.has(x));
const ur = (s) => [...s].map((x) => x.slice(-1)).sort().join(',') || '-';

console.log('kunjungan (Kc1=1 FO1+L1 selesai lama, Kc2=2 FO2+L2 selesai lama, Ko=3 terbuka hari ini, L1):');
const harap = {
  admin: [1, 2, 3], fok: [1, 2, 3], fo1: [1, 3], fo2: [2, 3], p1: [1, 3], p2: [2], pk1: [1, 3], p3: [3], anon: [],
};
for (const [who, ids] of Object.entries(harap)) {
  const s = await lihat(who, 'kunjungan');
  cek(`kunjungan terlihat oleh ${who}: [${ids.join(',')}]`, sama(s, ids.map(K)), 'dapat: ' + ur(s));
}

console.log('penanganan (tahap FO milik rekan yang sudah tutup tidak terlihat oleh petugas layanan; Koordinator layanan hanya tahap layanannya):');
const P = async (who) => { const s = await lihat(who, 'penanganan', 'id'); return s; };
const pid = (n) => `50000000-0000-0000-0000-00000000000${n}`;
const hp = {
  admin: [1, 2, 3, 4, 5, 6], fok: [1, 2, 3, 4, 5, 6],
  fo1: [1, 5, 6], fo2: [3, 5, 6], p1: [2, 5, 6], p2: [4], pk1: [2, 5, 6], p3: [5, 6], anon: [],
};
for (const [who, ids] of Object.entries(hp)) {
  const s = await P(who);
  cek(`penanganan terlihat oleh ${who}: [${ids.join(',')}]`, sama(s, ids.map(pid)), 'dapat: ' + ur(s));
}
// ---- tiket_antrean: hanya tiket dalam lingkup (celah lama: tiket_staff_select tanpa TO membuka semua tiket ke FO / satu layanan)
console.log('tiket_antrean:');
const tid = (n) => `40000000-0000-0000-0000-00000000000${n}`;
const ht = { admin: [1, 2, 3], fok: [1, 2, 3], fo1: [1, 3], fo2: [2, 3], p1: [1, 3], p2: [2], pk1: [1, 3], p3: [3], anon: [] };
for (const [who, ids] of Object.entries(ht)) {
  const s = await lihat(who, 'tiket_antrean');
  cek(`tiket terlihat oleh ${who}: [${ids.join(',')}]`, sama(s, ids.map(tid)), 'dapat: ' + ur(s));
}

// ---- buku_tamu: FO biasa hanya buku tamu yang ia catat atau yang terbuka; Koordinator/admin semua
console.log('buku_tamu (perilaku SAAT INI; keputusan pemilik terbuka, lihat docs/SERAH-TERIMA-LAYANAN-DINAMIS.md bagian C):');
const bt = await pg("INSERT INTO buku_tamu(nama, menemui_siapa) VALUES ('Tamu Satu', 'Kabid') RETURNING id");
cek('seed buku_tamu', bt.ok, JSON.stringify(bt));
cek('FO membaca buku tamu bersama (perilaku buku tamu = meja FO bersama)', (await lihat('fo1', 'buku_tamu')).size === 1);
cek('petugas layanan TIDAK membaca buku tamu', (await lihat('p1', 'buku_tamu')).size === 0);
cek('pengunjung/anon TIDAK membaca buku tamu', (await lihat('v1', 'buku_tamu')).size === 0 && (await lihat('anon', 'buku_tamu')).size === 0);

// ---- chat_sesi
console.log('chat_sesi (S1 L1 selesai v1/p1, S2 L1 selesai v2 tanpa penangan, S3 L1 eskalasi v1, S4 L2 selesai v2/p2):');
const seedChat = await pg(`
  SET session_replication_role = replica; -- seed langsung: trigger penjaga chat_sesi hanya memperbolehkan lewat RPC
  INSERT INTO chat_sesi(id, pengunjung_id, layanan_id, status, ditangani_oleh) VALUES
    ('70000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','selesai','20000000-0000-0000-0000-000000000005'),
    ('70000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','selesai',NULL),
    ('70000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','eskalasi',NULL),
    ('70000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','selesai','20000000-0000-0000-0000-000000000006');
  INSERT INTO chat_pesan(sesi_id, pengirim, isi)
    SELECT id, 'pengunjung', 'halo ' || right(id::text, 1) FROM chat_sesi;
  SET session_replication_role = origin;`);
if (!seedChat.ok) { console.error('SEED CHAT GAGAL:', seedChat.pesan); process.exit(2); }
const sid = (n) => `70000000-0000-0000-0000-00000000000${n}`;
const hc = { admin: [1, 2, 3, 4], fok: [1, 2, 3, 4], fo1: [3], fo2: [3], p1: [1, 3], p2: [4], pk1: [1, 2, 3], p3: [3], v1: [1, 3], v2: [2, 4], anon: [] };
for (const [who, ids] of Object.entries(hc)) {
  const s = await lihat(who, 'chat_sesi');
  cek(`chat_sesi terlihat oleh ${who}: [${ids.join(',')}]`, sama(s, ids.map(sid)), 'dapat: ' + ur(s));
  const pesan = await lihat(who, 'chat_pesan', 'sesi_id');
  cek(`chat_pesan (sesi) terlihat oleh ${who} sama dengan sesinya`, sama(pesan, ids.map(sid)), 'dapat: ' + ur(pesan));
}

// ---- pencarian pengunjung lama (Fase 6)
console.log('fo_cari_pengunjung / fo_ambil_pengunjung:');
const cari = (who, q) => sebagai(db, 'authenticated', U[who], 'SELECT * FROM public.fo_cari_pengunjung($1)', [q]);
const fo1c = await cari('fo1', 'Warga Sat');
cek('FO mendapat 1 hasil untuk "Warga Sat"', fo1c.ok && fo1c.rows.length === 1, JSON.stringify(fo1c));
cek('HP tersamar, bukan nomor penuh', fo1c.ok && fo1c.rows[0]?.hp_samar?.includes('****') && !JSON.stringify(fo1c.rows).includes('1234567890'), JSON.stringify(fo1c.rows));
const pendek = await cari('fo1', 'Wa');
cek('kueri < 3 karakter: kosong', pendek.ok && pendek.rows.length === 0, JSON.stringify(pendek));
for (const who of ['p1', 'pk1', 'v1']) {
  const r = await cari(who, 'Warga');
  cek(`${who} (bukan FO/admin) ditolak 42501`, !r.ok && r.kode === '42501', JSON.stringify(r));
}
const anonCari = await sebagai(db, 'anon', null, "SELECT * FROM public.fo_cari_pengunjung('Warga')");
cek('anon ditolak', !anonCari.ok, JSON.stringify(anonCari));
const ambil = await sebagai(db, 'authenticated', U.fo1, 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(1)]);
cek('FO mengambil identitas penuh (HP asli)', ambil.ok && ambil.rows[0]?.kontak_hp === '081234567890', JSON.stringify(ambil));
const jejak = await pg("SELECT count(*)::int AS n FROM public.audit_log WHERE aksi = 'fo_ambil_pengunjung'");
cek('pengambilan identitas tercatat di audit_log', jejak.ok && jejak.rows[0].n === 1, JSON.stringify(jejak));
const ambilP = await sebagai(db, 'authenticated', U.p1, 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(1)]);
cek('petugas biasa tidak boleh mengambil identitas', !ambilP.ok && ambilP.kode === '42501', JSON.stringify(ambilP));

// ---- Rekap terpadu: lingkup ketat per orang (rekap_pelayanan_inti)
console.log('rekap_harian_terpadu (jumlah pelayanan dilayani dalam lingkup):');
const rekap = async (who) => {
  const r = await sebagai(db, who === 'anon' ? 'anon' : 'authenticated', who === 'anon' ? null : U[who],
    'SELECT public.rekap_harian_terpadu(current_date - 30, current_date, NULL, NULL) AS j');
  return r;
};
const hr = { admin: 5, fok: 5, fo1: 1, fo2: 2, p1: 1, p2: 1, pk1: 1, p3: 0 };
for (const [who, n] of Object.entries(hr)) {
  const r = await rekap(who);
  cek(`rekap ${who}: ${n}`, r.ok && r.rows[0].j.ringkasan.jumlah === n, JSON.stringify(r).slice(0, 200));
}
const rekapAnon = await rekap('anon');
cek('rekap anon ditolak', !rekapAnon.ok, JSON.stringify(rekapAnon));

// ---- Ambil alih (Koordinator): hanya Koordinator yang berwenang
console.log('koordinator_ambil_alih_tiket:');
for (const who of ['p1', 'p3', 'fo1']) {
  const r = await sebagai(db, 'authenticated', U[who], 'SELECT public.koordinator_ambil_alih_tiket($1, $2)', [tid(3), 'uji ambil alih harness']);
  cek(`${who} (bukan Koordinator layanan) tidak boleh mengambil alih`, !r.ok, JSON.stringify(r));
}

ringkas();
await db.close();
