// Bukti perilaku lokal IPRO dan Kotak Masuk Investasi pada rantai migrasi asli.
// Tanpa jaringan atau konfigurasi lingkungan; batas harness ada di README.md.
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

console.log('Host tujuan: PGlite lokal dalam memori; hanya data sintetis, tanpa koneksi eksternal.');
const db = await bukaDbPenuh({ sampai: '202611190001' });
const id = (g, n) => `${g}0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const peran = ['admin', 'investasi', 'umkm', 'fo', 'nonaktif', 'warga', 'harian', 'global', 'kedua'];
const U = Object.fromEntries(peran.map((r, i) => [r, id(0, i + 1)]));
const P = Object.fromEntries(peran.map((r, i) => [r, id(2, i + 1)]));
const L = (n) => id(1, n);
const I = (n) => id(3, n);
const D = (n) => id(4, n);
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
const user = (r, sql, params) => sebagai(db, 'authenticated', U[r], sql, params,
  { is_anonymous: ['warga', 'harian', 'global', 'kedua'].includes(r) });
const wajib = (r) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r; };
const hasil = (r) => wajib(r).rows[0]?.hasil;
const jumlah = async (tabel, kondisi = 'true', params) => Number(hasil(await pg(
  `SELECT count(*)::int AS hasil FROM ${tabel} WHERE ${kondisi}`, params)));
const galat = (nama, r, pesan, kode) => cek(nama,
  !r.ok && r.pesan.includes(pesan) && (!kode || r.kode === kode), JSON.stringify(r));
let operasi = 0;
const isian = (ubah = {}) => ({
  kanal: 'ipro', ref: I(1), nama: 'Investor Sintetis', email: 'investor@example.invalid',
  hp: '+62 (811) 234-5678', instansi: 'Perusahaan Uji', pesan: 'Mohon informasi proyek investasi ini.',
  setuju: true, kebijakan: '1.1', operasi: id(5, ++operasi), ...ubah,
});
const kirim = (r, data) => user(r, `SELECT public.investasi_kirim_minat(
  $1,$2::uuid,$3,$4,$5,$6,$7,$8::boolean,$9,$10::uuid) AS hasil`, [
  data.kanal, data.ref, data.nama, data.email, data.hp, data.instansi, data.pesan,
  data.setuju, data.kebijakan, data.operasi,
]);
const status = (r, lead, nilai, versi) => user(r,
  'SELECT public.investasi_ubah_status_minat($1::uuid,$2,$3::integer) AS hasil', [lead, nilai, versi]);
const proyek = async (r, n, sumber = 'ptsp', terbit = 'draf') => user(r, `
  INSERT INTO public.ipro_proyek(id,sumber,status,slug,judul,ringkasan,sektor,kab_kota,sumber_url,sumber_slug)
  VALUES ($1,$2,$3,$4,'Proyek Uji','Ringkasan publik','energi','Kota Bandar Lampung',$5,$6)
  RETURNING id,versi,diterbitkan_pada`, [I(n), sumber, terbit, `proyek-uji-${n}`,
  sumber === 'foila' ? `https://invest.lampungprov.go.id/project/proyek-uji-${n}` : null,
  sumber === 'foila' ? `proyek-uji-${n}` : null]);

try {
  wajib(await pg(`
    SET session_replication_role = replica;
    INSERT INTO auth.users(id,email,is_anonymous) VALUES
      ${peran.map((r) => `('${U[r]}','${r}@example.invalid',${['warga', 'harian', 'global', 'kedua'].includes(r)})`).join(',')};
    INSERT INTO public.layanan(id,nama,prefiks_antrean,slug,modul) VALUES
      ('${L(1)}','Investasi Uji','IV','investasi-uji','investasi'),
      ('${L(2)}','UMKM Uji','UK','umkm-uji','umkm');
    INSERT INTO public.petugas(id,auth_user_id,nama,role,layanan_id,aktif,email_notifikasi,email_notifikasi_verified_at)
      VALUES ${['admin', 'investasi', 'umkm', 'fo', 'nonaktif'].map((r) => `(
        '${P[r]}','${U[r]}','${r}','${r === 'admin' ? 'admin' : r === 'fo' ? 'front_office' : 'petugas'}',
        ${['investasi', 'nonaktif'].includes(r) ? `'${L(1)}'` : r === 'umkm' ? `'${L(2)}'` : 'NULL'},
        ${r !== 'nonaktif'},'${r}@example.invalid',now())`).join(',')};
    INSERT INTO public.investment_documents(id,judul,file_path,status) VALUES
      ('${D(1)}','Kajian Publik','pages/uji.pdf','aktif'), ('${D(2)}','Kajian Nonaktif','pages/lama.pdf','nonaktif');
    INSERT INTO public.investasi_lead(id,doc_id,nama,email,status,updated_at) VALUES
      ('${id(6, 1)}','${D(1)}','Baris Lama','lama@example.invalid?bcc=salin%40evil.example&body=','selesai',now()-interval '400 days'),
      ('${id(6, 2)}',NULL,'Aktif Lama','aktif@example.invalid','baru',now()-interval '400 days');
    SET session_replication_role = origin;
  `));
  await db.exec(readFileSync(new URL('../../supabase/migrations/202611190002_investasi_kotak_masuk.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/202611190003_investasi_dokumen_proses.sql', import.meta.url), 'utf8'));
  // Konsumsi kunci satu kali, tersimpan sebagai tombstone meskipun dokumen sudah dihapus.
  const raw = `investment-docs/raw/${U.investasi}/${D(90)}.pdf`;
  const konsumsi = (r, kunci) => user(r, 'INSERT INTO public.investment_pdf_claims(kunci) VALUES ($1) RETURNING kunci', [kunci]);
  cek('pengunggah mengonsumsi kunci sendiri', wajib(await konsumsi('investasi', raw)).rows[0]?.kunci === raw);
  galat('kunci tidak dapat dikonsumsi dua kali', await konsumsi('investasi', raw), 'duplicate key', '23505');
  galat('admin B tidak dapat mengonsumsi raw A', await konsumsi('admin', raw.replace(D(90), D(91))), 'check constraint', '23514');
  cek('admin B tidak dapat membaca klaim A', wajib(await user('admin',
    'SELECT kunci FROM public.investment_pdf_claims WHERE kunci=$1', [raw])).rows.length === 0);
  galat('pemilik tidak dapat menghapus tombstone', await user('investasi',
    'DELETE FROM public.investment_pdf_claims WHERE kunci=$1', [raw]), 'permission denied', '42501');
  galat('pemilik tidak dapat mengganti tombstone', await user('investasi',
    'UPDATE public.investment_pdf_claims SET kunci=$1 WHERE kunci=$1', [raw]), 'permission denied', '42501');
  for (const r of ['umkm', 'fo', 'nonaktif', 'warga']) {
    galat(`${r} tidak boleh mengonsumsi kunci`, await konsumsi(r, `investment-docs/raw/${U[r]}/${D(92)}.pdf`), 'row-level security', '42501');
  }
  galat('anon tidak membaca klaim unggahan', await sebagai(db, 'anon', null,
    'SELECT kunci FROM public.investment_pdf_claims'), 'permission denied', '42501');
  for (const r of ['umkm', 'fo', 'nonaktif', 'warga']) {
    galat(`${r} tidak boleh membuat dokumen`, await user(r, `INSERT INTO public.investment_documents(judul,file_path,status)
      VALUES ('Dilarang','raw/uji.pdf','diproses')`), 'row-level security', '42501');
  }
  for (const r of ['admin', 'investasi']) {
    const dok = wajib(await user(r, `INSERT INTO public.investment_documents(judul,file_path,status,jumlah_halaman)
      VALUES ('Proses Uji','raw/uji.pdf','diproses',2) RETURNING id,halaman_selesai`)).rows[0];
    cek(`${r} membuat dokumen proses mulai nol`, dok.halaman_selesai === 0);
    cek('publik tidak melihat dokumen diproses', wajib(await sebagai(db, 'anon', null,
      'SELECT id FROM public.investment_documents WHERE id=$1', [dok.id])).rows.length === 0);
    const claim = "UPDATE public.investment_documents SET diproses_pada=now() WHERE id=$1 AND diproses_pada IS NULL AND halaman_selesai=0 RETURNING id";
    cek('klaim pertama menang dan klaim kedua tidak menimpa', wajib(await user(r, claim, [dok.id])).rows.length === 1
      && wajib(await user(r, claim, [dok.id])).rows.length === 0);
    cek('DELETE dengan fence menolak lease yang sudah diklaim', wajib(await user(r,
      'DELETE FROM public.investment_documents WHERE id=$1 AND diproses_pada IS NULL RETURNING id', [dok.id])).rows.length === 0);
    wajib(await user(r, `UPDATE public.investment_documents SET halaman_selesai=1,halaman_gambar=ARRAY['pages/uji/1.png'],status='gagal',galat='Galat teknis' WHERE id=$1`, [dok.id]));
    cek('kegagalan menyimpan halaman sebelumnya', hasil(await user(r,
      "SELECT halaman_selesai=1 AND status='gagal' AS hasil FROM public.investment_documents WHERE id=$1", [dok.id])) === true);
    galat('pesan galat lebih dari 500 ditolak', await user(r,
      "UPDATE public.investment_documents SET galat=repeat('x',501) WHERE id=$1", [dok.id]), 'check constraint', '23514');
    wajib(await user(r, "DELETE FROM public.investment_documents WHERE id=$1", [dok.id]));
  }
  cek('backfill aktivitas memakai updated_at lama', hasil(await pg(`SELECT aktivitas_pada=updated_at AS hasil
    FROM public.investasi_lead WHERE id=$1`, [id(6, 1)])) === true);
  cek('baris lama otomatis kanal dokumen dan versi 1', hasil(await pg(`SELECT kanal='dokumen' AND versi=1
    AND ipro_id IS NULL AND operasi_id IS NULL AS hasil FROM public.investasi_lead WHERE id=$1`, [id(6, 1)])) === true);
  cek('migrasi mempertahankan email lama tanpa CHECK baru', hasil(await pg(`SELECT email=$2 AS hasil
    FROM public.investasi_lead WHERE id=$1`, [id(6, 1), 'lama@example.invalid?bcc=salin%40evil.example&body='])) === true);

  for (const r of ['fo', 'umkm', 'nonaktif', 'warga']) {
    galat(`${r} tidak boleh menambah proyek`, await proyek(r, 20 + peran.indexOf(r)), 'row-level security', '42501');
    cek(`${r} helper pengelola false`, hasil(await user(r, 'SELECT public.boleh_kelola_investasi() AS hasil')) === false);
  }
  const awal = wajib(await proyek('investasi', 1, 'ptsp', 'terbit')).rows[0];
  cek('petugas investasi menambah proyek terbit dengan RETURNING kolom publik',
    awal.versi === 1 && awal.diterbitkan_pada != null);
  cek('trigger tetap mengisi UUID pembuat dan pengubah', hasil(await pg(`SELECT dibuat_oleh=$2
    AND diubah_oleh=$2 AS hasil FROM public.ipro_proyek WHERE id=$1`, [I(1), P.investasi])) === true);
  cek('admin menambah draf', (await proyek('admin', 2)).ok === true);
  cek('admin menambah kartu FOILA terbit', (await proyek('admin', 3, 'foila', 'terbit')).ok === true);
  cek('admin menambah arsip', (await proyek('admin', 4, 'ptsp', 'arsip')).ok === true);
  cek('anon hanya membaca dua entri terbit', hasil(await sebagai(db, 'anon', null,
    'SELECT count(*)::int AS hasil FROM public.ipro_proyek')) === 2);
  cek('warga tidak melihat draf/arsip', hasil(await user('warga', 'SELECT count(*)::int AS hasil FROM public.ipro_proyek')) === 2);
  cek('pengelola melihat semua proyek', hasil(await user('investasi', 'SELECT count(*)::int AS hasil FROM public.ipro_proyek')) === 4);
  const bacaPublik = [
    ['anon', (sql, params) => sebagai(db, 'anon', null, sql, params)],
    ['authenticated warga', (sql, params) => user('warga', sql, params)],
    ['authenticated staf', (sql, params) => user('investasi', sql, params)],
  ];
  for (const [r, baca] of bacaPublik) {
    for (const kolom of ['dibuat_oleh', 'diubah_oleh']) {
      galat(`${r} tidak membaca ipro_proyek.${kolom}`, await baca(
        `SELECT ${kolom} FROM public.ipro_proyek WHERE id=$1`, [I(1)]), 'permission denied', '42501');
    }
    galat(`${r} SELECT * proyek sengaja ditolak`, await baca('SELECT * FROM public.ipro_proyek'), 'permission denied', '42501');
    cek(`${r} membaca kolom publik proyek`, wajib(await baca(
      'SELECT id,judul,status,versi FROM public.ipro_proyek WHERE id=$1', [I(1)])).rows[0]?.id === I(1));
  }
  galat('staf INSERT RETURNING UUID audit ditolak', await user('investasi', `INSERT INTO public.ipro_proyek
    (sumber,slug,judul,ringkasan,sektor,kab_kota) VALUES
    ('ptsp','returning-audit','Proyek Uji','Ringkasan publik','energi','Kota Bandar Lampung')
    RETURNING dibuat_oleh`), 'permission denied', '42501');
  galat('staf UPDATE RETURNING UUID audit ditolak', await user('investasi',
    "UPDATE public.ipro_proyek SET judul='Judul Baru' WHERE id=$1 RETURNING diubah_oleh", [I(1)]), 'permission denied', '42501');
  cek('staf UPDATE kolom biasa dengan RETURNING publik tetap berhasil', wajib(await user('investasi',
    'UPDATE public.ipro_proyek SET judul=judul WHERE id=$1 RETURNING id,judul', [I(1)])).rows[0]?.id === I(1));
  galat('anon tidak menulis proyek', await sebagai(db, 'anon', null,
    "UPDATE public.ipro_proyek SET judul='Terlarang'"), 'permission denied', '42501');
  cek('FO tidak mengubah proyek terbit', wajib(await user('fo',
    "UPDATE public.ipro_proyek SET judul='Terlarang' RETURNING id")).rows.length === 0);
  galat('slug unik', await user('admin', "UPDATE public.ipro_proyek SET slug='proyek-uji-1' WHERE id=$1", [I(2)]),
    'duplicate key', '23505');
  galat('slug terkunci setelah terbit', await user('admin', "UPDATE public.ipro_proyek SET slug='slug-baru' WHERE id=$1", [I(1)]),
    'SLUG_TERKUNCI', '22023');
  galat('sumber tidak boleh berubah', await user('admin', "UPDATE public.ipro_proyek SET sumber='foila' WHERE id=$1", [I(2)]),
    'INPUT_TIDAK_VALID', '22023');
  wajib(await user('admin', `UPDATE public.ipro_proyek SET status='arsip',diterbitkan_pada=NULL,
    dibuat_oleh=$2,dibuat_pada=now()-interval '20 years',versi=999 WHERE id=$1`, [I(1), P.admin]));
  cek('audit mempertahankan pembuat, tanggal terbit dan menaikkan versi', hasil(await pg(`SELECT dibuat_oleh=$2
    AND dibuat_pada>now()-interval '1 day' AND diterbitkan_pada IS NOT NULL AND versi=3
    AND diubah_oleh=$3 AS hasil FROM public.ipro_proyek WHERE id=$1`, [I(1), P.investasi, P.admin])) === true);
  galat('slug tetap terkunci setelah diarsipkan', await user('admin',
    "UPDATE public.ipro_proyek SET slug='ganti-arsip' WHERE id=$1", [I(1)]), 'SLUG_TERKUNCI', '22023');
  cek('proyek arsip tidak terhapus', wajib(await user('admin', 'DELETE FROM public.ipro_proyek WHERE id=$1 RETURNING id', [I(1)])).rows.length === 0);
  wajib(await user('admin', "UPDATE public.ipro_proyek SET status='terbit' WHERE id=$1", [I(1)]));
  cek('draf boleh dihapus', wajib(await user('admin', 'DELETE FROM public.ipro_proyek WHERE id=$1 RETURNING id', [I(2)])).rows.length === 1);
  wajib(await proyek('admin', 2));

  for (const [kolom, nilai] of [
    ['deskripsi', 'Tidak boleh menjadi detail'], ['sumber_url', null],
    ['sumber_url', 'https://invest.lampungprov.go.id.evil.invalid/project/a'],
    ['sumber_url', 'https://invest.lampungprov.go.id@evil.invalid/project/a'],
    ['sumber_url', 'https://invest.lampungprov.go.id:443/project/a'],
    ['sumber_url', 'http://invest.lampungprov.go.id/project/a'],
    ['sumber_url', 'https://invest.lampungprov.go.id/project/a b'],
    ['kontak_telepon', '+62811234567'], ['kontak_email', 'lembaga@example.invalid'],
  ]) galat(`FOILA menolak ${kolom} ${nilai}`, await user('admin',
    `UPDATE public.ipro_proyek SET ${kolom}=$2 WHERE id=$1`, [I(3), nilai]), 'ipro_sumber_sah', '23514');
  cek('FOILA menerima URL dan slug panjang serta nilai teks campuran', (await user('admin', `UPDATE public.ipro_proyek
    SET sumber_url=$2,sumber_slug=$3,nilai_teks='USD 65.08 million (approx. IDR 1.35 trillion)' WHERE id=$1`,
  [I(3), `https://invest.lampungprov.go.id/project/${'proyek-'.repeat(40)}akhir`, 'proyek-'.repeat(40) + 'akhir'])).ok === true);
  for (const [kolom, nilai] of [
    ['sektor', 'General'], ['mata_uang', 'EUR'], ['lat', '-7'], ['lat', '-5'],
    ['nilai_investasi', '-1'], ['payback_bulan', '601'],
  ]) {
    galat(`constraint ${kolom} menolak ${nilai}`, await user('admin',
      `UPDATE public.ipro_proyek SET ${kolom}=$2 WHERE id=$1`, [I(2), nilai]), 'check constraint', '23514');
  }
  cek('koordinat berpasangan dan nilai USD sah', (await user('admin', `UPDATE public.ipro_proyek
    SET lat=-5.4,lng=105.2,nilai_investasi=16270000,npv_nilai=-100000,mata_uang='USD' WHERE id=$1`, [I(2)])).ok === true);
  cek('nilai dan NPV memakai mata uang baris yang sama', hasil(await pg(`SELECT nilai_investasi=16270000
    AND npv_nilai=-100000 AND mata_uang='USD' AS hasil FROM public.ipro_proyek WHERE id=$1`, [I(2)])) === true);

  const gambar = (n, proyekId = I(1), utama = false, alt = 'Foto proyek investasi') => user('investasi', `
    INSERT INTO public.ipro_gambar(id,proyek_id,kunci,kunci_mini,lebar,tinggi,alt,utama)
    VALUES($1,$2,$3,$4,1200,800,$5,$6) RETURNING id,alt`, [id(7, n), proyekId,
    `ipro-gambar/${proyekId}/${id(7, n)}.webp`, `ipro-gambar/${proyekId}/${id(7, n)}-640.webp`, alt, utama]);
  cek('pengelola menambah gambar utama', (await gambar(1, I(1), true)).ok === true);
  cek('pengelola menambah gambar draf', (await gambar(2, I(2))).ok === true);
  galat('satu gambar utama per proyek', await gambar(3, I(1), true), 'duplicate key', '23505');
  galat('alt wajib bermakna', await gambar(4, I(1), false, ' '), 'check constraint', '23514');
  cek('anon hanya membaca gambar proyek terbit', hasil(await sebagai(db, 'anon', null,
    'SELECT count(*)::int AS hasil FROM public.ipro_gambar')) === 1);
  for (const [r, baca] of bacaPublik) {
    galat(`${r} tidak membaca ipro_gambar.dibuat_oleh`, await baca(
      'SELECT dibuat_oleh FROM public.ipro_gambar'), 'permission denied', '42501');
    galat(`${r} SELECT * gambar sengaja ditolak`, await baca('SELECT * FROM public.ipro_gambar'), 'permission denied', '42501');
    cek(`${r} membaca kolom publik gambar`, wajib(await baca(
      'SELECT id,proyek_id,alt FROM public.ipro_gambar WHERE id=$1', [id(7, 1)])).rows[0]?.id === id(7, 1));
  }
  cek('staf UPDATE gambar dengan RETURNING publik tetap berhasil', wajib(await user('investasi',
    "UPDATE public.ipro_gambar SET alt='Foto IPRO terbaru' WHERE id=$1 RETURNING id,alt", [id(7, 1)])).rows[0]?.alt === 'Foto IPRO terbaru');
  galat('staf UPDATE gambar RETURNING UUID audit ditolak', await user('investasi',
    'UPDATE public.ipro_gambar SET urutan=1 WHERE id=$1 RETURNING dibuat_oleh', [id(7, 1)]), 'permission denied', '42501');
  cek('staf DELETE gambar dengan RETURNING publik tetap berhasil', wajib(await user('investasi',
    'DELETE FROM public.ipro_gambar WHERE id=$1 RETURNING id', [id(7, 2)])).rows[0]?.id === id(7, 2));

  const data = isian();
  const terkirim = hasil(await kirim('warga', data));
  cek('RPC menghasilkan tanda terima id saja', Object.keys(terkirim).join(',') === 'id' && typeof terkirim.id === 'string');
  cek('RPC menerima email biasa', hasil(await pg('SELECT email=$2 AS hasil FROM public.investasi_lead WHERE id=$1',
    [terkirim.id, data.email])) === true);
  cek('nomor dinormalisasi dan konteks terikat', hasil(await pg(`SELECT no_hp='+628112345678'
    AND kanal='ipro' AND ipro_id=$2 AND doc_id IS NULL AND status='baru' AND versi=1
    AND petugas_id IS NULL AND catatan=$3 AS hasil FROM public.investasi_lead WHERE id=$1`,
  [terkirim.id, I(1), data.pesan])) === true);
  cek('consent tersimpan atomik dan terhubung', hasil(await pg(`SELECT c.subjek_ref=$2 AND c.tujuan='investasi_minat'
    AND c.disetujui AND c.versi_kebijakan='1.1' AS hasil FROM public.investasi_lead l
    JOIN public.consent_log c ON c.id=l.consent_id WHERE l.id=$1`, [terkirim.id, U.warga])) === true);
  cek('trigger lama mencatat satu kejadian laju', await jumlah('public.anon_rate_limit',
    "user_id=$1 AND action='investasi_lead_insert'", [U.warga]) === 1);
  cek('notifikasi hanya penerima investasi aktif terverifikasi', hasil(await pg(`SELECT count(*)=1
    AND bool_and(tujuan_email='investasi@example.invalid') AS hasil FROM public.notifikasi
    WHERE payload->>'lead_id'=$1`, [terkirim.id])) === true);
  cek('notifikasi tidak membawa PII pengirim', hasil(await pg(`SELECT bool_and(
    body NOT LIKE '%Investor Sintetis%' AND body NOT LIKE '%investor@example.invalid%'
    AND body NOT LIKE '%628112345678%' AND body NOT LIKE '%Mohon informasi%'
    AND body LIKE '%/petugas/investasi/kotak-masuk?id=%') AS hasil FROM public.notifikasi
    WHERE payload->>'lead_id'=$1`, [terkirim.id])) === true);
  const ulang = hasil(await kirim('warga', data));
  cek('idempoten mengembalikan id yang sama', ulang.id === terkirim.id);
  cek('idempoten tidak menambah consent/notifikasi/laju', await jumlah('public.consent_log', 'subjek_ref=$1', [U.warga]) === 1
    && await jumlah('public.notifikasi', "payload->>'lead_id'=$1", [terkirim.id]) === 1
    && await jumlah('public.anon_rate_limit', "user_id=$1 AND action='investasi_lead_insert'", [U.warga]) === 1);
  galat('operasi sama isi berbeda konflik', await kirim('warga', { ...data, pesan: 'Pesan berbeda tetapi operasi sama.' }), 'KONFLIK_OPERASI', '40001');
  wajib(await user('admin', "UPDATE public.ipro_proyek SET status='arsip' WHERE id=$1", [I(1)]));
  cek('retry setelah IPRO diarsipkan tetap mengembalikan id lama', hasil(await kirim('warga', data)).id === terkirim.id);
  cek('retry arsip memakai sidik isian yang dinormalisasi', hasil(await kirim('warga', {
    ...data, nama: ` ${data.nama} `, email: ` ${data.email} `, hp: '+628112345678',
    instansi: ` ${data.instansi} `, pesan: ` ${data.pesan} `, kebijakan: ' 1.1 ',
  })).id === terkirim.id);
  cek('retry arsip tidak menambah lead, consent, notifikasi atau laju',
    await jumlah('public.investasi_lead', 'aktor_uid=$1', [U.warga]) === 1
    && await jumlah('public.consent_log', 'subjek_ref=$1', [U.warga]) === 1
    && await jumlah('public.notifikasi', "payload->>'lead_id'=$1", [terkirim.id]) === 1
    && await jumlah('public.anon_rate_limit', "user_id=$1 AND action='investasi_lead_insert'", [U.warga]) === 1);
  galat('operasi baru pada IPRO arsip ditolak', await kirim('warga', isian()), 'TIDAK_DITEMUKAN', 'P0002');
  galat('operasi sama isi berbeda pada arsip tetap konflik', await kirim('warga',
    { ...data, pesan: 'Pesan berbeda ketika IPRO sudah arsip.' }), 'KONFLIK_OPERASI', '40001');
  cek('kiriman arsip ditolak tanpa memakan jatah laju', await jumlah('public.anon_rate_limit',
    "user_id=$1 AND action='investasi_lead_insert'", [U.warga]) === 1);
  wajib(await user('admin', "UPDATE public.ipro_proyek SET status='terbit' WHERE id=$1", [I(1)]));
  galat('draf bukan konteks publik', await kirim('warga', isian({ ref: I(2) })), 'TIDAK_DITEMUKAN', 'P0002');
  galat('FOILA tidak menerima pesan IPRO', await kirim('warga', isian({ ref: I(3) })), 'TIDAK_DITEMUKAN', 'P0002');
  galat('dokumen nonaktif ditolak', await kirim('warga', isian({ kanal: 'dokumen', ref: D(2) })), 'TIDAK_DITEMUKAN', 'P0002');
  for (const ubah of [{ setuju: false }, { setuju: null }, { kebijakan: '' }, { nama: null }, { email: 'buruk' },
    { hp: '1234' }, { pesan: 'pendek' }, { kanal: 'lain' }, { operasi: null }, { ref: null }, { pesan: 'x'.repeat(2001) }]) {
    galat(`validasi kiriman ${Object.keys(ubah)[0]}`, await kirim('warga', isian(ubah)), 'INPUT_TIDAK_VALID', '22023');
  }
  for (const email of [
    'investor@example.org?bcc=salin%40evil.example&body=', 'investor&salin@example.org', 'investor%40salin@example.org',
    'investor@example.org#body', 'a b@example.org', 'a,b@example.org', 'a;b@example.org', '"a"@example.org', '<a>@example.org',
    '.a@example.org', 'a..b@example.org', 'a@example..org', 'a@-example.org', 'a@example.o', 'a@example.123', 'a@example.org\n',
  ]) {
    galat(`email tidak aman ditolak: ${email}`, await kirim('warga', isian({ email })), 'INPUT_TIDAK_VALID', '22023');
  }
  cek('gagal validasi tidak membuat consent tambahan', await jumlah('public.consent_log', 'subjek_ref=$1', [U.warga]) === 1);
  galat('insert langsung ke lead ditolak', await user('warga',
    "INSERT INTO public.investasi_lead(nama,email) VALUES('Langsung','langsung@example.invalid')"), 'permission denied', '42501');
  galat('update langsung oleh admin pun ditolak', await user('admin',
    "UPDATE public.investasi_lead SET status='selesai'"), 'permission denied', '42501');
  for (const r of ['warga', 'fo', 'umkm', 'nonaktif']) {
    cek(`${r} tidak membaca isi kotak masuk`, hasil(await user(r, 'SELECT count(*)::int AS hasil FROM public.investasi_lead')) === 0);
    galat(`${r} tidak mengubah status`, await status(r, terkirim.id, 'dihubungi', 1), 'DILARANG', '42501');
  }
  cek('investasi membaca kotak masuk', hasil(await user('investasi', 'SELECT count(*)::int AS hasil FROM public.investasi_lead')) === 3);
  galat('versi lama konflik', await status('investasi', terkirim.id, 'dihubungi', 0), 'KONFLIK_VERSI', '40001');
  galat('versi null konflik', await status('investasi', terkirim.id, 'dihubungi', null), 'KONFLIK_VERSI', '40001');
  galat('status tidak sah', await status('investasi', terkirim.id, 'hapus', 1), 'INPUT_TIDAK_VALID', '22023');
  galat('lead tidak ditemukan', await status('investasi', id(9, 99), 'dihubungi', 1), 'TIDAK_DITEMUKAN', 'P0002');
  cek('petugas mengubah status dengan versi', hasil(await status('investasi', terkirim.id, 'dihubungi', 1)).versi === 2);
  cek('admin melanjutkan status', hasil(await status('admin', terkirim.id, 'selesai', 2)).versi === 3);
  cek('penangan pertama dipertahankan dan aktivitas diperbarui', hasil(await pg(`SELECT petugas_id=$2
    AND aktivitas_pada>=created_at AS hasil FROM public.investasi_lead WHERE id=$1`, [terkirim.id, P.investasi])) === true);
  cek('trigger audit status lama tetap berjalan', await jumlah('public.audit_log',
    "entitas='investasi_lead' AND entitas_id=$1 AND aksi='update_status'", [terkirim.id]) === 2);

  // Empat kiriman tambahan; kiriman keenam ditolak, retry kiriman pertama tetap berhasil.
  for (let i = 0; i < 4; i++) wajib(await kirim('warga', isian()));
  galat('batas lima kiriman per jam', await kirim('warga', isian()), 'TERLALU_BANYAK', 'P0001');
  cek('retry tidak memakan jatah laju', hasil(await kirim('warga', data)).id === terkirim.id);
  cek('batas laju tidak membuat consent', await jumlah('public.consent_log', 'subjek_ref=$1', [U.warga]) === 5);

  // Kejadian sintetis untuk mengisolasi batas harian dan global dari batas per jam.
  wajib(await pg(`INSERT INTO public.anon_rate_limit(user_id,action,created_at)
    SELECT $1::uuid,'investasi_lead_insert',now()-interval '2 hours' FROM generate_series(1,20)`, [U.harian]));
  galat('batas dua puluh kiriman per hari', await kirim('harian', isian()), 'TERLALU_BANYAK', 'P0001');
  wajib(await pg(`INSERT INTO public.anon_rate_limit(user_id,action)
    SELECT $1::uuid,'investasi_lead_insert' FROM generate_series(1,100)`, [U.global]));
  galat('batas global lintas UID', await kirim('kedua', isian()), 'TERLALU_BANYAK', 'P0001');
  wajib(await pg(`UPDATE public.anon_rate_limit SET created_at=now()-interval '25 hours'
    WHERE user_id=$1 AND action='investasi_lead_insert'`, [U.global]));

  wajib(await pg('UPDATE public.petugas SET email_notifikasi_verified_at=NULL WHERE id=$1', [P.investasi]));
  const dataDok = isian({ kanal: 'dokumen', ref: D(1), pesan: null, hp: '' });
  const dok = hasil(await kirim('kedua', dataDok));
  cek('kanal dokumen menerima pesan/nomor opsional', hasil(await pg(`SELECT kanal='dokumen' AND doc_id=$2
    AND ipro_id IS NULL AND catatan IS NULL AND no_hp IS NULL AS hasil FROM public.investasi_lead WHERE id=$1`, [dok.id, D(1)])) === true);
  cek('fallback email ke admin bila tidak ada petugas terverifikasi', hasil(await pg(`SELECT count(*)=1
    AND bool_and(tujuan_email='admin@example.invalid' AND body LIKE '%/admin/investasi-leads?id=%') AS hasil
    FROM public.notifikasi WHERE payload->>'lead_id'=$1`, [dok.id])) === true);
  wajib(await pg("UPDATE public.investment_documents SET status='nonaktif' WHERE id=$1", [D(1)]));
  cek('retry dokumen nonaktif mengembalikan id lama', hasil(await kirim('kedua', dataDok)).id === dok.id);
  galat('operasi baru pada dokumen nonaktif ditolak', await kirim('kedua',
    isian({ kanal: 'dokumen', ref: D(1) })), 'TIDAK_DITEMUKAN', 'P0002');
  galat('operasi sama isi berbeda pada dokumen nonaktif konflik', await kirim('kedua',
    { ...dataDok, nama: 'Nama Investor Berbeda' }), 'KONFLIK_OPERASI', '40001');
  cek('retry dokumen nonaktif tidak menambah lead, consent, notifikasi atau laju',
    await jumlah('public.investasi_lead', 'aktor_uid=$1', [U.kedua]) === 1
    && await jumlah('public.consent_log', 'subjek_ref=$1', [U.kedua]) === 1
    && await jumlah('public.notifikasi', "payload->>'lead_id'=$1", [dok.id]) === 1
    && await jumlah('public.anon_rate_limit', "user_id=$1 AND action='investasi_lead_insert'", [U.kedua]) === 1);
  galat('anon tanpa sesi tidak boleh memanggil RPC', await sebagai(db, 'anon', null,
    "SELECT public.investasi_ubah_status_minat(NULL,'baru',1)"), 'permission denied', '42501');
  galat('authenticated tanpa UID ditolak RPC kirim', await sebagai(db, 'authenticated', null,
    "SELECT public.investasi_kirim_minat(NULL,NULL,NULL,NULL,NULL,NULL,NULL,true,'1.1',NULL)"), 'LOGIN_DIPERLUKAN', '28000');
  galat('pengguna tidak memanggil retensi', await user('admin', 'SELECT public.investasi_bersihkan_retensi()'), 'permission denied', '42501');
  galat('service role tidak memanggil RPC publik', await sebagai(db, 'service_role', null,
    "SELECT public.investasi_ubah_status_minat(NULL,'baru',1)"), 'permission denied', '42501');
  cek('cron retensi terdaftar pukul 02:25 WIB', hasil(await pg(`SELECT count(*)::int AS hasil FROM cron.job
    WHERE jobname='investasi_retensi_harian' AND schedule='25 19 * * *'`)) === 1);

  const consentSebelum = await jumlah('public.consent_log');
  wajib(await pg(`UPDATE public.investasi_lead SET aktivitas_pada=now()-interval '366 days' WHERE id=$1`, [terkirim.id]));
  const bersih = hasil(await pg('SELECT public.investasi_bersihkan_retensi() AS hasil'));
  cek('retensi menghapus selesai lebih dari 365 hari termasuk legacy', bersih.dihapus === 2);
  cek('retensi tidak menghapus baris aktif tua', await jumlah('public.investasi_lead', 'id=$1', [id(6, 2)]) === 1);
  cek('retensi mempertahankan consent', await jumlah('public.consent_log') === consentSebelum);
  cek('retensi tidak menghapus selesai yang masih baru', hasil(await status('admin', dok.id, 'ditolak', 1)).status === 'ditolak'
    && hasil(await pg('SELECT public.investasi_bersihkan_retensi() AS hasil')).dihapus === 0);
  wajib(await pg(`UPDATE public.investasi_lead SET aktivitas_pada=now()-interval '366 days' WHERE id=$1`, [dok.id]));
  cek('retensi menghapus ditolak yang sudah tua', hasil(await pg('SELECT public.investasi_bersihkan_retensi() AS hasil')).dihapus === 1);

  // UID sintetis tanpa auth.users membuat trigger laju gagal setelah consent dan lead disisipkan.
  // Seluruh efek RPC harus dibatalkan, termasuk bukti consent yang lebih dahulu dibuat.
  const consentAtomik = await jumlah('public.consent_log');
  const uidTanpaAkun = id(0, 999);
  const dataAtomik = isian();
  const gagalAtomik = await sebagai(db, 'authenticated', uidTanpaAkun, `SELECT public.investasi_kirim_minat(
    $1,$2::uuid,$3,$4,$5,$6,$7,$8::boolean,$9,$10::uuid) AS hasil`, [dataAtomik.kanal, dataAtomik.ref,
    dataAtomik.nama, dataAtomik.email, dataAtomik.hp, dataAtomik.instansi, dataAtomik.pesan,
    dataAtomik.setuju, dataAtomik.kebijakan, dataAtomik.operasi], { is_anonymous: true });
  galat('kegagalan trigger terjadi setelah sisipan consent', gagalAtomik, 'foreign key', '23503');
  cek('kegagalan RPC membatalkan consent dan lead atomik', await jumlah('public.consent_log') === consentAtomik
    && await jumlah('public.investasi_lead', 'aktor_uid=$1', [uidTanpaAkun]) === 0);

  // Batch 500 dipastikan dengan lebih banyak baris terminal dan satu baris aktif yang sangat tua.
  wajib(await pg(`SET session_replication_role=replica;
    INSERT INTO public.investasi_lead(nama,email,status,aktivitas_pada)
      SELECT 'Retensi Sintetis','retensi@example.invalid','selesai',now()-interval '400 days'
      FROM generate_series(1,501);
    SET session_replication_role=origin;`));
  cek('retensi dibatasi 500 per batch', hasil(await pg('SELECT public.investasi_bersihkan_retensi() AS hasil')).dihapus === 500);
  cek('batch berikutnya menyelesaikan sisa satu', hasil(await pg('SELECT public.investasi_bersihkan_retensi() AS hasil')).dihapus === 1);
  cek('aktif lama tetap ada setelah semua batch', await jumlah('public.investasi_lead', 'id=$1', [id(6, 2)]) === 1);

  const emailAman = 'Investor.Uji_1+ptsp@sub.example-id.org';
  const tandaTerimaAman = hasil(await kirim('kedua', isian({ email: emailAman })));
  cek('email dengan titik, garis bawah, plus dan subdomain aman diterima RPC', hasil(await pg(
    'SELECT email=$2 AS hasil FROM public.investasi_lead WHERE id=$1', [tandaTerimaAman.id, emailAman])) === true);

  // Penguncian pembuat harus tetap menghormati aksi FK ketika akun staf dihapus.
  const dibuatSemula = hasil(await pg('SELECT dibuat_pada::text AS hasil FROM public.ipro_proyek WHERE id=$1', [I(1)]));
  wajib(await proyek('investasi', 5));
  cek('petugas pembuat sintetis boleh dihapus oleh pemilik lokal', (await pg(
    'DELETE FROM public.petugas WHERE id=$1', [P.investasi])).ok === true);
  cek('FK pembuat menjadi NULL tanpa referensi pengubah yatim', hasil(await pg(`SELECT dibuat_oleh IS NULL
    AND (diubah_oleh IS NULL OR EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.id=diubah_oleh)) AS hasil
    FROM public.ipro_proyek WHERE id=$1`, [I(1)])) === true);
  cek('kedua FK menjadi NULL bila pembuat juga pengubah terakhir', hasil(await pg(`SELECT dibuat_oleh IS NULL
    AND diubah_oleh IS NULL AS hasil FROM public.ipro_proyek WHERE id=$1`, [I(5)])) === true);
  cek('penghapusan pembuat mempertahankan waktu pembuatan', hasil(await pg(
    'SELECT dibuat_pada::text AS hasil FROM public.ipro_proyek WHERE id=$1', [I(1)])) === dibuatSemula);
  wajib(await user('admin', 'UPDATE public.ipro_proyek SET dibuat_oleh=$2 WHERE id=$1', [I(1), P.admin]));
  cek('pembuat NULL tidak dapat diisi kembali lewat UPDATE klien', hasil(await pg(
    'SELECT dibuat_oleh IS NULL AS hasil FROM public.ipro_proyek WHERE id=$1', [I(1)])) === true);

  // Paket atomik diterapkan sesudah bukti kontrak lama; seluruh data hanya di PGlite lokal.
  await db.exec(readFileSync(new URL('../../supabase/migrations/202611190005_ipro_gambar_atomik.sql', import.meta.url), 'utf8'));
  const sqlTambah = 'SELECT public.ipro_tambah_gambar($1::uuid,$2::jsonb) AS hasil';
  const sqlUbah = 'SELECT public.ipro_ubah_gambar($1::uuid,$2::uuid,$3::jsonb) AS hasil';
  const sqlHapus = 'SELECT public.ipro_hapus_gambar($1::uuid,$2::uuid) AS hasil';
  const sqlTerbit = 'SELECT public.ipro_ubah_status($1::uuid,$2,$3::integer) AS hasil';
  const isianGambar = (n, k, ubah = {}) => ({
    kunci: `ipro-gambar/${I(n)}/${id(8, k)}.webp`, kunci_mini: `ipro-gambar/${I(n)}/${id(8, k)}-640.webp`,
    lebar: 1200, tinggi: 800, alt: 'Lokasi proyek sintetis', utama: false, ...ubah,
  });
  const tambahAtomik = (n, k, ubah) => user('admin', sqlTambah, [I(n), JSON.stringify(isianGambar(n, k, ubah))]);
  const ubahAtomik = (n, gambarId, ubah) => user('admin', sqlUbah, [I(n), gambarId, JSON.stringify(ubah)]);
  const versiProyek = async n => hasil(await pg('SELECT versi AS hasil FROM public.ipro_proyek WHERE id=$1', [I(n)]));
  const utamaProyek = async n => hasil(await pg(`SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) AS hasil
    FROM public.ipro_gambar WHERE proyek_id=$1 AND utama`, [I(n)]));
  const amanTerbit = async n => hasil(await pg(`SELECT status <> 'terbit' OR EXISTS (
    SELECT 1 FROM public.ipro_gambar g WHERE g.proyek_id=p.id AND g.utama) AS hasil
    FROM public.ipro_proyek p WHERE p.id=$1`, [I(n)]));
  for (const n of [100, 101, 102, 103, 104, 105]) {
    wajib(await proyek('admin', n, n === 101 ? 'foila' : 'ptsp'));
    if (n !== 101) wajib(await user('admin', 'UPDATE public.ipro_proyek SET deskripsi=$2 WHERE id=$1', [I(n), 'Deskripsi lengkap proyek sintetis']));
  }
  const utama100 = hasil(await tambahAtomik(100, 100));
  cek('gambar pertama PTSP utama meski meminta utama false', utama100.utama === true);
  cek('RPC gambar hanya mengembalikan kolom aman', !('dibuat_oleh' in utama100) && !('dibuat_pada' in utama100));
  const kedua100 = hasil(await tambahAtomik(100, 101));
  cek('gambar kedua bukan utama tanpa permintaan', kedua100.utama === false);
  const urut = hasil(await ubahAtomik(100, kedua100.id, { urutan: 7, alt: 'Sudut terbaru' }));
  cek('ubah urutan dan metadata atomik', urut.urutan === 7 && urut.alt === 'Sudut terbaru');
  galat('ID gambar milik proyek lain ditolak', await ubahAtomik(102, utama100.id, { utama: true }), 'TIDAK_DITEMUKAN', 'P0002');
  galat('target hilang tidak menghapus utama lama', await ubahAtomik(100, id(8, 9999), { utama: true }), 'TIDAK_DITEMUKAN', 'P0002');
  cek('utama tetap setelah target hilang', JSON.stringify(await utamaProyek(100)) === JSON.stringify([utama100.id]));

  // Kegagalan terjadi saat UPDATE target, sesudah UPDATE reset sudah benar-benar berjalan.
  wajib(await pg(`CREATE FUNCTION public.uji_gagal_utama() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='${kedua100.id}'::uuid AND NEW.utama THEN
      RAISE EXCEPTION 'gagal_langkah_kedua' USING ERRCODE='23505'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER uji_gagal_utama BEFORE UPDATE ON public.ipro_gambar
      FOR EACH ROW EXECUTE FUNCTION public.uji_gagal_utama();`));
  galat('kegagalan langkah kedua tetapkan utama terpicu', await ubahAtomik(100, kedua100.id, { utama: true }), 'gagal_langkah_kedua', '23505');
  cek('rollback langkah kedua mempertahankan tepat satu utama lama',
    JSON.stringify(await utamaProyek(100)) === JSON.stringify([utama100.id]));
  wajib(await pg('DROP TRIGGER uji_gagal_utama ON public.ipro_gambar; DROP FUNCTION public.uji_gagal_utama();'));
  galat('INSERT gagal sesudah reset utama', await tambahAtomik(100, 100, { utama: true }), 'duplicate key', '23505');
  cek('INSERT gagal mempertahankan utama dan jumlah gambar',
    JSON.stringify(await utamaProyek(100)) === JSON.stringify([utama100.id]) && await jumlah('public.ipro_gambar', 'proyek_id=$1', [I(100)]) === 2);
  cek('tetapkan utama berhasil sesudah trigger uji dilepas', hasil(await ubahAtomik(100, kedua100.id, { utama: true })).utama === true);
  cek('utama baru tunggal', JSON.stringify(await utamaProyek(100)) === JSON.stringify([kedua100.id]));
  const terbit100 = hasil(await user('admin', sqlTerbit, [I(100), 'terbit', await versiProyek(100)]));
  cek('terbit via RPC tanpa UUID audit', terbit100.status === 'terbit' && !('dibuat_oleh' in terbit100) && !('diubah_oleh' in terbit100));
  galat('optimistik versi lama ditolak', await user('admin', sqlTerbit, [I(100), 'arsip', terbit100.versi - 1]), 'KONFLIK_VERSI', '40001');
  galat('utama terbit tidak bisa dinonaktifkan', await ubahAtomik(100, kedua100.id, { utama: false }), 'SYARAT_TERBIT', '23514');
  galat('utama terbit tidak bisa dihapus', await user('admin', sqlHapus, [I(100), kedua100.id]), 'SYARAT_TERBIT', '23514');
  const dihapus100 = hasil(await user('admin', sqlHapus, [I(100), utama100.id]));
  cek('hapus sekunder terbit mengembalikan kunci R2', dihapus100.kunci === utama100.kunci && dihapus100.kunci_mini === utama100.kunci_mini);
  cek('proyek tetap terbit dengan utama', await amanTerbit(100));

  for (const r of ['fo', 'umkm', 'nonaktif', 'warga']) {
    for (const [sql, params] of [
      [sqlTambah, [I(100), JSON.stringify(isianGambar(100, 999))]],
      [sqlUbah, [I(100), kedua100.id, '{"urutan":1}']], [sqlHapus, [I(100), kedua100.id]],
      [sqlTerbit, [I(100), 'arsip', terbit100.versi]],
    ]) galat(`${r} tidak mengakses RPC atomik ${sql.split('(')[0]}`, await user(r, sql, params), 'DILARANG', '42501');
  }
  galat('anon tidak menjalankan RPC definer', await sebagai(db, 'anon', null, sqlTambah,
    [I(100), JSON.stringify(isianGambar(100, 999))]), 'permission denied', '42501');
  galat('helper kekurangan bukan endpoint publik', await user('admin',
    'SELECT public.ipro_kekurangan_terbit($1)', [I(100)]), 'permission denied', '42501');
  galat('UPDATE gambar langsung ditutup', await user('admin',
    'UPDATE public.ipro_gambar SET utama=false WHERE proyek_id=$1', [I(100)]), 'permission denied', '42501');
  galat('INSERT gambar langsung ditutup', await gambar(999, I(100)), 'permission denied', '42501');
  galat('DELETE gambar langsung ditutup', await user('admin',
    'DELETE FROM public.ipro_gambar WHERE proyek_id=$1', [I(100)]), 'permission denied', '42501');
  galat('publish DML langsung juga memeriksa gambar', await user('admin',
    "UPDATE public.ipro_proyek SET status='terbit' WHERE id=$1", [I(102)]), 'SYARAT_TERBIT', '23514');
  galat('RPC publish tanpa gambar ditolak', await user('admin', sqlTerbit,
    [I(102), 'terbit', await versiProyek(102)]), 'SYARAT_TERBIT', '23514');

  // PGlite hanya punya satu koneksi: Promise.all mengirim bersamaan, mesin menserialkan transaksi.
  // Jangan memakai sebagai() serentak karena ia mengubah role/GUC koneksi yang sama.
  // Dua urutan publish/hapus diuji; kontensi antarsesi PostgreSQL nyata tetap perlu staging.
  const serentak = async daftar => {
    await db.query("SELECT set_config('app.uid',$1,false)", [U.admin]);
    await db.exec('SET ROLE authenticated');
    try {
      return await Promise.all(daftar.map(async ([sql, params]) => {
        try { return { ok: true, rows: (await db.query(sql, params)).rows }; }
        catch (error) { return { ok: false, kode: error.code, pesan: error.message }; }
      }));
    } finally { await db.exec('RESET ROLE'); await db.exec("SELECT set_config('app.uid','',false)"); }
  };
  for (let k = 0; k < 11; k++) hasil(await tambahAtomik(103, 200 + k));
  const slot = await serentak([211, 212].map(k => [sqlTambah, [I(103), JSON.stringify(isianGambar(103, k))]]));
  cek('unggah paralel slot terakhir: hanya satu lolos', slot.filter(r => r.ok).length === 1 && slot.some(r => !r.ok && r.pesan === 'KONFLIK_STATUS'));
  cek('batas gambar PTSP tepat dua belas', await jumlah('public.ipro_gambar', 'proyek_id=$1', [I(103)]) === 12);
  galat('gambar PTSP ke-13 ditolak', await tambahAtomik(103, 213), 'KONFLIK_STATUS', '23514');
  const foila = await serentak([300, 301].map(k => [sqlTambah, [I(101), JSON.stringify(isianGambar(101, k, { utama: false }))]]));
  cek('dua unggahan pertama FOILA utama false: satu lolos', foila.filter(r => r.ok).length === 1 && foila.some(r => !r.ok && r.pesan === 'KONFLIK_STATUS'));
  cek('FOILA tepat satu gambar dan satu utama', await jumlah('public.ipro_gambar', 'proyek_id=$1', [I(101)]) === 1 && (await utamaProyek(101)).length === 1);
  cek('FOILA tetap dapat terbit sesudah unggahan paralel', hasil(await user('admin', sqlTerbit,
    [I(101), 'terbit', await versiProyek(101)])).status === 'terbit');
  for (const [n, publishDulu] of [[104, true], [105, false]]) {
    const g = hasil(await tambahAtomik(n, 400 + n));
    const publish = [sqlTerbit, [I(n), 'terbit', await versiProyek(n)]];
    const hapus = [sqlHapus, [I(n), g.id]];
    const balapan = await serentak(publishDulu ? [publish, hapus] : [hapus, publish]);
    cek(`publish/hapus serentak, publish dulu=${publishDulu}: satu ditolak`, balapan.filter(r => r.ok).length === 1 && balapan.some(r => !r.ok && r.pesan === 'SYARAT_TERBIT'));
    cek(`publish/hapus tidak terbit tanpa utama, publish dulu=${publishDulu}`, await amanTerbit(n));
  }
  const gambarSebelumRollback = await jumlah('public.ipro_gambar');
  wajib(await pg(readFileSync(new URL('../../docs/rollback-ipro-gambar-atomik-202611190005.sql', import.meta.url), 'utf8')));
  galat('rollback atomik menutup RPC', await user('admin', sqlTambah,
    [I(100), JSON.stringify(isianGambar(100, 999))]), 'permission denied', '42501');
  cek('rollback atomik mempertahankan semua gambar', await jumlah('public.ipro_gambar') === gambarSebelumRollback);

  // Rollback operasional menutup akses dan RPC tanpa menghapus data.
  const rollbackInti = readFileSync(new URL('../../docs/rollback-ipro-inti-202611190001.sql', import.meta.url), 'utf8');
  galat('rollback inti menolak urutan yang salah', await pg(rollbackInti), 'Rollback Kotak Masuk Investasi');
  const dataSebelumRollback = [await jumlah('public.ipro_proyek'), await jumlah('public.investasi_lead'),
    await jumlah('public.consent_log')];
  wajib(await pg(readFileSync(new URL('../../docs/rollback-investasi-kotak-masuk-202611190002.sql', import.meta.url), 'utf8')));
  cek('rollback kotak masuk menutup RPC dan cron', hasil(await pg(`SELECT
    to_regprocedure('public.investasi_kirim_minat(text,uuid,text,text,text,text,text,boolean,text,uuid)') IS NULL
    AND to_regprocedure('public.investasi_ubah_status_minat(uuid,text,integer)') IS NULL
    AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='investasi_retensi_harian') AS hasil`)) === true);
  wajib(await pg(rollbackInti));
  galat('rollback inti menutup baca publik', await sebagai(db, 'anon', null,
    'SELECT id FROM public.ipro_proyek'), 'permission denied', '42501');
  for (const [r, baca] of bacaPublik) {
    for (const tabel of ['ipro_proyek', 'ipro_gambar']) {
      galat(`rollback mencabut hak kolom ${r} ${tabel}`, await baca(`SELECT id FROM public.${tabel}`), 'permission denied', '42501');
    }
  }
  cek('rollback mempertahankan proyek, lead dan consent', JSON.stringify(dataSebelumRollback) === JSON.stringify([
    await jumlah('public.ipro_proyek'), await jumlah('public.investasi_lead'), await jumlah('public.consent_log'),
  ]));
} finally {
  await db.close();
  ringkas();
}
