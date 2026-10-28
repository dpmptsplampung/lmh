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

console.log('penanganan (tahap FO rekan tidak terlihat oleh petugas layanan; Koordinator layanan hanya tahap layanannya; FO pencatat membaca semua tahap kunjungannya):');
const P = async (who) => { const s = await lihat(who, 'penanganan', 'id'); return s; };
const pid = (n) => `50000000-0000-0000-0000-00000000000${n}`;
// FO pencatat membaca seluruh tahap kunjungan yang ia daftarkan (202611010003).
const hp = {
  admin: [1, 2, 3, 4, 5, 6], fok: [1, 2, 3, 4, 5, 6],
  fo1: [1, 2, 5, 6], fo2: [3, 4, 5, 6], p1: [2, 5, 6], p2: [4], pk1: [2, 5, 6], p3: [5, 6], anon: [],
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
console.log('buku_tamu (SENGAJA tidak dibatasi antar-FO, keputusan pemilik; pencatat ditandai di UI):');
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

// ---- Ambil alih Koordinator: jalur berhasil + siapa yang melihat catatan ambil alih
console.log('koordinator_ambil_alih_tiket (jalur berhasil):');
const seedAA = await pg(`
  INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh) VALUES
    ('30000000-0000-0000-0000-000000000004','Warga Empat','walk_in', current_date,'dilayani','20000000-0000-0000-0000-000000000003');
  INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh, waktu_mulai_layan) VALUES
    ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001', current_date,3,'AA-003','dilayani','20000000-0000-0000-0000-000000000008', now());
  INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at) VALUES
    ('50000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000004',1,'layanan','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','walk_in','berjalan','20000000-0000-0000-0000-000000000008', now());`);
if (!seedAA.ok) { console.error('SEED AMBIL ALIH GAGAL:', seedAA.pesan); process.exit(2); }
for (const who of ['p1', 'p3', 'p2']) {
  const r = await sebagai(db, 'authenticated', U[who], 'SELECT public.koordinator_ambil_alih_tiket($1, $2)', [tid(4), 'uji ambil alih harness']);
  cek(`${who} (bukan Koordinator layanan itu) ditolak`, !r.ok, JSON.stringify(r));
}
const aa = await sebagai(db, 'authenticated', U.pk1, 'SELECT public.koordinator_ambil_alih_tiket($1, $2) AS j', [tid(4), 'uji ambil alih harness']);
cek('Petugas Koordinator layanan itu berhasil mengambil alih', aa.ok && aa.rows[0].j.ok === true && aa.rows[0].j.sudah_milik_anda === false, JSON.stringify(aa));
const pemilik = await pg("SELECT dilayani_oleh::text AS o, status FROM tiket_antrean WHERE id = '40000000-0000-0000-0000-000000000004'");
cek('pemilik tiket pindah ke PK1, status tetap dilayani', pemilik.ok && pemilik.rows[0].o.endsWith('7') && pemilik.rows[0].status === 'dilayani', JSON.stringify(pemilik));
const tahap = await pg("SELECT status, batal_karena FROM penanganan WHERE id = '50000000-0000-0000-0000-000000000007'");
cek('tahap lama P3 dibatalkan (diambil_alih)', tahap.ok && tahap.rows[0].status === 'batal' && tahap.rows[0].batal_karena === 'diambil_alih', JSON.stringify(tahap));
const jejakAA = await pg("SELECT count(*)::int AS n FROM audit_log WHERE aksi = 'koordinator_ambil_alih'");
cek('audit_log mencatat satu ambil alih', jejakAA.ok && jejakAA.rows[0].n === 1, JSON.stringify(jejakAA));
const aaIds = { admin: 1, pk1: 1, p3: 1, p1: 0, p2: 0, fo1: 0, anon: 0 };
for (const [who, n] of Object.entries(aaIds)) {
  const x = await lihat(who, 'ambil_alih_pendataan');
  cek(`ambil_alih_pendataan terlihat oleh ${who}: ${n}`, x.size === n, 'dapat: ' + x.size);
}

// ---- Chat luar jam: email ke petugas berdedup per percakapan + hari buka berikutnya
console.log('chat_minta_petugas (luar jam; layanan tanpa jadwal = tutup):');
const seedMinta = await pg(`
  UPDATE layanan SET punya_chat = true WHERE id IN ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
  UPDATE petugas SET email_notifikasi = 'p1@x.id', email_notifikasi_verified_at = now() WHERE id = '20000000-0000-0000-0000-000000000005';
  UPDATE petugas SET email_notifikasi = 'p3@x.id', email_notifikasi_verified_at = now() WHERE id = '20000000-0000-0000-0000-000000000008';
  UPDATE petugas SET email_notifikasi = 'pk1@x.id' WHERE id = '20000000-0000-0000-0000-000000000007'; -- tidak terverifikasi
  UPDATE petugas SET email_notifikasi = 'fo1@x.id', email_notifikasi_verified_at = now() WHERE id = '20000000-0000-0000-0000-000000000002';
  SET session_replication_role = replica;
  INSERT INTO chat_sesi(id, pengunjung_id, layanan_id, status) VALUES
    ('70000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bot'),
    ('70000000-0000-0000-0000-000000000006','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bot'),
    ('70000000-0000-0000-0000-000000000007','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','bot'),
    ('70000000-0000-0000-0000-000000000008','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','bot');
  INSERT INTO chat_pesan(sesi_id, pengirim, isi) SELECT id, 'pengunjung', 'tolong petugas' FROM chat_sesi WHERE id::text > '70000000-0000-0000-0000-000000000004' AND id::text <> '70000000-0000-0000-0000-000000000008';
  SET session_replication_role = origin;`);
if (!seedMinta.ok) { console.error('SEED MINTA GAGAL:', seedMinta.pesan); process.exit(2); }
const stat = await sebagai(db, 'authenticated', U.v1, "SELECT public.chat_layanan_status('10000000-0000-0000-0000-000000000001') AS j");
cek('layanan tanpa jadwal terbaca TUTUP', stat.ok && stat.rows[0].j.buka === false, JSON.stringify(stat));
const minta = (who, sesi, eks = true, jwt) => sebagai(db, 'authenticated', U[who], 'SELECT public.chat_minta_petugas($1, $2) AS j', [sid(sesi), eks], jwt);
const m1 = await minta('v1', 5);
cek('permintaan pertama: eskalasi + 2 penerima (petugas L1 ber-email terverifikasi; PK1 tak terverifikasi dan FO dilewati)',
  m1.ok && m1.rows[0].j.status === 'eskalasi' && m1.rows[0].j.penerima === 2, JSON.stringify(m1));
const email1 = await pg("SELECT tujuan_email FROM notifikasi WHERE payload->>'type' = 'chat_minta_petugas' ORDER BY tujuan_email");
cek('email hanya ke p1 dan p3', email1.ok && email1.rows.map((r) => r.tujuan_email).join() === 'p1@x.id,p3@x.id', JSON.stringify(email1));
const m1b = await minta('v1', 5);
cek('permintaan ulang pada sesi sama: noop, tanpa email baru', m1b.ok && m1b.rows[0].j.noop === true && m1b.rows[0].j.penerima === 0, JSON.stringify(m1b));
const m2 = await minta('v1', 6);
cek('sesi baru pada percakapan yang sama (pengunjung+layanan, hari buka sama): tidak ada email ganda', m2.ok && m2.rows[0].j.penerima === 0, JSON.stringify(m2));
const n1 = await pg("SELECT count(*)::int AS n FROM notifikasi WHERE payload->>'type' = 'chat_minta_petugas'");
cek('total email chat tetap 2', n1.ok && n1.rows[0].n === 2, JSON.stringify(n1));
const m3 = await minta('v2', 7);
cek('layanan tanpa petugas ber-email terverifikasi: cadangan ke FO ber-email terverifikasi (1 penerima)', m3.ok && m3.rows[0].j.penerima === 1, JSON.stringify(m3));
const em3 = await pg("SELECT tujuan_email FROM notifikasi WHERE payload->>'layanan_id' = '10000000-0000-0000-0000-000000000002'");
cek('email cadangan ke fo1', em3.ok && em3.rows.length === 1 && em3.rows[0].tujuan_email === 'fo1@x.id', JSON.stringify(em3));
const mAnon = await minta('v1', 8, true, { is_anonymous: true });
cek('JWT anonim ditolak (tidak memicu email)', !mAnon.ok && mAnon.kode === '42501', JSON.stringify(mAnon));
const mLain = await minta('v2', 5);
cek('pengunjung lain tidak bisa meminta atas sesi orang lain', !mLain.ok && mLain.kode === '42501', JSON.stringify(mLain));
const mKosong = await minta('v1', 8);
cek('sesi tanpa pesan pengunjung: PESAN_WAJIB (anti-banjir)', !mKosong.ok && /PESAN_WAJIB/.test(mKosong.pesan), JSON.stringify(mKosong));
const mStaf = await sebagai(db, 'authenticated', U.p1, 'SELECT public.chat_minta_petugas($1, true)', [sid(5)]);
cek('staf (bukan pemilik sesi) ditolak', !mStaf.ok && mStaf.kode === '42501', JSON.stringify(mStaf));

// ---- Pendataan Khusus (Fase 4): jawaban per tahap, RLS = lingkup data ketat
console.log('pendataan_khusus_jawaban / pendataan_khusus_field:');
const seedPK = await pg(`
  INSERT INTO pendataan_khusus_field(id, layanan_id, label, jenis) VALUES
    ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Nomor izin','teks_singkat'),
    ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Nomor izin','teks_singkat');
  INSERT INTO pendataan_khusus_jawaban(penanganan_id, field_id, nilai, label_snapshot, jenis_snapshot) VALUES
    ('50000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001','"IZ-1"','Nomor izin','teks_singkat'),
    ('50000000-0000-0000-0000-000000000004','80000000-0000-0000-0000-000000000002','"IZ-2"','Nomor izin','teks_singkat');`);
if (!seedPK.ok) { console.error('SEED PK GAGAL:', seedPK.pesan); process.exit(2); }
// fo1/fo2: FO pencatat membaca jawaban tahap layanan kunjungannya (202611010003).
const pkExp = { admin: 2, fok: 2, fo1: 1, fo2: 1, p1: 1, p2: 1, pk1: 1, p3: 0, v1: 0, anon: 0 };
for (const [who, n] of Object.entries(pkExp)) {
  const x = await lihat(who, 'pendataan_khusus_jawaban');
  cek(`jawaban Pendataan Khusus terlihat oleh ${who}: ${n}`, x.size === n, 'dapat: ' + x.size);
}
// FO Koordinator: lingkup data FO-Koordinator = semua tahap (boleh_data_pelayanan), jadi 2.
const fokPK = await lihat('fok', 'pendataan_khusus_jawaban');
cek('FO Koordinator melihat semua jawaban (lingkup Koordinator FO)', fokPK.size === 2, 'dapat: ' + fokPK.size);
const tulisPK = await sebagai(db, 'authenticated', U.p1, "INSERT INTO pendataan_khusus_jawaban(penanganan_id, field_id, nilai, label_snapshot, jenis_snapshot) VALUES ('50000000-0000-0000-0000-000000000006','80000000-0000-0000-0000-000000000001','\"x\"','x','teks_singkat')");
cek('petugas tidak bisa menulis jawaban langsung (hanya fungsi definer)', !tulisPK.ok, JSON.stringify(tulisPK));
const tulisField = await sebagai(db, 'authenticated', U.pk1, "INSERT INTO pendataan_khusus_field(layanan_id, label, jenis) VALUES ('10000000-0000-0000-0000-000000000001','Bocor','teks_singkat')");
cek('Petugas Koordinator tidak bisa menambah isian (hanya admin)', !tulisField.ok || tulisField.rows.length === 0, JSON.stringify(tulisField));
const tulisFieldAdmin = await sebagai(db, 'authenticated', U.admin, "INSERT INTO pendataan_khusus_field(layanan_id, label, jenis) VALUES ('10000000-0000-0000-0000-000000000001','Baru','teks_singkat')");
cek('admin bisa menambah isian', tulisFieldAdmin.ok, JSON.stringify(tulisFieldAdmin));

// ---- 202611010005: Data Pelayanan "layanan lain" (p_tanpa_form mengecualikan Layanan berformulir; hanya mempersempit)
console.log('rekap_data_pelayanan p_tanpa_form (Helpdesk OSS / Non OSS punya tab sendiri):');
const L1 = '10000000-0000-0000-0000-000000000001';
const L2 = '10000000-0000-0000-0000-000000000002';
const setForm = await pg(`UPDATE layanan SET form_pendataan = 'oss' WHERE id = '${L1}'`);
cek('L1 dijadikan Layanan berformulir OSS (setup)', setForm.ok, JSON.stringify(setForm));
const dataRekap = (who, tanpa, unit = null, layanan = null) => sebagai(db, 'authenticated', U[who],
  'SELECT public.rekap_data_pelayanan(current_date - 30, current_date, $1, $2, 50, 0, NULL, true, $3) AS j', [unit, layanan, tanpa]);
const ringkasRekap = (r) => ({ total: Number(r.rows[0].j.total), unit: r.rows[0].j.rows.map((x) => `${x.unit}:${x.layanan_id ?? '-'}`) });
const semuaAdmin = await dataRekap('admin', false);
const tanpaAdmin = await dataRekap('admin', true);
const l1Admin = await dataRekap('admin', false, 'layanan', L1);
const a = ringkasRekap(semuaAdmin), b = ringkasRekap(tanpaAdmin), c = ringkasRekap(l1Admin);
cek('default (false) = semua baris seperti sebelumnya', semuaAdmin.ok && a.total === 5, JSON.stringify(a));
cek('p_tanpa_form: baris unit Layanan milik L1 (berformulir) hilang dari total', tanpaAdmin.ok && b.total === a.total - c.total && c.total >= 1, JSON.stringify({ a, b, c }));
cek('p_tanpa_form: tidak ada baris L1 di halaman, baris L2 dan Front Office tetap', tanpaAdmin.ok && !b.unit.some((x) => x === `layanan:${L1}`) && b.unit.includes(`layanan:${L2}`) && b.unit.some((x) => x.startsWith('fo:')), JSON.stringify(b));
const eksplisit = await dataRekap('admin', true, 'layanan', L1);
cek('p_tanpa_form + layanan_id berformulir = kosong (tab umum tidak membocorkan OSS)', eksplisit.ok && ringkasRekap(eksplisit).total === 0, JSON.stringify(eksplisit));
const tanpaNull = await sebagai(db, 'authenticated', U.admin,
  'SELECT public.rekap_data_pelayanan(current_date - 30, current_date, NULL, NULL, 50, 0, NULL, true, NULL) AS j');
cek('p_tanpa_form NULL diperlakukan FALSE', tanpaNull.ok && Number(tanpaNull.rows[0].j.total) === a.total, JSON.stringify(tanpaNull));
const delapan = await sebagai(db, 'authenticated', U.admin,
  'SELECT public.rekap_data_pelayanan(p_dari => current_date - 30, p_sampai => current_date, p_hitung => true) AS j');
cek('panggilan 8 argumen bernama (gaya PostgREST lama) tetap jalan lewat DEFAULT', delapan.ok && Number(delapan.rows[0].j.total) === a.total, JSON.stringify(delapan));
const halaman1 = await sebagai(db, 'authenticated', U.admin,
  'SELECT public.rekap_data_pelayanan(current_date - 30, current_date, NULL, NULL, 1, 0, NULL, false, true) AS j');
const berikut = halaman1.ok ? halaman1.rows[0].j.berikut : null;
const halaman2 = berikut ? await sebagai(db, 'authenticated', U.admin,
  'SELECT public.rekap_data_pelayanan(current_date - 30, current_date, NULL, NULL, 1000, 0, $1::jsonb, false, true) AS j', [JSON.stringify(berikut)]) : null;
cek('paging keyset ikut tersaring: halaman kedua tidak memuat baris L1', !!halaman2 && halaman2.ok
  && !halaman2.rows[0].j.rows.some((x) => x.layanan_id === L1 && x.unit === 'layanan'), JSON.stringify(halaman2));
// Lingkup tidak melebar: setiap orang hanya melihat subhimpunan dari yang dilihatnya tanpa filter.
for (const who of ['fo1', 'fo2', 'p1', 'p2', 'pk1', 'p3']) {
  const sem = await dataRekap(who, false), tan = await dataRekap(who, true);
  const s1 = sem.ok ? ringkasRekap(sem) : null, t1 = tan.ok ? ringkasRekap(tan) : null;
  cek(`lingkup ${who} tidak melebar (tanpa_form <= default)`, !!s1 && !!t1 && t1.total <= s1.total, JSON.stringify({ s1, t1 }));
}
const p1Tanpa = ringkasRekap(await dataRekap('p1', true));
cek('Petugas L1 (berformulir) dengan p_tanpa_form: tidak ada baris tersisa', p1Tanpa.total === 0, JSON.stringify(p1Tanpa));
const p2Tanpa = ringkasRekap(await dataRekap('p2', true));
cek('Petugas L2 (tanpa formulir) dengan p_tanpa_form: barisnya tetap', p2Tanpa.total === 1, JSON.stringify(p2Tanpa));
const anonRekap = await sebagai(db, 'anon', null,
  'SELECT public.rekap_data_pelayanan(current_date - 30, current_date, NULL, NULL, 50, 0, NULL, true, true) AS j');
cek('anon tetap ditolak', !anonRekap.ok, JSON.stringify(anonRekap));

ringkas();
await db.close();
