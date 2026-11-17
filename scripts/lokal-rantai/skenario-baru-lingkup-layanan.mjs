// PGlite opsional yang sudah terpasang; tanpa jaringan, .env, atau database eksternal.
// Jalankan: node scripts/lokal-rantai/skenario-baru-lingkup-layanan.mjs
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh({ sampai: '202611110003' });
const id = (grup, n) => `${grup}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = Object.fromEntries(['admin', 'fo1', 'fo2', 'fok', 'p1', 'p2', 'pk', 'p3', 'nonaktif', 'warga'].map((r, i) => [r, id(0, i + 1)]));
const staf = Object.fromEntries(Object.keys(U).map((r, i) => [r, id(2, i + 1)]));
const L = n => id(1, n);
const K = n => id(3, n);
const T = n => id(4, n);
const P = n => id(5, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (role, sql, params) => sebagai(db, 'authenticated', U[role], sql, params);
const wajib = r => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const nilai = r => wajib(r).rows[0]?.hasil;
try {
  // CURRENT_DATE pada fixture harus sama dengan hari operasional RPC (WIB).
  wajib(await pg("SET TIME ZONE 'Asia/Jakarta'"));
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id, email) VALUES ${Object.entries(U).map(([r, v]) => `('${v}', '${r}@example.invalid')`).join(',')};
    INSERT INTO layanan(id, nama, prefiks_antrean, slug, form_pendataan) VALUES
      ('${L(1)}','Matchmaking UMKM','AA','uji-akses-fo-1','oss'), ('${L(2)}','Investment Gallery','BB','uji-akses-fo-2',NULL);
    INSERT INTO petugas(id, auth_user_id, nama, role, layanan_id, aktif, koordinator) VALUES
      ${Object.keys(U).filter(r => r !== 'warga').map(r => `('${staf[r]}','${U[r]}','${r}',
        '${r === 'admin' ? 'admin' : r.startsWith('p') ? 'petugas' : 'front_office'}',
        ${r.startsWith('p') ? `'${r === 'p3' ? L(2) : L(1)}'` : 'NULL'}, ${r !== 'nonaktif'}, ${r === 'fok' || r === 'pk'})`).join(',')};
    INSERT INTO kunjungan(id, nama, asal, tanggal, status, dibuat_oleh, kontak_hp, email, qr_token) VALUES
      ('${K(1)}','Warga Satu','walk_in',current_date,'selesai','${staf.fo1}','081234567801','satu@example.invalid','scan-satu'),
      ('${K(2)}','Warga Dua','walk_in',current_date,'selesai','${staf.fo2}','081234567802','dua@example.invalid','scan-dua'),
      ('${K(3)}','Warga Tiga','walk_in',current_date,'menunggu','${staf.fo2}','081234567803','tiga@example.invalid','scan-tiga'),
      ('${K(4)}','Reservasi Empat','reservasi',current_date,'terjadwal',NULL,'081234567804','empat@example.invalid','scan-empat'),
      ('${K(5)}','Warga Lima','walk_in',current_date,'selesai','${staf.fo2}','081234567805','lima@example.invalid','scan-lima'),
      ('${K(6)}','Legacy Enam','walk_in',current_date,'selesai',NULL,NULL,NULL,'scan-enam');
    INSERT INTO tiket_antrean(id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, dilayani_oleh, waktu_mulai_layan, waktu_selesai) VALUES
      ('${T(1)}','${K(1)}','${L(1)}',current_date,1,'AA-001','selesai','${staf.p1}',now()-interval '10 minutes',now()),
      ('${T(2)}','${K(2)}','${L(1)}',current_date,2,'AA-002','selesai','${staf.p2}',now()-interval '20 minutes',now()),
      ('${T(3)}','${K(3)}','${L(1)}',current_date,3,'AA-003','menunggu',NULL,NULL,NULL),
      ('${T(5)}','${K(5)}','${L(2)}',current_date,1,'BB-001','selesai','${staf.p3}',now()-interval '30 minutes',now()),
      ('${T(6)}','${K(6)}','${L(1)}',current_date,4,'AA-004','selesai','${staf.p2}',now()-interval '40 minutes',now());
    INSERT INTO penanganan(id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, tiket_id, saluran, status, penangan_id, mulai_at, selesai_at, hasil, catatan, topik) VALUES
      ('${P(1)}','${K(1)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo1}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia satu','Topik Uji'),
      ('${P(2)}','${K(1)}',2,'layanan','${L(1)}','${T(1)}','walk_in','selesai','${staf.p1}',now()-interval '10 minutes',now(),'selesai','isian rahasia layanan','Topik Uji'),
      ('${P(3)}','${K(2)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo2}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia dua','Topik Uji'),
      ('${P(4)}','${K(2)}',2,'layanan','${L(1)}','${T(2)}','walk_in','selesai','${staf.p2}',now()-interval '20 minutes',now(),'selesai','isian rahasia layanan dua','Topik Uji'),
      ('${P(5)}','${K(3)}',1,'layanan','${L(1)}','${T(3)}','walk_in','menunggu',NULL,NULL,NULL,NULL,NULL,'Topik Uji'),
      ('${P(6)}','${K(5)}',1,'fo',NULL,NULL,'walk_in','selesai','${staf.fo2}',now()-interval '1 hour',now(),'dieskalasi','isian rahasia lima','Topik Uji'),
      ('${P(7)}','${K(5)}',2,'layanan','${L(2)}','${T(5)}','walk_in','selesai','${staf.p3}',now()-interval '30 minutes',now(),'selesai','isian rahasia layanan lima','Topik Uji');
    INSERT INTO pelayanan_oss(tiket_id,kunjungan_id,petugas_id,nama_pemohon,nama_usaha,tindak_lanjut,uraian_solusi,status_draft,email) VALUES
      ('${T(1)}','${K(1)}','${staf.p1}','Warga Satu','Usaha Satu','selesai','rahasia satu','selesai','satu@example.invalid'),
      ('${T(2)}','${K(2)}','${staf.p2}','Warga Dua','Usaha Dua','selesai','rahasia dua','selesai','dua@example.invalid'),
      ('${T(3)}','${K(3)}','${staf.p1}','Warga Tiga','Usaha Tiga','draf','rahasia terbuka','draft','tiga@example.invalid');
    SET session_replication_role = origin;
  `));
  const visible = async (who, table, column = 'id') => wajib(await user(who,
    `SELECT ${column} AS hasil FROM public.${table} ORDER BY ${column}`)).rows.map(r => r.hasil);
  cek('baseline hidup: FO belum bisa membaca data pembuat lain', !(await visible('fo1', 'tiket_antrean')).includes(T(2)));
  cek('baseline hidup: petugas belum bisa membaca Khusus rekan satu layanan',
    nilai(await user('p1', 'SELECT public.boleh_baca_khusus($1) AS hasil', [P(4)])) === false);
  // Tiket kedua pada kunjungan yang sama menguji agar konteks kunjungan tidak membocorkan layanan lain.
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO tiket_antrean(id,kunjungan_id,layanan_id,tanggal,nomor,nomor_display,status,dilayani_oleh,waktu_selesai)
      VALUES('${T(7)}','${K(1)}','${L(2)}',current_date,2,'BB-002','selesai','${staf.p1}',now());
    INSERT INTO penanganan(id,kunjungan_id,tahap_ke,peran_tahap,layanan_id,tiket_id,saluran,status,penangan_id,mulai_at,selesai_at,hasil,catatan,topik)
      VALUES('${P(8)}','${K(1)}',3,'layanan','${L(2)}','${T(7)}','walk_in','selesai','${staf.p1}',now(),now(),'selesai','Catatan sintetis','Topik Uji');
    INSERT INTO pendataan_khusus_field(id,layanan_id,label,jenis,wajib,urut)
      VALUES('${id(6, 1)}','${L(2)}','Isian sintetis','teks_singkat',false,1);
    INSERT INTO pendataan_khusus_jawaban(penanganan_id,field_id,nilai,label_snapshot,jenis_snapshot)
      VALUES('${P(7)}','${id(6, 1)}','"jawaban sintetis"'::jsonb,'Isian sintetis','teks_singkat');
    INSERT INTO pelayanan_perizinan(tiket_id,kunjungan_id,petugas_id,nama_pemohon,nama_perusahaan,opd_teknis,uraian_permohonan,tindak_lanjut)
      VALUES('${T(5)}','${K(5)}','${staf.p3}','Pemohon Izin','Perusahaan Uji','OPD Uji','Izin Uji','selesai');
    -- Riwayat lama tetap harus terbaca; tanggal hari ini tidak boleh menjadi jalan pintas izin.
    UPDATE kunjungan SET tanggal=current_date-10 WHERE id IN ('${K(1)}','${K(2)}','${K(5)}');
    UPDATE tiket_antrean SET tanggal=current_date-10 WHERE id IN ('${T(1)}','${T(2)}','${T(5)}','${T(7)}');
    -- Penanda lama sengaja salah: petugas non-UMKM true, petugas UMKM false.
    UPDATE petugas SET pemeriksa_umkm=(id='${staf.p3}');
    SET session_replication_role = origin;
  `));
  const sql = readFileSync(new URL('../../supabase/migrations/202611160001_lingkup_layanan_staf.sql', import.meta.url), 'utf8');
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('backfill nama seed UMKM', nilai(await pg('SELECT modul AS hasil FROM layanan WHERE id=$1', [L(1)])) === 'umkm');
  cek('backfill nama seed Investment Gallery', nilai(await pg('SELECT modul AS hasil FROM layanan WHERE id=$1', [L(2)])) === 'investasi');
  const invalidModul = await pg("UPDATE layanan SET modul='tidak-ada' WHERE id=$1", [L(1)]);
  cek('CHECK menolak modul tidak dikenal', !invalidModul.ok && invalidModul.kode === '23514');
  const expectedA = [T(1), T(2), T(3), T(6)];
  cek('petugas A membaca seluruh tiket layanannya termasuk milik rekan dan tiket lama',
    JSON.stringify(await visible('p1', 'tiket_antrean')) === JSON.stringify(expectedA));
  cek('petugas A tidak membaca tiket B meskipun pernah menjadi pelayan dan berbagi kunjungan',
    !(await visible('p1', 'tiket_antrean')).includes(T(7)));
  cek('petugas B membaca seluruh layanan B', JSON.stringify(await visible('p3', 'tiket_antrean')) === JSON.stringify([T(5), T(7)]));
  cek('petugas A membaca form pendataan rekan satu layanan', (await visible('p1', 'pelayanan_oss', 'tiket_id')).includes(T(2)));
  cek('petugas B tidak membaca form layanan A', (await visible('p3', 'pelayanan_oss', 'tiket_id')).length === 0);
  cek('petugas A melihat kunjungan layanannya termasuk tanpa penanganan',
    JSON.stringify(await visible('p1', 'kunjungan')) === JSON.stringify([K(1), K(2), K(3), K(6)]));
  cek('petugas A melihat tahap layanan rekan dan konteks FO tetapi tidak tahap layanan B',
    (await visible('p1', 'penanganan')).includes(P(4)) && !(await visible('p1', 'penanganan')).includes(P(8)));
  cek('petugas B melihat jawaban Khusus layanannya', (await visible('p3', 'pendataan_khusus_jawaban', 'penanganan_id')).includes(P(7)));
  cek('petugas A ditolak jawaban Khusus B', (await visible('p1', 'pendataan_khusus_jawaban', 'penanganan_id')).length === 0);
  for (const siapa of ['fo1', 'fo2', 'fok', 'admin']) {
    cek(`${siapa} membaca semua tiket`, (await visible(siapa, 'tiket_antrean')).length === 6);
    cek(`${siapa} membaca semua kunjungan termasuk tanpa layanan`, (await visible(siapa, 'kunjungan')).length === 6);
    cek(`${siapa} membaca semua penanganan`, (await visible(siapa, 'penanganan')).length === 8);
    if (siapa === 'admin' || siapa === 'fok') {
      cek(`${siapa} membaca semua form`, (await visible(siapa, 'pelayanan_oss', 'tiket_id')).length === 3);
      cek(`${siapa} membaca Khusus`, (await visible(siapa, 'pendataan_khusus_jawaban', 'penanganan_id')).length === 1);
    }
  }
  cek('FO query tabel langsung tidak melihat form pembuat lain', !(await visible('fo1', 'pelayanan_oss', 'tiket_id')).includes(T(2)));
  cek('jendela tiket aktif hari ini tidak membuka form pembuat lain untuk FO',
    JSON.stringify(await visible('fo1', 'pelayanan_oss', 'tiket_id')) === JSON.stringify([T(1)]));
  cek('FO pembuat tetap melihat draf dan riwayat sendiri',
    JSON.stringify(await visible('fo2', 'pelayanan_oss', 'tiket_id')) === JSON.stringify([T(2), T(3)]));
  cek('FO query tabel perizinan langsung tidak melihat pembuat lain', (await visible('fo1', 'pelayanan_perizinan', 'tiket_id')).length === 0);
  cek('petugas seluruh layanan membaca perizinan', (await visible('p3', 'pelayanan_perizinan', 'tiket_id')).includes(T(5)));
  cek('FO query jawaban langsung tidak melihat pembuat lain', (await visible('fo1', 'pendataan_khusus_jawaban', 'penanganan_id')).length === 0);
  cek('FO peta jawaban langsung tidak melihat pembuat lain', JSON.stringify(nilai(await user('fo1', 'SELECT pendataan_khusus_peta(ARRAY[$1]::uuid[]) AS hasil', [P(7)]))) === '{}');
  const batchFo = nilai(await user('fo1', 'SELECT rekap_khusus_peta(ARRAY[$1]::uuid[]) AS hasil', [P(7)]));
  cek('FO batch rekap membaca jawaban Khusus lintas pembuat terisi', batchFo[P(7)]?.[id(6, 1)] === 'jawaban sintetis');
  cek('batch rekap tidak membuka SELECT langsung FO', (await visible('fo1', 'pendataan_khusus_jawaban', 'penanganan_id')).length === 0);
  const batchLain = await user('p1', 'SELECT rekap_khusus_peta(ARRAY[$1]::uuid[]) AS hasil', [P(7)]);
  cek('petugas layanan lain tidak membaca batch Khusus', !batchLain.ok && batchLain.kode === '42501');
  for (const siapa of ['nonaktif', 'warga']) {
    cek(`${siapa} tidak memperoleh lingkup staf`, wajib(await user(siapa, 'SELECT * FROM lingkup_layanan_saya()')).rows.length === 0);
    for (const tabel of ['pelayanan_oss', 'pelayanan_perizinan', 'pendataan_khusus_jawaban']) {
      cek(`${siapa} tidak membaca tabel langsung ${tabel}`, (await visible(siapa, tabel)).length === 0);
    }
  }
  cek('modul UMKM diturunkan walau penanda lama false', nilai(await user('p1', 'SELECT staf_modul() AS hasil')) === 'umkm');
  cek('petugas layanan lain tetap investasi walau penanda lama true', nilai(await user('p3', 'SELECT staf_modul() AS hasil')) === 'investasi');
  const summary = async siapa => nilai(await user(siapa, 'SELECT rekap_ringkasan_dilayani(current_date-10,current_date) AS hasil'));
  cek('rekap petugas A seluruh layanan: 3/3', JSON.stringify(await summary('p1')) === JSON.stringify({ saya: 3, total: 3, persen: 100 }));
  cek('rekap petugas B seluruh layanan: 2/2, termasuk tahap atas nama petugas A lama', (await summary('p3')).total === 2 && (await summary('p3')).saya === 2);
  cek('rekap FO semua layanan dan FO: 8/8', (await summary('fo1')).total === 8 && (await summary('fo1')).saya === 8);
  cek('rekap admin penuh', (await summary('admin')).total === 8);
  cek('petugas tidak dapat meminta rekap B melalui filter eksplisit', nilai(await user('p1',
    'SELECT rekap_ringkasan_dilayani(current_date-10,current_date,NULL,$1) AS hasil', [L(2)])).total === 0);
  cek('FO dapat meminta rekap unit layanan', nilai(await user('fo1',
    "SELECT rekap_ringkasan_dilayani(current_date-10,current_date,'layanan') AS hasil")).total === 5);
  const rentang = await user('fo1', 'SELECT rekap_ringkasan_dilayani(current_date-366,current_date)');
  cek('batas periode 366 hari tetap berlaku', !rentang.ok && rentang.kode === '22023');

  // Batas tulis tetap di RPC pemilik; perlu SELECT yang luas agar tes ini menguji penolakan tulis sebenarnya.
  for (const table of ['tiket_antrean', 'kunjungan', 'penanganan', 'pelayanan_oss', 'pendataan_khusus_jawaban']) {
    const kolom = table === 'pelayanan_oss' ? 'nama_pemohon' : table === 'pendataan_khusus_jawaban' ? 'label_snapshot' : table === 'kunjungan' ? 'nama' : 'status';
    const r = await user('fo1', `UPDATE ${table} SET ${kolom}=${kolom} RETURNING ${kolom}`);
    cek(`FO tidak bisa UPDATE langsung ${table}`, !r.ok && r.kode === '42501' || r.ok && r.rows.length === 0);
  }
  const mulaiFO = await user('fo1', 'SELECT layanan_mulai($1)', [T(3)]);
  cek('FO ditolak memulai layanan', !mulaiFO.ok && mulaiFO.kode === '42501');
  cek('FO ditolak sunting pendataan', nilai(await user('fo1', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === false);
  cek('petugas rekan tidak otomatis boleh sunting tiket milik orang lain',
    nilai(await user('p2', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === false);
  const ambilLain = await user('p3', 'SELECT layanan_mulai($1)', [T(3)]);
  cek('petugas B tidak bisa memulai tiket A', !ambilLain.ok && ambilLain.kode === '42501');
  // Tiket sintetis T3 memang memiliki tahap layanan, sekalipun penanganan_asal_id NULL.
  wajib(await user('p1', 'SELECT layanan_mulai($1)', [T(3)]));
  cek('petugas layanan A tetap bisa memulai tiketnya', nilai(await pg('SELECT dilayani_oleh AS hasil FROM tiket_antrean WHERE id=$1', [T(3)])) === staf.p1);
  const curi = await user('p2', 'SELECT layanan_mulai($1)', [T(3)]);
  cek('petugas rekan tidak bisa merebut tiket berjalan', !curi.ok && curi.pesan.startsWith('SUDAH_DIAMBIL:'));
  cek('admin tetap mengikuti kepemilikan sebelum ambil alih', nilai(await user('admin', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === false);
  wajib(await pg('BEGIN'));
  wajib(await user('pk', "SELECT koordinator_ambil_alih_tiket($1,'Pengujian ambil alih lokal')", [T(3)]));
  cek('koordinator tetap boleh ambil alih lalu sunting', nilai(await user('pk', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === true);
  cek('pemegang lama tetap dapat menyunting setelah koordinator mengambil alih', nilai(await user('p1', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === true);
  wajib(await user('admin', "SELECT admin_ambil_alih($1,'Pengujian Admin lokal')", [T(3)]));
  cek('admin tetap dapat ambil alih lalu sunting penuh', nilai(await user('admin', 'SELECT boleh_sunting_pendataan($1) AS hasil', [T(3)])) === true);
  wajib(await pg('ROLLBACK'));

  // Semua RPC publik yang secara transitif memakai tiga guard penanda lama diuji, termasuk wrapper mutasi.
  const funcs = wajib(await pg(`SELECT n.nspname||'.'||p.proname AS nama, pg_get_functiondef(p.oid) AS def,
    oidvectortypes(p.proargtypes) AS types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','umkm_private') AND p.prokind='f'`)).rows;
  const guards = new Set(['umkm_private.aktor', 'umkm_private.aktor_hapus', 'umkm_private.laporan_statistik']);
  let perubahan;
  do {
    perubahan = false;
    for (const f of funcs) if (!guards.has(f.nama) && [...guards].some(g => f.def.includes(g + '('))) {
      guards.add(f.nama); perubahan = true;
    }
  } while (perubahan);
  const rpc = funcs.filter(f => f.nama.startsWith('public.umkm_') && guards.has(f.nama));
  cek('inventaris mencakup seluruh keluarga RPC penanda lama', rpc.length >= 30);
  for (const f of rpc) {
    const args = f.types ? f.types.split(', ').map(t => `NULL::${t}`).join(',') : '';
    const r = await user('p3', `SELECT ${f.nama}(${args})`);
    cek(`non-UMKM ditolak ${f.nama}`, !r.ok && r.kode === '42501', JSON.stringify(r));
  }
  cek('UMKM dengan penanda false dapat membaca daftar tugas', (await user('p1', 'SELECT umkm_daftar_tugas()')).ok);
  cek('admin tanpa penanda lama dapat membaca daftar tugas', (await user('admin', 'SELECT umkm_daftar_tugas()')).ok);
  cek('UMKM dapat membaca laporan statistik', (await user('p1', 'SELECT umkm_laporan_statistik()')).ok);
  const profilUji = { nama: 'Usaha Sintetis', deskripsi: 'Isian pengujian lokal', jenis: 'Produk',
    kategori: 'Makanan Olahan', kabupaten_kota: 'Kota Bandar Lampung', sumber: 'kurasi',
    produk: [{ nama: 'Produk Sintetis' }] };
  const baru = nilai(await user('p1', 'SELECT umkm_simpan_profil($1::jsonb,$2::uuid) AS hasil',
    [JSON.stringify(profilUji), id(8, 2)]));
  cek('petugas modul UMKM tanpa penanda lama dapat menyimpan profil/produk', !!baru?.id && baru.versi === 1);
  const simpanRekan = await user('p2', 'SELECT umkm_simpan_profil($1::jsonb,$2::uuid,$3::uuid,1) AS hasil',
    [JSON.stringify(profilUji), id(8, 3), baru.id]);
  cek('modul UMKM tidak membuka hak ubah profil milik rekan', !simpanRekan.ok && simpanRekan.kode === '42501');
  const adminBaru = nilai(await user('admin', 'SELECT umkm_simpan_profil($1::jsonb,$2::uuid) AS hasil',
    [JSON.stringify(profilUji), id(8, 4)]));
  cek('admin tanpa penanda lama dapat menyimpan profil/produk', !!adminBaru?.id);
  for (const siapa of ['admin', 'p1', 'fo1']) {
    const r = await user(siapa, 'SELECT umkm_atur_pemeriksa($1,true,$2)', [staf.p3, id(8, 1)]);
    cek(`${siapa} setter dihentikan`, !r.ok && r.kode === '0A000' && r.pesan.startsWith('DIHENTIKAN:'));
  }
  const setterInternal = await pg("SELECT umkm_private.mutasi('atur_pemeriksa',NULL,NULL)");
  cek('setter internal dihentikan sebelum validasi/replay operasi lama',
    !setterInternal.ok && setterInternal.kode === '0A000' && setterInternal.pesan.startsWith('DIHENTIKAN:'));
  const flagReads = wajib(await pg(`SELECT n.nspname||'.'||p.proname AS nama FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','umkm_private') AND p.prokind='f'
    AND pg_get_functiondef(p.oid) ~ 'a[.]pemeriksa_umkm'`)).rows;
  cek('tidak ada lagi guard RPC yang membaca a.pemeriksa_umkm', flagReads.length === 0, JSON.stringify(flagReads));

  const auditCount = async () => Number(nilai(await pg("SELECT count(*) AS hasil FROM audit_log WHERE aksi='lihat_data'")));
  const sebelumAudit = await auditCount();
  wajib(await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(2)]));
  cek('FO lintas pembuat tercatat', await auditCount() === sebelumAudit + 1);
  const terbaca = nilai(await user('fo1', 'SELECT lihat_data_pelayanan($1) AS hasil', [T(2)]));
  cek('RPC mengembalikan OSS lintas pembuat', terbaca.oss?.nama_pemohon === 'Warga Dua');
  cek('RPC berulang didedup per aktor+tiket per menit', await auditCount() === sebelumAudit + 1);
  wajib(await pg("UPDATE pendataan_khusus_field SET label='Label Terbaru' WHERE id=$1", [id(6, 1)]));
  const khusus = nilai(await user('fo1', 'SELECT lihat_data_pelayanan($1) AS hasil', [T(5)]));
  cek('RPC layanan tanpa formulir tetap mengembalikan Khusus dan snapshot', khusus.khusus?.[0]?.label === 'Label Terbaru' && khusus.khusus?.[0]?.label_snapshot === 'Isian sintetis');
  cek('RPC mengembalikan perizinan lintas pembuat', khusus.perizinan?.nama_perusahaan === 'Perusahaan Uji');
  for (const siapa of ['warga', 'nonaktif']) {
    const ditolak = await user(siapa, 'SELECT lihat_data_pelayanan($1)', [T(2)]);
    cek(`${siapa} ditolak RPC Lihat Data`, !ditolak.ok && ditolak.kode === '42501');
  }
  const manual = await user('fo1', 'SELECT audit_lihat_data($1)', [T(2)]);
  cek('audit internal tidak dapat dipanggil langsung', !manual.ok && manual.kode === '42501');
  wajib(await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(1)]));
  wajib(await user('admin', 'SELECT lihat_data_pelayanan($1)', [T(2)]));
  wajib(await user('p1', 'SELECT lihat_data_pelayanan($1)', [T(2)]));
  cek('FO pembuat sendiri, admin, petugas tidak menambah log lintas pembuat', await auditCount() === sebelumAudit + 2);
  const tanpaForm = nilai(await user('fo1', 'SELECT lihat_data_pelayanan($1) AS hasil', [T(6)]));
  cek('tiket tanpa isian tetap bisa dilihat dengan bentuk kosong lengkap',
    tanpaForm.oss === null && tanpaForm.perizinan === null && tanpaForm.draf === null
      && Array.isArray(tanpaForm.khusus) && tanpaForm.khusus.length === 0);
  cek('pembuat NULL juga dicatat untuk FO', await auditCount() === sebelumAudit + 3);
  const deniedAudit = await user('p1', 'SELECT lihat_data_pelayanan($1)', [T(5)]);
  cek('audit menolak tiket di luar lingkup', !deniedAudit.ok && deniedAudit.kode === '42501');
  const log = wajib(await pg("SELECT actor_id,actor_role,entitas,entitas_id,detail FROM audit_log WHERE aksi='lihat_data' AND entitas='tiket_antrean' ORDER BY id LIMIT 1")).rows[0];
  cek('aktor audit dari auth.uid dan detail tanpa kontak', log.actor_id === U.fo1 && log.actor_role === 'front_office'
    && log.entitas_id === T(2) && JSON.stringify(log.detail) === JSON.stringify({ layanan_id: L(1), lintas_pembuat: true }));
  const anon = await sebagai(db, 'anon', null, 'SELECT lihat_data_pelayanan($1)', [T(2)]);
  cek('anon tidak punya EXECUTE audit', !anon.ok && anon.kode === '42501');
  // Ukuran total ditolak atomik: audit juga tidak tersimpan ketika pembacaan gagal.
  wajib(await pg(`SET session_replication_role=replica;
    UPDATE pelayanan_oss SET uraian_solusi=repeat('x',1048577) WHERE tiket_id='${T(3)}';
    SET session_replication_role=origin;`));
  const countSebelumBesar = await auditCount();
  const besar = await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(3)]);
  cek('RPC menolak total data di atas 1 MiB', !besar.ok && besar.kode === '54000');
  cek('RPC gagal ukuran membatalkan audit', await auditCount() === countSebelumBesar);
  wajib(await pg(`SET session_replication_role=replica;
    UPDATE pelayanan_oss SET uraian_solusi='kembali kecil' WHERE tiket_id='${T(3)}';
    SET session_replication_role=origin;`));
  const hilang = await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(99)]);
  cek('tiket tidak ada ditolak tanpa audit', !hilang.ok && hilang.kode === 'P0002' && await auditCount() === countSebelumBesar);
  const tanpaIdentitas = await sebagai(db, 'authenticated', null, 'SELECT lihat_data_pelayanan($1)', [T(2)]);
  cek('role authenticated tanpa identitas staf ditolak', !tanpaIdentitas.ok && tanpaIdentitas.kode === '42501');
  wajib(await pg(`CREATE FUNCTION pg_temp.g2b_tolak_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'UJI_AUDIT_GAGAL' USING ERRCODE='P0001'; END $$;
    CREATE TRIGGER g2b_uji_gagal_audit BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.aksi='lihat_data') EXECUTE FUNCTION pg_temp.g2b_tolak_audit();`));
  const auditGagal = await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(3)]);
  cek('kegagalan INSERT audit menolak RPC tanpa mengembalikan data',
    !auditGagal.ok && auditGagal.kode === 'P0001' && auditGagal.pesan === 'UJI_AUDIT_GAGAL');
  cek('kegagalan audit tidak meninggalkan catatan parsial', await auditCount() === countSebelumBesar);
  wajib(await pg('DROP TRIGGER g2b_uji_gagal_audit ON audit_log'));
  // Lewat 60 detik boleh dicatat lagi; aktor lain memiliki pasangan dedup sendiri.
  wajib(await pg("UPDATE audit_log SET created_at=now()-interval '61 seconds' WHERE aksi='lihat_data' AND actor_id=$1 AND entitas_id=$2", [U.fo1,T(2)]));
  wajib(await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(2)]));
  cek('akses setelah satu menit dicatat kembali', await auditCount() === countSebelumBesar + 1);
  wajib(await user('fok', 'SELECT lihat_data_pelayanan($1)', [T(2)]));
  cek('koordinator FO lintas pembuat juga tercatat dengan aktor sendiri', await auditCount() === countSebelumBesar + 2);
  wajib(await pg(`INSERT INTO sesi_staf(user_id,session_id) VALUES('${U.fo1}','${id(7, 1)}')`));
  cek('sesi digantikan tidak memperoleh lingkup', wajib(await user('fo1', 'SELECT * FROM lingkup_layanan_saya()')).rows.length === 0);
  const expired = await user('fo1', 'SELECT lihat_data_pelayanan($1)', [T(2)]);
  cek('sesi digantikan tidak boleh audit/baca', !expired.ok && expired.kode === '42501' && expired.pesan.startsWith('SESI_TIDAK_SAH:'));

  // Jalur nyata penerbitan: terbit_tiket tidak membuat tahap penanganan, layanan_mulai hanya UPDATE tahap yang ada.
  wajib(await pg(`INSERT INTO kunjungan(id,nama,asal,tanggal,status,kontak_hp,email)
    VALUES('${K(8)}','Reservasi sintetis','reservasi',current_date,'menunggu','081234567899','uji@example.invalid')`));
  const legacyId = nilai(await pg('SELECT terbit_tiket($1,$2) AS hasil', [K(8), L(1)]));
  const jalur = async () => wajib(await pg(`SELECT t.penanganan_asal_id,
    (SELECT count(*)::int FROM penanganan p WHERE p.tiket_id=t.id) AS jumlah
    FROM tiket_antrean t WHERE t.id=$1`, [legacyId])).rows[0];
  cek('terbit_tiket menghasilkan tiket tanpa penanganan_asal_id dan tanpa tahap',
    (await jalur()).penanganan_asal_id === null && (await jalur()).jumlah === 0);
  cek('lingkup baru tetap menampilkan tiket tanpa penanganan', (await visible('p1', 'tiket_antrean')).includes(legacyId));
  wajib(await user('p1', 'SELECT layanan_mulai($1)', [legacyId]));
  cek('temuan G5: layanan_mulai belum membuat penanganan untuk tiket tanpa tahap', (await jalur()).jumlah === 0);
  console.log('TEMUAN: terbit_tiket -> layanan_mulai tetap 0 penanganan; NULL penanganan_asal_id tidak memutus baca, tetapi belum ada wadah Khusus (G5). Angka 484/730 berasal kontrak produksi, tidak diverifikasi ulang di sini.');
  wajib(await pg('BEGIN;\n' + sql + '\nCOMMIT;'));
  cek('migrasi idempoten, data dan lingkup dipertahankan', (await visible('p1', 'tiket_antrean')).includes(legacyId));
  ringkas();
} finally {
  await db.close();
}
