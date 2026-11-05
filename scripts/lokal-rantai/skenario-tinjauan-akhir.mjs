// Skenario penyerang tinjauan akhir (migrasi 202611040001) pada seluruh rantai migrasi di PGlite lokal.
// Sumber skenario: .tim/tinjauan-akhir/KEAMANAN.md (P1-1, P1-2, P2-1, P2-2, P2-3, P2-7), QA-AKSES-FO.md (P1, P2 x2),
// dan CODEX-REVIEW.md (P2-1 identitas pelapor, P2-3 penghitung laju saran bersama).
// Tanpa jaringan, .env, atau database eksternal. Jalankan: node scripts/lokal-rantai/skenario-tinjauan-akhir.mjs
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh();
const id = (grup, n) => `${grup}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = Object.fromEntries(['admin', 'fo1', 'fo2', 'fok', 'p1', 'warga'].map((r, i) => [r, id(0, i + 1)]));
const staf = Object.fromEntries(Object.keys(U).map((r, i) => [r, id(2, i + 1)]));
const L = (n) => id(1, n);
const K = (n) => id(3, n);
const T = (n) => id(4, n);
const P = (n) => id(5, n);
const G = (n) => id(6, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (role, sql, params) => sebagai(db, 'authenticated', U[role], sql, params);
const wajib = (r) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = (r) => wajib(r).rows[0]?.hasil;
const ditolak = (r, kode, awalan) => !r.ok && r.kode === kode && (!awalan || r.pesan.startsWith(awalan));
const MIGRASI = readFileSync(new URL('../../supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql', import.meta.url), 'utf8');
const ROLLBACK = readFileSync(new URL('../../docs/rollback-perbaikan-tinjauan-akhir-202611040001.sql', import.meta.url), 'utf8');

try {
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id, email) VALUES ${Object.entries(U).map(([r, v]) => `('${v}', '${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id, nama, prefiks_antrean, slug, form_pendataan) VALUES
      ('${L(1)}','Layanan Satu','AA','uji-tinjauan-1','oss'), ('${L(2)}','Layanan Dua','BB','uji-tinjauan-2',NULL);
    INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif, koordinator) VALUES
      ('${staf.admin}','${U.admin}','admin','admin',NULL,true,false),
      ('${staf.fo1}','${U.fo1}','fo1','front_office',NULL,true,false),
      ('${staf.fo2}','${U.fo2}','fo2','front_office',NULL,true,false),
      ('${staf.fok}','${U.fok}','fok','front_office',NULL,true,true),
      ('${staf.p1}','${U.p1}','p1','petugas','${L(1)}',true,false);
    INSERT INTO kunjungan(id, nama, asal, asal_instansi, tanggal, status, dibuat_oleh, kontak_hp, email, waktu_masuk) VALUES
      ('${K(1)}','Warga Satu','walk_in','Instansi A',current_date,'selesai','${staf.fo1}','081200000001','satu@example.invalid',now()-interval '5 hours'),
      ('${K(2)}','Warga Dua','walk_in','Instansi B',current_date,'menunggu','${staf.fo2}','081200000002','dua@example.invalid',now()-interval '4 hours'),
      ('${K(3)}','Warga Tiga','walk_in','Instansi C',current_date,'dilayani','${staf.fo2}','081200000003','tiga@example.invalid',now()-interval '3 hours'),
      ('${K(4)}','Persen_Empat','walk_in','Instansi D',current_date,'selesai','${staf.fo2}','081200000004','empat@example.invalid',now()-interval '2 hours'),
      ('${K(7)}','Warga Lama','walk_in','Instansi Lama',current_date-30,'selesai','${staf.fo2}','081200000007','lama@example.invalid',now()-interval '30 days'),
      ('${K(8)}','Warga Kemarin Lusa','walk_in','Instansi E',current_date-3,'selesai','${staf.fo2}','081200000008','tiga.hari@example.invalid',now()-interval '3 days'),
      ('${K(9)}','Warga Dialihkan','walk_in','Instansi F',current_date,'selesai','${staf.fo2}','081200000009','alih@example.invalid',now()-interval '1 hours');
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh, waktu_mulai_layan, waktu_selesai) VALUES
      ('${T(1)}','${K(1)}','${L(1)}',current_date,1,'AA-001','selesai','${staf.p1}',now()-interval '10 minutes',now()),
      ('${T(2)}','${K(2)}','${L(2)}',current_date,1,'BB-001','menunggu',NULL,NULL,NULL),
      ('${T(3)}','${K(3)}','${L(1)}',current_date,2,'AA-002','selesai','${staf.fo1}',now()-interval '15 minutes',now()),
      ('${T(4)}','${K(4)}','${L(1)}',current_date,3,'AA-003','selesai',NULL,now()-interval '15 minutes',now()),
      ('${T(5)}','${K(4)}','${L(2)}',current_date,2,'BB-002','selesai','${staf.fo1}',now()-interval '15 minutes',now());
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at, selesai_at, hasil, topik, catatan) VALUES
      ('${P(1)}','${K(1)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo1}',now()-interval '1 hour',now(),'dieskalasi','Topik','catatan uji'),
      ('${P(2)}','${K(1)}',2,'layanan','${L(1)}','${T(1)}','walk_in','selesai','${staf.p1}',now()-interval '10 minutes',now(),'selesai','Topik','catatan uji'),
      ('${P(3)}','${K(2)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo2}',now()-interval '1 hour',now(),'dieskalasi','Topik','catatan uji'),
      ('${P(4)}','${K(9)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo1}',now()-interval '1 hour',now(),'selesai','Topik','catatan uji'),
      -- fo1 dulu Petugas Layanan Satu: tahap layanan lama atas namanya (perubahan peran).
      ('${P(5)}','${K(4)}',1,'layanan','${L(2)}','${T(5)}','walk_in','selesai','${staf.fo1}',now()-interval '1 hour',now(),'selesai','Topik','catatan uji');
    INSERT INTO pengaduan(id, nomor_tiket, jalur, layanan_id, isi, status, batas_verifikasi, batas_penanganan, penangan_id, penangan_sejak, lampiran_path, pelapor_nama, pelapor_email, kontak) VALUES
      ('${G(1)}','PGD-UJI-1','layanan','${L(1)}','isi pengaduan satu cukup panjang','diverifikasi',current_date+1,current_date+5,'${staf.fo1}',now(),'abc/bukti.pdf','Pelapor Asli','pelapor.asli@example.invalid','081299990001'),
      ('${G(2)}','PGD-UJI-2','layanan','${L(1)}','isi pengaduan dua cukup panjang','baru',current_date+1,current_date+5,NULL,NULL,NULL,NULL,NULL,NULL),
      ('${G(3)}','PGD-UJI-3','layanan','${L(2)}','isi pengaduan tiga cukup panjang','baru',current_date+1,current_date+5,NULL,NULL,NULL,NULL,NULL,NULL);
    UPDATE petugas SET operator_default = 'Operator Lama' WHERE id = '${staf.fo2}';
    SET session_replication_role = origin;
  `));
  const hari = nilai(await pg('SELECT current_date::text AS hasil'));
  // Jendela daftar dihitung dari tanggal WIB (bukan current_date sesi PGlite yang UTC).
  const geser = async (n) => nilai(await pg(`SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date + ${n})::text AS hasil`));

  console.log('\nP1-1: fo_ambil_pengunjung');
  const daftar = nilai(await user('fo1', 'SELECT public.fo_kunjungan_daftar($1::date) AS hasil', [hari]));
  const asing = daftar.rows.map((r) => r.id).filter((x) => ![K(1), K(3), K(4), K(9)].includes(x)); // sisanya milik FO2 tanpa keterlibatan FO1
  let bocor = 0;
  for (const k of asing) {
    const r = await user('fo1', 'SELECT email, kontak_hp FROM public.fo_ambil_pengunjung($1)', [k]);
    if (r.ok) bocor++;
  }
  cek(`serangan: ID dari daftar hari ini (${asing.length} kunjungan FO lain) tidak menghasilkan satu pun HP/email`, asing.length >= 1 && bocor === 0);
  cek('FO1 -> kunjungan FO2 hari ini: FORBIDDEN 42501', ditolak(await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(2)]), '42501', 'FORBIDDEN:'));
  cek('FO1 -> kunjungan FO2 3 hari lalu (dalam jendela 7 hari): FORBIDDEN', ditolak(await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(8)]), '42501', 'FORBIDDEN:'));
  const lama = await user('fo1', 'SELECT kontak_hp FROM public.fo_ambil_pengunjung($1)', [K(7)]);
  cek('FO1 -> pengunjung lama FO2 (30 hari lalu): pendaftaran ulang tetap jalan', lama.ok && lama.rows[0]?.kontak_hp === '081200000007');
  cek('FO1 -> kunjungan yang ia daftarkan: boleh', (await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(1)])).ok);
  cek('FO1 -> kunjungan FO2 yang tahapnya ia tangani: boleh', (await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(9)])).ok);
  cek('FO1 -> kunjungan FO2 yang tiketnya ia layani: boleh', (await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(3)])).ok);
  cek('FO Koordinator -> kunjungan FO2 hari ini: boleh', (await user('fok', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(2)])).ok);
  cek('Admin -> kunjungan FO2 hari ini: boleh', (await user('admin', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(2)])).ok);
  cek('Petugas tetap ditolak', ditolak(await user('p1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(1)]), '42501'));
  const audit = Number(nilai(await pg("SELECT count(*) AS hasil FROM audit_log WHERE aksi = 'fo_ambil_pengunjung' AND actor_id = $1", [U.fo1])));
  cek('pengambilan sah tetap diaudit (4 untuk FO1), penolakan tidak tercatat sebagai pengambilan', audit === 4);

  console.log('\nP1-2: kirim_saran_publik');
  cek('anon langsung ke RPC: ditolak 42501', ditolak(await sebagai(db, 'anon', null, "SELECT public.kirim_saran_publik('banjir saran palsu', NULL)"), '42501'));
  cek('pengguna login langsung ke RPC: ditolak 42501', ditolak(await user('warga', "SELECT public.kirim_saran_publik('banjir saran palsu', NULL)"), '42501'));
  cek('service role (route) tetap bisa menyimpan', nilai(await sebagai(db, 'service_role', null, "SELECT public.kirim_saran_publik('saran sah dari route', NULL) AS hasil")) === 'submitted');

  console.log('\nTinjauan ulang P2-3: catat_laju_publik (penghitung saran bersama)');
  const kunciIp = 'a'.repeat(64);
  const laju = (role, kunci = kunciIp, aksi = 'saran.publik') =>
    sebagai(db, role, role === 'authenticated' ? U.warga : null, 'SELECT public.catat_laju_publik($1, $2, 5, 600) AS hasil', [aksi, kunci]);
  cek('anon langsung: ditolak 42501', ditolak(await laju('anon'), '42501'));
  cek('pengguna login langsung: ditolak 42501', ditolak(await laju('authenticated'), '42501'));
  // Dua "instance" route = dua panggilan service_role terpisah ke satu DB: 3 + 2 diterima, keenam ditolak.
  const hasilLaju = [];
  for (let i = 0; i < 6; i++) hasilLaju.push(nilai(await laju('service_role')));
  cek('5 kiriman per IP per 10 menit diterima, keenam false (lintas instance karena satu penghitung DB)',
    JSON.stringify(hasilLaju) === JSON.stringify([true, true, true, true, true, false]), JSON.stringify(hasilLaju));
  cek('IP lain punya kuota sendiri', nilai(await laju('service_role', 'b'.repeat(64))) === true);
  cek('kiriman yang ditolak tidak dicatat (tabel tidak membengkak oleh banjir)',
    Number(nilai(await pg("SELECT count(*) AS hasil FROM anon_rate_limit WHERE action = $1", [`saran.publik:${kunciIp}`]))) === 5);
  cek('baris lama di luar jendela tidak dihitung', await (async () => {
    wajib(await pg("UPDATE anon_rate_limit SET created_at = now() - interval '11 minutes' WHERE action = $1", [`saran.publik:${kunciIp}`]));
    return nilai(await laju('service_role')) === true;
  })());
  cek('kunci bukan sha256 hex (IP mentah) ditolak MASUKAN_TIDAK_VALID', ditolak(await laju('service_role', '10.0.0.1'), '22023', 'MASUKAN_TIDAK_VALID:'));
  cek('aksi tidak sah ditolak MASUKAN_TIDAK_VALID', ditolak(await laju('service_role', kunciIp, 'X; drop'), '22023', 'MASUKAN_TIDAK_VALID:'));

  console.log('\nP2-1: pengaduan satu penangan');
  const ubah = (who, set, g = G(1)) => user(who, `UPDATE public.pengaduan SET ${set} WHERE id = '${g}' RETURNING id AS hasil`);
  cek('FO2 menggeser batas_penanganan pengaduan FO1: KOLOM_TERKUNCI', ditolak(await ubah('fo2', 'batas_penanganan = current_date + 365'), '42501', 'KOLOM_TERKUNCI:'));
  cek('FO2 menggeser batas_verifikasi: KOLOM_TERKUNCI', ditolak(await ubah('fo2', 'batas_verifikasi = current_date + 365'), '42501', 'KOLOM_TERKUNCI:'));
  cek('penangan sendiri pun tidak bisa menggeser SLA', ditolak(await ubah('fo1', 'batas_penanganan = current_date + 365'), '42501', 'KOLOM_TERKUNCI:'));
  cek('Admin tidak bisa mengubah isi lewat UPDATE langsung', ditolak(await ubah('admin', "isi = 'isi diganti admin'"), '42501', 'KOLOM_TERKUNCI:'));
  for (const set of [`layanan_id = '${L(2)}'`, "sumber = 'impor'", "nomor_tiket = 'PGD-PALSU'", "lampiran_path = 'lain/x.pdf'"]) {
    cek(`FO1 ${set.split(' ')[0]}: KOLOM_TERKUNCI`, ditolak(await ubah('fo1', set), '42501', 'KOLOM_TERKUNCI:'));
  }
  cek('FO2 menutup pengaduan milik FO1 tanpa ambil alih: BUKAN_PENANGAN', ditolak(await ubah('fo2', "status = 'selesai'"), '42501', 'BUKAN_PENANGAN:'));
  cek('FO1 (penangan) mengubah status: boleh', (await ubah('fo1', "status = 'diproses'")).rows.length === 1);
  cek('Admin mengubah status pengaduan ber-penangan: boleh', (await ubah('admin', "status = 'diproses', updated_at = now()")).rows.length === 1);
  cek('FO2 mengubah status pengaduan tanpa penangan: boleh dan menjadi penangan otomatis',
    (await ubah('fo2', "status = 'diverifikasi'", G(2))).rows.length === 1
    && nilai(await pg('SELECT penangan_id::text AS hasil FROM pengaduan WHERE id = $1', [G(2)])) === staf.fo2);
  const riwayat = (who, g, baru) => user(who, `INSERT INTO public.pengaduan_riwayat(pengaduan_id, status_lama, status_baru, catatan, diubah_oleh)
    VALUES ('${g}', 'baru', '${baru}', 'palsu', '${staf[who]}')`);
  cek('FO2 menyisipkan riwayat palsu (status_baru beda): RIWAYAT_TIDAK_SESUAI', ditolak(await riwayat('fo2', G(1), 'selesai'), '42501', 'RIWAYAT_TIDAK_SESUAI:'));
  cek('FO2 menyisipkan riwayat berstatus sama pada pengaduan FO1: BUKAN_PENANGAN', ditolak(await riwayat('fo2', G(1), 'diproses'), '42501', 'BUKAN_PENANGAN:'));
  cek('FO1 (penangan) mencatat riwayat yang sesuai status: boleh', (await riwayat('fo1', G(1), 'diproses')).ok);
  cek('tangani_pengaduan tetap jalan', nilai(await user('fo1', 'SELECT public.tangani_pengaduan($1) AS hasil', [G(3)])).berubah === true);
  const alih = await user('fo2', "SELECT public.ambil_alih_pengaduan($1, 'FO1 sedang cuti') AS hasil", [G(1)]);
  cek('ambil_alih_pengaduan tetap jalan (riwayat penangan via flag lolos)', alih.ok && alih.rows[0].hasil.berubah === true);
  cek('setelah ambil alih FO2 boleh mengubah status, FO1 tidak',
    (await ubah('fo2', "status = 'eskalasi'")).rows.length === 1 && ditolak(await ubah('fo1', "status = 'selesai'"), '42501', 'BUKAN_PENANGAN:'));
  // Tinjauan ulang P2-1: identitas dan rute balasan pelapor terkunci (FO1 kini bukan penangan G1).
  for (const set of ["pelapor_email = 'alamat-uji@example.invalid'", "pelapor_nama = 'Nama Diganti'", "kontak = '08000000000'"]) {
    cek(`FO1 bukan penangan ${set.split(' ')[0]}: KOLOM_TERKUNCI`, ditolak(await ubah('fo1', set), '42501', 'KOLOM_TERKUNCI:'));
  }
  cek('FO1 bukan penangan mengganti ketiganya sekaligus (skenario tinjauan): KOLOM_TERKUNCI',
    ditolak(await ubah('fo1', "pelapor_email = 'alamat-uji@example.invalid', pelapor_nama = 'Nama Diganti', kontak = '08000000000'"), '42501', 'KOLOM_TERKUNCI:'));
  cek('penangan (FO2) dan Admin juga tidak bisa mengganti email pelapor lewat UPDATE langsung',
    ditolak(await ubah('fo2', "pelapor_email = 'lain@example.invalid'"), '42501', 'KOLOM_TERKUNCI:')
    && ditolak(await ubah('admin', "pelapor_email = 'lain@example.invalid'"), '42501', 'KOLOM_TERKUNCI:'));
  cek('identitas pelapor G1 utuh setelah percobaan',
    nilai(await pg("SELECT pelapor_nama || '|' || pelapor_email || '|' || kontak AS hasil FROM pengaduan WHERE id = $1", [G(1)]))
      === 'Pelapor Asli|pelapor.asli@example.invalid|081299990001');
  const lampiranUuid = id(8, 1);
  const tanggapi = (who, status) => user(who, `SELECT public.tanggapi_pengaduan($1::uuid, 'tanggapan uji', ${status}, false,
    jsonb_build_array(jsonb_build_object('kunci', 'pengaduan-bukti/' || $1::text || '/${lampiranUuid}.pdf', 'nama', 'bukti.pdf', 'mime', 'application/pdf', 'ukuran', 100))) AS hasil`, [G(1)]);
  const tg1 = await tanggapi('fo1', "'selesai'");
  cek('tanggapi_pengaduan dengan perubahan status oleh bukan penangan: BUKAN_PENANGAN', ditolak(tg1, '42501', 'BUKAN_PENANGAN:'), JSON.stringify(tg1));
  const tg2 = await tanggapi('fo2', "'diproses'");
  cek('tanggapi_pengaduan oleh penangan + lampiran: boleh', tg2.ok, JSON.stringify(tg2));
  const tgEmail = await user('fo2', "SELECT public.tanggapi_pengaduan($1::uuid, 'tanggapan resmi uji', NULL, true, NULL) AS hasil", [G(1)]);
  const tujuan = wajib(await pg("SELECT tujuan_email FROM notifikasi WHERE payload ->> 'pengaduan_id' = $1 AND payload ->> 'type' = 'pengaduan_tanggapan'", [G(1)])).rows;
  cek('tanggapi_pengaduan kirim email oleh penangan: antrean ke alamat pelapor asli saja',
    tgEmail.ok && tujuan.length === 1 && tujuan[0].tujuan_email === 'pelapor.asli@example.invalid', JSON.stringify({ tgEmail, tujuan }));
  cek('koneksi tanpa JWT (cron/service role) tetap bisa memperbarui batas',
    (await sebagai(db, 'service_role', null, `UPDATE public.pengaduan SET batas_penanganan = batas_penanganan WHERE id = '${G(1)}'`)).ok);

  console.log('\nP2-2 + UI-04: linimasa dan daftar kerja');
  const lini = nilai(await user('fo2', 'SELECT public.linimasa_pengaduan($1) AS hasil', [G(1)]));
  const tg = lini.find((e) => e.jenis === 'tanggapan');
  const idLampiran = nilai(await pg('SELECT a.id::text AS hasil FROM pengaduan_lampiran a JOIN pengaduan_tanggapan t ON t.id = a.tanggapan_id WHERE t.pengaduan_id = $1', [G(1)]));
  cek('lampiran tanggapan membawa id UUID stabil = pengaduan_lampiran.id', tg?.lampiran?.[0]?.id === idLampiran && tg.lampiran[0].nama === 'bukti.pdf');
  cek('linimasa tidak membuka kunci/path lampiran', !/pengaduan-bukti\/|kunci|abc\/bukti/.test(JSON.stringify(lini)));
  const lini2 = nilai(await user('fo2', 'SELECT public.linimasa_pengaduan($1) AS hasil', [G(1)]));
  cek('id lampiran stabil antar panggilan', lini2.find((e) => e.jenis === 'tanggapan').lampiran[0].id === idLampiran);
  const bukti = wajib(await user('fo2', 'SELECT id::text AS id, ada_bukti FROM public.v_pengaduan_kerja ORDER BY nomor_tiket')).rows;
  cek('v_pengaduan_kerja.ada_bukti: true hanya untuk pengaduan berbukti', bukti.find((b) => b.id === G(1))?.ada_bukti === true && bukti.find((b) => b.id === G(2))?.ada_bukti === false);
  wajib(await pg(`INSERT INTO sesi_staf(user_id, session_id) VALUES ('${U.fo2}','${id(7, 1)}')`));
  cek('sesi FO2 digantikan: linimasa ditolak SESI_TIDAK_SAH', ditolak(await user('fo2', 'SELECT public.linimasa_pengaduan($1)', [G(1)]), '42501', 'SESI_TIDAK_SAH:'));
  wajib(await pg('DELETE FROM sesi_staf WHERE user_id = $1', [U.fo2]));

  console.log('\nP2-3 + QA P2: daftar FO');
  for (const [n, boleh] of [[-8, false], [-7, true], [0, true], [1, true], [2, false], [-400, false]]) {
    const tgl = await geser(n);
    for (const fn of ['fo_kunjungan_daftar', 'fo_antrean_daftar']) {
      const r = await user('fo1', `SELECT public.${fn}($1::date) AS hasil`, [tgl]);
      cek(`FO biasa ${fn}(hari ini ${n >= 0 ? '+' : ''}${n}) ${boleh ? 'boleh' : 'TANGGAL_DILUAR_BATAS'}`, boleh ? r.ok : ditolak(r, '22023', 'TANGGAL_DILUAR_BATAS:'));
    }
  }
  const jauh = await geser(-400);
  cek('Admin dan FO Koordinator bebas tanggal', (await user('admin', 'SELECT public.fo_kunjungan_daftar($1::date)', [jauh])).ok
    && (await user('fok', 'SELECT public.fo_antrean_daftar($1::date)', [jauh])).ok);
  const kd = (who, cari, status, batas = 50, lewati = 0) => user(who, 'SELECT public.fo_kunjungan_daftar($1::date, $2, $3, $4, $5) AS hasil', [hari, batas, lewati, cari, status]);
  const semua = nilai(await kd('fo1', null, null));
  cek('tanpa saringan: total 5 kunjungan hari ini', semua.total === 5 && semua.rows.length === 5);
  const satu = nilai(await kd('fo1', 'warga dua', null));
  cek('cari nama (tanpa beda huruf): total terfilter 1', satu.total === 1 && satu.rows[0].id === K(2));
  const lyn = nilai(await kd('fo1', 'Layanan Dua', null));
  cek('cari nama layanan tiket: total terfilter 2', lyn.total === 2 && lyn.rows.every((r) => [K(2), K(4)].includes(r.id)));
  const hal2 = nilai(await kd('fo1', 'Layanan Satu', null, 1, 1));
  cek('saringan sebelum paginasi: total 3, halaman kedua tetap berisi', hal2.total === 3 && hal2.rows.length === 1);
  cek('status disaring server: selesai = 3', nilai(await kd('fo1', null, 'selesai')).total === 3);
  cek('cari + status digabung', nilai(await kd('fo1', 'warga', 'menunggu')).total === 1);
  cek("'%' diperlakukan harfiah (bukan wildcard)", nilai(await kd('fo1', '%', null)).total === 0);
  cek("'_' diperlakukan harfiah", nilai(await kd('fo1', 'persen_', null)).total === 1 && nilai(await kd('fo1', 'r_e', null)).total === 0);
  cek("cari '' = tanpa saringan", nilai(await kd('fo1', '   ', null)).total === 5);
  cek('cari > 100 karakter: MASUKAN_TIDAK_VALID', ditolak(await kd('fo1', 'x'.repeat(101), null), '22023', 'MASUKAN_TIDAK_VALID:'));
  cek('status tak dikenal: MASUKAN_TIDAK_VALID', ditolak(await kd('fo1', null, 'aneh'), '22023', 'MASUKAN_TIDAK_VALID:'));
  cek('payload tersaring tetap tanpa kontak/email', !/0812|@example/.test(JSON.stringify(semua)));
  cek('overload 3 argumen sudah dibuang (tidak ambigu)', nilai(await pg("SELECT to_regprocedure('public.fo_kunjungan_daftar(date,integer,integer)')::text AS hasil")) === null);

  console.log('\nQA P1: inti rekap untuk FO biasa');
  const data = async (who, unit) => nilai(await user(who, 'SELECT public.rekap_data_pelayanan($1::date,$1::date,$2::text,NULL,50,0,NULL,true,false) AS hasil', [hari, unit]));
  const ringkasan = async (who, unit = null) => nilai(await user(who, 'SELECT public.rekap_ringkasan_dilayani($1::date,$1::date,$2::text) AS hasil', [hari, unit]));
  const d0 = await data('fo1', null);
  cek('FO1 tanpa unit: hanya baris unit fo (tahap layanan lama + tiket lama atas namanya tidak ikut)', d0.total === 2 && d0.rows.every((r) => r.unit === 'fo'));
  cek('FO1 meminta unit layanan langsung: kosong', (await data('fo1', 'layanan')).total === 0);
  cek('tabel Data Pelayanan FO1 = pembilang ringkasan', d0.total === (await ringkasan('fo1')).saya);
  const harian = nilai(await user('fo1', 'SELECT public.rekap_harian_terpadu($1::date,$1::date,NULL,NULL) AS hasil', [hari]));
  cek('Rekap Harian FO1 = pembilang ringkasan', Number(harian.ringkasan.jumlah) === (await ringkasan('fo1')).saya);
  const kin = nilai(await user('fo1', 'SELECT public.rekap_kinerja_petugas($1::date,$1::date,NULL,NULL) AS hasil', [hari]));
  cek('Kinerja FO1 hanya unit fo', kin.rows.length > 0 && kin.rows.every((r) => r.unit === 'fo'));
  cek('FO Koordinator tetap melihat unit layanan', (await data('fok', 'layanan')).total > 0);

  console.log('\nQA P2: populasi ringkasan = Kinerja');
  const kinAdmin = nilai(await user('admin', 'SELECT public.rekap_kinerja_petugas($1::date,$1::date,NULL,NULL) AS hasil', [hari]));
  const jumlahKinerja = kinAdmin.rows.reduce((a, r) => a + Number(r.jumlah), 0);
  const rAdmin = await ringkasan('admin');
  cek('tiket lama selesai tanpa penangan tidak dihitung ringkasan', rAdmin.total === jumlahKinerja && rAdmin.saya === jumlahKinerja);
  const semuaInti = (await data('admin', null)).total;
  cek('baris tanpa penangan memang ada di Data Pelayanan (selisih 1)', semuaInti === jumlahKinerja + 1);

  console.log('\nP2-7: operator');
  wajib(await user('admin', 'SELECT public.admin_atur_operator($1, true)', [staf.fo2]));
  wajib(await user('admin', 'SELECT public.admin_atur_operator($1, false)', [staf.fo2]));
  cek('izin operator dimatikan: operator_default dikosongkan', nilai(await pg('SELECT operator_default AS hasil FROM petugas WHERE id = $1', [staf.fo2])) === null);
  wajib(await user('admin', `UPDATE public.petugas SET operator_aktif = true WHERE id = '${staf.fo1}'`));
  const jejak = nilai(await pg("SELECT count(*) AS hasil FROM audit_log WHERE aksi = 'petugas_ubah' AND entitas_id = $1 AND nilai_baru ? 'operator_aktif'", [staf.fo1]));
  cek('UPDATE langsung operator_aktif oleh Admin teraudit', Number(jejak) === 1);

  console.log('\nIdempoten dan rollback');
  wajib(await pg(MIGRASI));
  cek('migrasi idempoten pada data yang sudah ada', nilai(await user('fo1', 'SELECT public.fo_kunjungan_daftar($1::date, 50, 0, $2, NULL) AS hasil', [hari, 'warga dua'])).total === 1);
  wajib(await pg(ROLLBACK));
  cek('rollback: fo_kunjungan_daftar 3 argumen kembali, 5 argumen hilang',
    nilai(await pg("SELECT to_regprocedure('public.fo_kunjungan_daftar(date,integer,integer)')::text AS hasil")) !== null
    && nilai(await pg("SELECT to_regprocedure('public.fo_kunjungan_daftar(date,integer,integer,text,text)')::text AS hasil")) === null);
  cek('rollback: pemicu pengaduan baru hilang (perilaku lama)', (await ubah('fo2', 'batas_penanganan = current_date + 30', G(3))).ok);
  cek('rollback: catat_laju_publik dibuang', nilai(await pg("SELECT to_regprocedure('public.catat_laju_publik(text,text,integer,integer)')::text AS hasil")) === null);
  cek('rollback: identitas pelapor kembali bisa diubah (perilaku lama)', (await ubah('fo2', "pelapor_nama = 'Pelapor Asli'")).ok);
  cek('rollback: saran publik kembali bisa dipanggil anon', nilai(await sebagai(db, 'anon', null, "SELECT public.kirim_saran_publik('saran anon lama', NULL) AS hasil")) === 'submitted');
  cek('rollback: v_pengaduan_kerja tanpa ada_bukti', !(await user('admin', 'SELECT ada_bukti FROM public.v_pengaduan_kerja')).ok);
  cek('rollback: FO1 kembali bisa mengambil identitas FO2 (perilaku lama)', (await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(8)])).ok);
  cek('rollback tidak menghapus data', Number(nilai(await pg('SELECT count(*) AS hasil FROM kunjungan'))) === 7 && Number(nilai(await pg('SELECT count(*) AS hasil FROM pengaduan_lampiran'))) === 1);
  wajib(await pg(MIGRASI));
  cek('migrasi dapat diterapkan ulang setelah rollback', ditolak(await user('fo1', 'SELECT * FROM public.fo_ambil_pengunjung($1)', [K(2)]), '42501', 'FORBIDDEN:'));
  cek('setelah terap ulang: email pelapor terkunci lagi dan catat_laju_publik kembali',
    ditolak(await ubah('fo1', "pelapor_email = 'alamat-uji@example.invalid'"), '42501', 'KOLOM_TERKUNCI:')
    && nilai(await sebagai(db, 'service_role', null, "SELECT public.catat_laju_publik('saran.publik', $1, 5, 600) AS hasil", ['c'.repeat(64)])) === true);
  ringkas();
} finally {
  await db.close();
}
