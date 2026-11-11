// Kesetaraan umkm_cari_katalog (202611100003, "lama") vs (202611110003, "baru"): hasil dan URUTAN harus identik.
// Data sintetis, PGlite dalam proses. Indeks trigram dibuat migrasi; pada data sekecil ini planner tidak
// memakainya, jadi skenario ini memeriksa kesetaraan hasil dan keberadaan indeks, bukan rencana eksekusi.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { bukaDbPenuh, sebagai, cek, ringkas } from './harness.mjs';

const db = await bukaDbPenuh();
const sql = async (teks, params = []) => {
  const r = await sebagai(db, 'postgres', null, teks, params);
  if (!r.ok) throw new Error(`${r.kode}: ${r.pesan}`);
  return r.rows;
};
const petugas = randomUUID();

try {
  // Salin definisi lama apa adanya dengan nama lain agar dapat dibandingkan berdampingan.
  const lama = readFileSync('supabase/migrations/202611100003_umkm_produk_baca.sql', 'utf8').replace(/\r\n/g, '\n');
  const blok = lama.match(/CREATE OR REPLACE FUNCTION public\.umkm_cari_katalog\([\s\S]*?END \$\$;/)?.[0];
  if (!blok) throw new Error('definisi lama tidak ditemukan');
  await db.exec(blok.replace('public.umkm_cari_katalog(', 'public.umkm_cari_katalog_lama('));

  await sql("INSERT INTO auth.users(id) VALUES ($1)", [randomUUID()]);
  await sql("INSERT INTO petugas(id,auth_user_id,nama,role,aktif) VALUES ($1,$2,'Admin','admin',true)",
    [petugas, (await sql('SELECT id FROM auth.users LIMIT 1'))[0].id]);

  // 70 profil terbit: variasi jenis, kategori, spesifik, kabupaten, tanggal terbit (sebagian <30 hari), produk.
  const jenis = ['produk', 'jasa'];
  const kategori = ['pangan', 'kriya', 'fesyen', 'agro'];
  const spesifik = ['kopi robusta', 'keripik pisang', 'tapis', 'kain%ajaib', 'sambal_terasi', 'madu hutan', null];
  const kab = ['Lampung', 'Pesawaran', 'Metro'];
  const nProfil = 70;
  for (let i = 0; i < nProfil; i++) {
    const pid = randomUUID();
    const rid = randomUUID();
    const hari = i % 9 === 0 ? 2 : 40 + i; // beberapa baru (slot baru), selebihnya lama
    await sql(`INSERT INTO umkm_profil(id,sumber,status,terbit_pada)
      VALUES ($1,'kurasi','terbit',now()-($2||' days')::interval)`, [pid, String(hari)]);
    await sql(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,spesifik,kabupaten_kota,
      keputusan,dibuat_oleh) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,'terbit',$9)`,
    [rid, pid, `Usaha ${i} ${i % 5 === 0 ? 'Kopi' : 'Lain'}`, `Deskripsi ${i} ${i % 4 === 0 ? 'berbahan singkong' : 'umum'} 100%`,
      jenis[i % 2], kategori[i % 4], spesifik[i % spesifik.length], kab[i % 3], petugas]);
    await sql('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1', [pid, rid]);
    const produk = [['Kopi bubuk', 'Keripik singkong', 'Tenun tapis', 'Gula aren'][i % 4], i % 3 === 0 ? 'Teh herbal' : null].filter(Boolean);
    for (let u = 0; u < produk.length; u++) {
      await sql('INSERT INTO umkm_produk(revisi_id,urutan,nama) VALUES ($1,$2,$3)', [rid, u + 1, produk[u]]);
    }
  }

  const idx = await sql("SELECT indexname FROM pg_indexes WHERE indexname IN ('umkm_katalog_spesifik','umkm_katalog_kategori','umkm_produk_nama_trgm')");
  cek('tiga indeks trigram baru ada', idx.length === 3, JSON.stringify(idx));

  async function halaman(fn, args, cursor) {
    const r = await sebagai(db, 'anon', null,
      `SELECT public.${fn}($1,$2,$3,$4,$5,'paling_sesuai',$6) AS j`, [...args, cursor]);
    if (!r.ok) throw new Error(`${fn}: ${r.pesan}`);
    return r.rows[0].j;
  }
  async function semua(fn, args) {
    const ids = [];
    let cursor = null;
    for (let n = 0; n < 20; n++) {
      const j = await halaman(fn, args, cursor);
      ids.push(...j.items.map((x) => x.id));
      cursor = j.next_cursor;
      if (!cursor) break;
    }
    return ids;
  }

  // [q, jenis, kategori, spesifik, kabupaten]
  const kasus = [
    [null, null, null, null, null],
    ['kopi', null, null, null, null],
    ['KOPI', null, null, null, null],
    ['singkong', null, null, null, null],
    ['tapis', null, null, null, null],
    ['teh', null, null, null, null],
    ['100%', null, null, null, null],
    ['%', null, null, null, null],
    ['_', null, null, null, null],
    ['kain%ajaib', null, null, null, null],
    ['sambal_', null, null, null, null],
    ['usaha 1', null, null, null, null],
    ['pangan', null, null, null, null],
    ['tidakadasamasekali', null, null, null, null],
    ['k', null, null, null, null], // < 2 huruf = tanpa q
    ['kopi', 'produk', null, null, null],
    ['kopi', null, 'pangan', null, null],
    ['gula', null, null, 'kopi robusta', null],
    ['usaha', null, null, null, 'Metro'],
    [null, 'jasa', 'kriya', null, 'Lampung'],
  ];
  for (const k of kasus) {
    const a = await semua('umkm_cari_katalog_lama', k);
    const b = await semua('umkm_cari_katalog', k);
    cek(`setara (urutan sama) ${JSON.stringify(k)} n=${a.length}`,
      a.length === b.length && a.every((v, i) => v === b[i]), `lama=${a.length} baru=${b.length}`);
  }

  // Halaman pertama persis sama (termasuk isi kartu), dan kursor lama diterima fungsi baru (kursor tak berubah).
  const p1l = await halaman('umkm_cari_katalog_lama', ['kopi', null, null, null, null], null);
  const p1b = await halaman('umkm_cari_katalog', ['kopi', null, null, null, null], null);
  cek('halaman pertama identik (kartu penuh)', JSON.stringify(p1l.items) === JSON.stringify(p1b.items));
  cek('next_cursor ada di keduanya atau tidak sama sekali', Boolean(p1l.next_cursor) === Boolean(p1b.next_cursor));
  if (p1l.next_cursor) {
    const l2 = await halaman('umkm_cari_katalog_lama', ['kopi', null, null, null, null], p1l.next_cursor);
    const b2 = await halaman('umkm_cari_katalog', ['kopi', null, null, null, null], p1l.next_cursor);
    cek('halaman 2 dari kursor yang sama identik', JSON.stringify(l2.items) === JSON.stringify(b2.items));
  }
  const tot = (await semua('umkm_cari_katalog', ['kopi', null, null, null, null])).length;
  cek('data uji cukup besar untuk lebih dari satu halaman', tot > 20, `n=${tot}`);

  // Hak akses sama: anon & authenticated bisa memanggil; fungsi baru tidak menambah hak.
  const hak = await sql(`SELECT has_function_privilege('anon','public.umkm_cari_katalog(text,text,text,text,text,text,text)','EXECUTE') a,
    (SELECT prosecdef FROM pg_proc WHERE oid='public.umkm_cari_katalog(text,text,text,text,text,text,text)'::regprocedure) d`);
  cek('anon masih punya EXECUTE dan SECURITY DEFINER', hak[0].a === true && hak[0].d === true, JSON.stringify(hak));
} finally {
  await db.close();
}
ringkas();
