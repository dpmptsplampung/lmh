// Uji perilaku SQL UMKM tahap A, tanpa jaringan atau data nyata.
import { bukaDbPenuh, sebagai } from './harness.mjs';
import { randomUUID } from 'node:crypto';

const db = await bukaDbPenuh();
const pg = (sql, params) => sebagai(db, 'postgres', null, sql, params);
// Cacat sengaja terbatas pada database dalam proses untuk membuktikan sensitivitas uji.
if (process.argv.includes('--uji-cacat-akses')) {
  const r = await pg(`ALTER TABLE public.umkm_kontak_versi DISABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.umkm_kontak_versi TO anon, authenticated`);
  if (!r.ok) throw new Error(`Suntikan cacat akses gagal: ${r.pesan}`);
}
if (process.argv.includes('--uji-cacat-konten')) {
  const r = await pg(`CREATE OR REPLACE FUNCTION umkm_private.peringatan(p_revisi_id uuid) RETURNS jsonb LANGUAGE sql
    STABLE AS $$ SELECT '[]'::jsonb $$`);
  if (!r.ok) throw new Error(`Suntikan cacat konten gagal: ${r.pesan}`);
}
const akun = Object.fromEntries(['a','b','mati','biasa','fo','foflag','admin','adminflag','tamu','anonAuth'].map(x =>
  [x, randomUUID()]));
const pet = Object.fromEntries(['a','b','mati','biasa','fo','foflag','admin','adminflag'].map(x => [x, randomUUID()]));
const nomor = '081234567890';
const data = { nama:'Kopi Lampung', deskripsi:'Kopi pilihan', alamat:'Bandar Lampung', jenis:'produk',
  kategori:'makanan', kabupaten_kota:'Bandar Lampung', sumber:'kurasi', nomor };
const hasil = [];
function pastikan(syarat, pesan) { if (!syarat) throw new Error(pesan); }
function ok(r, konteks) { pastikan(r.ok, `${konteks}: ${JSON.stringify(r)}`); return r.rows[0]?.j; }
const rpc = (who, nama, placeholders, params) => sebagai(db, who === null ? 'anon' : 'authenticated', who === null ?
  null : akun[who], `SELECT public.${nama}(${placeholders}) AS j`, params, who === 'anonAuth' ? {is_anonymous:true} :
  undefined);
const simpan = (body = data, id = null, versi = null, op = randomUUID()) => rpc('a','umkm_simpan_profil',
  '$1::jsonb,$2::uuid,$3::uuid,$4::integer',[JSON.stringify(body),op,id,versi]);
const putus = (who,id,versi,keputusan='terbit',op=randomUUID()) => rpc(who,'umkm_putuskan_profil',
  '$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',[id,versi,op,keputusan,keputusan === 'ditolak' ? 'Tidak sesuai' :
  null]);
const ambil = (who,id,versi) => rpc(who,'umkm_ambil_tugas','$1::uuid,$2::integer,$3::uuid',[id,versi,randomUUID()]);
const publik = id => rpc(null,'umkm_profil_publik','$1::uuid',[id]);
const vis = (id,versi,aksi) => rpc('a','umkm_ubah_visibilitas','$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',[id,
  versi,randomUUID(),aksi,null]);
const buat = async (body = data) => ok(await simpan(body),'simpan profil');
const kueri = async (sql, params) => { const r = await pg(sql,params); pastikan(r.ok,JSON.stringify(r)); return r.rows;
  };
async function uji(n, label, fn) { try { await fn(); hasil.push(true); console.log(`PASS ${n} ${label}`); } catch(e) {
  hasil.push(false); console.log(`FAIL ${n} ${label}: ${e.message}`); } }

const seed = await pg(`INSERT INTO auth.users(id,email) SELECT x::uuid, x || '@example.test' FROM unnest($1::text[])
  x`,[Object.values(akun)]);
let seedPet = {ok:false,pesan:'auth fixture gagal'};
if (seed.ok) seedPet = await pg(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm) SELECT
  p::uuid,u::uuid,n,r,a,f FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::boolean[],$6::boolean[]) AS v(p,
  u,n,r,a,f)`, [
    Object.values(pet), Object.keys(pet).map(k => akun[k]), Object.keys(pet),
    ['petugas', 'petugas', 'petugas', 'petugas', 'front_office', 'front_office', 'admin', 'admin'],
    [true, true, false, true, true, true, true, true],
    [true, true, true, false, false, true, false, true],
  ]);
const siap = () => pastikan(seed.ok && seedPet.ok,`fixture: ${JSON.stringify(seedPet)}`);

// Penanda fixture diberikan melalui RPC agar tetap valid sesudah pemicu diperketat.
if (seedPet.ok) {
  for (const who of ['a', 'b', 'mati', 'adminflag']) {
    const r = await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid',
      [pet[who], true, randomUUID()]);
    if (!r.ok) seedPet = r;
  }
}

await uji('01','akses tabel profil privat dan kontak',async()=>{
  siap(); const draft = await buat(); const rejected = await buat(); ok(await putus('a',rejected.id,rejected.versi,
    'ditolak'),'tolak');
  const hidden = await buat(); const diterbitkan = ok(await putus('a',hidden.id,hidden.versi),'terbit'); ok(await
    vis(hidden.id,diterbitkan.versi,'sembunyikan'),'sembunyikan');
  for (const who of [null,'anonAuth','tamu','fo','foflag']) for (const table of ['umkm_profil','umkm_revisi',
    'umkm_foto','umkm_kontak_versi','umkm_izin','umkm_riwayat']) {
    const r = await sebagai(db,who === null?'anon':'authenticated',who===null?null:akun[who],`SELECT * FROM
      public.${table}`, undefined, who === 'anonAuth' ? {is_anonymous:true} : undefined);
    pastikan((!r.ok && r.kode === '42501') || (r.ok && r.rows.length === 0),`${who} membaca ${table}`);
  }
  for(const id of [draft.id,rejected.id,hidden.id]) { const r = await publik(id); pastikan((r.ok && !r.rows[0].j) ||
    (!r.ok && /TIDAK_DITEMUKAN/.test(r.pesan)),`publik ${id}: ${JSON.stringify(r)}`); }
});
await uji('02','nomor hanya untuk pemegang tugas',async()=>{
  siap(); const p = await buat();
  const r = await rpc('a','umkm_akses_kontak_petugas','$1::uuid',[p.id]); pastikan(ok(r,'akses pemegang')?.nomor ===
    nomor,'pemegang tidak memperoleh nomor');
  for (const who of [null,'anonAuth','tamu','b','mati','biasa','fo','foflag','admin','adminflag']) {
    const x = await rpc(who,'umkm_akses_kontak_petugas','$1::uuid',[p.id]); pastikan((!x.ok && (x.kode === '42501' ||
      /DILARANG|LOGIN_DIPERLUKAN|TIDAK_DITEMUKAN/.test(x.pesan))) || (x.ok && x.rows[0]?.j?.nomor == null),`${who}:
      ${JSON.stringify(x)}`);
    for (const table of ['umkm_profil','umkm_revisi','umkm_foto','umkm_kontak_versi','umkm_izin','umkm_riwayat']) {
      const q=await sebagai(db,who===null?'anon':'authenticated',who===null?null:akun[who],`SELECT * FROM
        public.${table}`,undefined,who==='anonAuth'?{is_anonymous:true}:undefined);
      pastikan((!q.ok && q.kode==='42501') || (q.ok && !JSON.stringify(q.rows).includes(nomor)),`${who} dapat membaca
        nomor dari ${table}`);
    }
    for (const [fn,args,params] of [['umkm_detail_tugas','$1::uuid',[p.id]],['umkm_daftar_tugas','$1::text',[null]],
      ['umkm_profil_publik','$1::uuid',[p.id]]]) {
      const q=await rpc(who,fn,args,params); pastikan((!q.ok && (q.kode === '42501' ||
        /DILARANG|LOGIN_DIPERLUKAN|TIDAK_DITEMUKAN/.test(q.pesan))) || (q.ok &&
        !JSON.stringify(q.rows).includes(nomor)),`${who} gagal pemeriksaan ${fn}`);
    }
  }
});
await uji('03','konflik versi berurutan dan pengambilalihan tercatat',async()=>{
  siap(); const p=await buat(); const pindah=ok(await ambil('b',p.id,p.versi),'ambil');
  const menang=await putus('b',p.id,pindah.versi); const kalah=await putus('a',p.id,pindah.versi);
  pastikan(menang.ok && !kalah.ok && /KONFLIK_VERSI/.test(kalah.pesan),`putusan: ${JSON.stringify({menang,kalah})}`);
  const h=await kueri('SELECT * FROM umkm_riwayat WHERE objek_id=$1::uuid',[p.id]);
    pastikan(h.some(x=>x.aktor_id===pet.b && /ambil/i.test(x.aksi)),`riwayat ambil: ${JSON.stringify(h)}`);
});
await uji('04','kontak dalam field publik menghalangi terbit',async()=>{
  siap(); for (const field of ['nama','deskripsi','foto']) {
    const d={...data,...(field==='foto'?{foto:[{asal:'eksternal',
      url:`https://example.test/${nomor}`}]}:{[field]:`Usaha ${nomor}`})};
    const p=await buat(d); const r=await putus('a',p.id,p.versi); pastikan(!r.ok && /KONTAK_PUBLIK/.test(r.pesan),
      `${field}: ${JSON.stringify(r)}`);
  }
});
await uji('05','retry identik dan konflik isi berbeda',async()=>{
  siap(); const op=randomUUID(); const a=await simpan(data,null,null,op); const b=await simpan(data,null,null,op);
    const c=await simpan({...data,nama:'Kopi Lain'},null,null,op);
  pastikan(a.ok && b.ok && JSON.stringify(a.rows)===JSON.stringify(b.rows),`retry: ${JSON.stringify({a,b})}`);
    pastikan(!c.ok && /KONFLIK_OPERASI/.test(c.pesan),`isi berbeda: ${JSON.stringify(c)}`);
  const h=await kueri('SELECT count(*)::int AS n FROM umkm_riwayat WHERE operasi_id=$1::uuid',[op]);
    pastikan(h[0].n===1,`riwayat ${h[0].n}`);
});
await uji('06','nomor baru mencabut izin dan mempertahankan riwayat',async()=>{
  siap(); const p=await buat(); const izin=ok(await rpc('a','umkm_ubah_izin','$1::uuid,$2::integer,$3::uuid,$4::text',
    [p.id,p.versi,randomUUID(),'diberikan']),'izin');
  const before=await kueri('SELECT id FROM umkm_riwayat WHERE objek_id=$1::uuid',[p.id]); ok(await simpan({...data,
    nomor:'081299998888'},p.id,izin.versi),'ubah nomor');
  const rows=await kueri('SELECT status FROM umkm_izin WHERE profil_id=$1::uuid ORDER BY dibuat_pada DESC,id DESC',
    [p.id]); const after=await kueri('SELECT id FROM umkm_riwayat WHERE objek_id=$1::uuid',[p.id]);
  pastikan(rows.some(x=>x.status==='dicabut') && before.every(x=>after.some(y=>y.id===x.id)),`izin/riwayat:
    ${JSON.stringify(rows)}`);
});
await uji('07','revisi publik dan pemulihan melalui review',async()=>{
  siap(); const p=await buat(); const diterbitkan=ok(await putus('a',p.id,p.versi),'terbit'); const awal=ok(await
    publik(p.id),'publik awal');
  pastikan(awal?.nama===data.nama && !/alamat|nomor|r2_key|memiliki_nib|petugas|staf/.test(JSON.stringify(awal)),
    `proyeksi: ${JSON.stringify(awal)}`);
  const koreksi=ok(await simpan({...data,nama:'Kopi Baru'},p.id,diterbitkan.versi),'koreksi'); const selama=ok(await
    publik(p.id),'publik selama koreksi'); pastikan(selama?.nama===data.nama,'revisi lama hilang');
  const tersembunyi=ok(await vis(p.id,koreksi.versi,'sembunyikan'),'sembunyikan'); ok(await vis(p.id,tersembunyi.versi,
    'pulihkan'),'pulihkan'); const sesudah=await publik(p.id); pastikan((sesudah.ok && !sesudah.rows[0].j) ||
    (!sesudah.ok && /TIDAK_DITEMUKAN/.test(sesudah.pesan)),`pulih langsung terbit: ${JSON.stringify(sesudah)}`);
});
await uji('08','riwayat dan audit tanpa nomor mentah',async()=>{
  siap(); await buat(); for (const table of ['umkm_riwayat','audit_log']) { const r=await kueri(`SELECT count(*)::int
    AS n FROM ${table} WHERE row_to_json(${table})::text LIKE $1`,[`%${nomor}%`]); pastikan(r[0].n===0,`${table}
    memuat nomor`); }
});
await uji('09','listing_umkm tidak berubah',async()=>{
  const sebelum=await bukaDbPenuh({sampai:'202611089999'}); const snapshot = async (d) => sebagai(d,'postgres',null,
    `SELECT 'column' AS jenis, column_name AS nama, data_type || ':' || is_nullable || ':' ||
    coalesce(column_default,'') AS isi FROM information_schema.columns WHERE table_schema='public' AND
    table_name='listing_umkm' UNION ALL SELECT 'policy',policyname,concat_ws(':',permissive,roles::text,cmd,qual,
    with_check) FROM pg_policies WHERE schemaname='public' AND tablename='listing_umkm' UNION ALL SELECT 'index',
    indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='listing_umkm' UNION ALL SELECT
    'constraint',conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.listing_umkm'::regclass
    UNION ALL SELECT 'trigger',tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE
    tgrelid='public.listing_umkm'::regclass AND NOT tgisinternal UNION ALL SELECT 'table','acl',concat_ws(':',
    relrowsecurity,relforcerowsecurity,relacl::text) FROM pg_class WHERE oid='public.listing_umkm'::regclass ORDER BY
    1,2`);
  const a=await snapshot(sebelum), b=await snapshot(db); await sebelum.close(); pastikan(a.ok && b.ok &&
    a.rows.length>0 && JSON.stringify(a.rows)===JSON.stringify(b.rows),`listing berubah: ${JSON.stringify({a,b})}`);
});
const formatKontak = [
  ['NBSP', '0812\u00a03456\u00a07890'],
  ['en dash', '0812–3456–7890'],
  ['baris baru', '0812\n3456\n7890'],
  ['tab', '0812\t3456\t7890'],
  ['zero width', '0812\u200b3456\u200b7890'],
  ['garis bawah', '0812_3456_7890'],
  ['koma', '0812,3456,7890'],
  ['angka lebar penuh', '０８１２３４５６７８９０'],
  ['angka Arab', '٠٨١٢٣٤٥٦٧٨٩٠'],
  ['angka Devanagari', '०८१२३४५६७८९०'],
  ['URL persen', 'https://example.test/%30%38%31%32%33%34%35%36%37%38%39%30'],
  ['wa.link', 'https://wa.link/contoh'],
  ['t.me', 'https://t.me/contoh'],
  ['linktr.ee', 'https://linktr.ee/contoh'],
  ['titik berspasi', 'wa . link/contoh'],
];
for (const [label, nilai] of formatKontak) {
  await uji('10', `kontak ${label} diblokir`, async () => {
    siap();
    const p = await buat({ ...data, deskripsi: `Hubungi ${nilai}` });
    const r = await putus('a', p.id, p.versi);
    pastikan(!r.ok && /KONTAK_PUBLIK/.test(r.pesan), JSON.stringify(r));
  });
  await uji('11', `alasan ${label} ditolak`, async () => {
    siap();
    const p = await buat();
    const r = await rpc('a', 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',
      [p.id, p.versi, randomUUID(), 'ditolak', `Hubungi ${nilai}`]);
    pastikan(!r.ok && /INPUT_TIDAK_VALID/.test(r.pesan), JSON.stringify(r));
  });
}
await uji('12', 'Instagram berisi nomor diblokir', async () => {
  const p = await buat({ ...data, instagram: 'https://instagram.com/081234567890' });
  const r = await putus('a', p.id, p.versi);
  pastikan(!r.ok && /KONTAK_PUBLIK/.test(r.pesan), JSON.stringify(r));
});
for (const nilai of ['Rp 10.000.000', 'Rp 1.000.000.000', 'sejak 2010',
  'foto_1699999999.jpg', 'kode pos 35141', 'NIB 1234567890123']) {
  await uji('13', `teks wajar ${nilai} dapat terbit`, async () => {
    const p = await buat({ ...data, deskripsi: nilai });
    ok(await putus('a', p.id, p.versi), nilai);
  });
}
await uji('14', 'nomor di alamat tidak memblokir terbit', async () => {
  const p = await buat({ ...data, alamat: `Alamat ${nomor}` });
  ok(await putus('a', p.id, p.versi), 'terbit alamat');
});
await uji('15', 'admin tidak mengaktifkan penanda diri sendiri', async () => {
  const r = await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid',
    [pet.admin, true, randomUUID()]);
  pastikan(!r.ok && /DILARANG/.test(r.pesan), JSON.stringify(r));
});
await uji('16', 'UPDATE langsung penanda ditolak', async () => {
  const r = await sebagai(db, 'postgres', akun.admin,
    'UPDATE public.petugas SET pemeriksa_umkm=true WHERE id=$1::uuid', [pet.biasa]);
  pastikan(!r.ok, JSON.stringify(r));
});
await uji('17', 'INSERT FO memaksa penanda false', async () => {
  const id = randomUUID();
  const user = randomUUID();
  await kueri("INSERT INTO auth.users(id,email) VALUES ($1::uuid,$2)", [user, `${user}@example.test`]);
  const rows = await kueri(`INSERT INTO public.petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm)
    VALUES ($1::uuid,$2::uuid,'FO baru','front_office',true,true) RETURNING pemeriksa_umkm`, [id, user]);
  pastikan(rows[0].pemeriksa_umkm === false, JSON.stringify(rows));
});
await uji('18', 'ganti auth mengosongkan dan mencatat penanda', async () => {
  const user = randomUUID();
  await kueri('INSERT INTO auth.users(id,email) VALUES ($1::uuid,$2)', [user, `${user}@example.test`]);
  const rows = await kueri('UPDATE public.petugas SET auth_user_id=$1::uuid WHERE id=$2::uuid RETURNING *',
    [user, pet.b]);
  pastikan(rows[0].pemeriksa_umkm === false, 'penanda tetap aktif');
  const audit = await
    kueri("SELECT nilai_lama,nilai_baru FROM public.audit_log WHERE entitas='petugas' AND entitas_id=$1", [pet.b]);
  pastikan(audit.some(x => x.nilai_lama?.auth_user_id === akun.b && x.nilai_baru?.auth_user_id === user &&
    x.nilai_lama?.pemeriksa_umkm === true && x.nilai_baru?.pemeriksa_umkm === false), JSON.stringify(audit));
});
await uji('20', 'pemegang profil terbit tidak dapat membaca nomor', async () => {
  const p = await buat();
  ok(await putus('a', p.id, p.versi), 'terbit');
  const r = await rpc('a', 'umkm_akses_kontak_petugas', '$1::uuid', [p.id]);
  pastikan(!r.ok && /DILARANG/.test(r.pesan), JSON.stringify(r));
});
await uji('21', 'service_role tanpa hak enam tabel', async () => {
  for (const table of ['umkm_profil', 'umkm_revisi', 'umkm_foto', 'umkm_kontak_versi', 'umkm_izin', 'umkm_riwayat']) {
    for (const hak of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const rows = await kueri('SELECT has_table_privilege($1,$2,$3) AS boleh', ['service_role', `public.${table}`,
        hak]);
      pastikan(!rows[0].boleh, `${table} ${hak}`);
    }
  }
});
await uji('22', 'pencabutan izin tidak membuat mendesak', async () => {
  const p = await buat();
  const r = ok(await rpc('a', 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
    [p.id, p.versi, randomUUID(), 'dicabut']), 'cabut');
  const rows = await kueri('SELECT mendesak FROM public.umkm_profil WHERE id=$1::uuid', [r.id]);
  pastikan(rows[0].mendesak === false, JSON.stringify(rows));
});
await uji('23', 'foto tersembunyi tidak memblokir terbit', async () => {
  const p = await buat({ ...data, foto: [{ asal: 'eksternal', url: `https://example.test/${nomor}` }] });
  const foto = await kueri('SELECT id FROM public.umkm_foto WHERE revisi_id=$1::uuid', [p.revisi_id]);
  const tersembunyi = ok(await rpc('a', 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',
    [p.id, p.versi, randomUUID(), 'sembunyikan', foto[0].id]), 'sembunyikan foto');
  ok(await putus('a', p.id, tersembunyi.versi), 'terbit');
});
for (const who of ['a', 'fo', 'tamu', 'admin', null]) {
  await uji('24', `pencarian peran ${who}`, async () => {
    const r = await rpc(who, 'umkm_cari_profil', '$1::text,$2::uuid', ['Kopi', null]);
    if (who === 'a') ok(r, 'pencarian pemeriksa');
    else pastikan(!r.ok && (r.kode === '42501' || /DILARANG|LOGIN_DIPERLUKAN/.test(r.pesan)),
      `${who}: ${JSON.stringify(r)}`);
  });
}
await uji('25', 'pencarian minimal dua karakter', async () => {
  const r = await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid', ['x', null]);
  pastikan(!r.ok && /INPUT_TIDAK_VALID/.test(r.pesan), JSON.stringify(r));
});
await uji('25b', 'pencarian maksimal 200 karakter', async () => {
  const r = await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid', ['x'.repeat(201), null]);
  pastikan(!r.ok && /INPUT_TIDAK_VALID/.test(r.pesan), JSON.stringify(r));
});
await uji('26', 'pencarian semua status, nama revisi terakhir, dan wildcard literal', async () => {
  const nama = `UjiCari${randomUUID().slice(0, 8)}`;
  const draft = await buat({ ...data, nama });
  const terbit = await buat({ ...data, nama });
  const t = ok(await putus('a', terbit.id, terbit.versi), 'terbit');
  const tersembunyi = await buat({ ...data, nama });
  const h = ok(await putus('a', tersembunyi.id, tersembunyi.versi), 'terbit untuk sembunyi');
  ok(await vis(tersembunyi.id, h.versi, 'sembunyikan'), 'sembunyikan');
  const ditolak = await buat({ ...data, nama });
  ok(await putus('a', ditolak.id, ditolak.versi, 'ditolak'), 'tolak');
  ok(await simpan({ ...data, nama: `${nama} Koreksi` }, terbit.id, t.versi), 'koreksi');
  const hasilCari = ok(await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid',
    [` ${nama.toLowerCase()} `, null]), 'cari');
  for (const id of [draft.id, terbit.id, tersembunyi.id, ditolak.id]) {
    pastikan(hasilCari.items.some(x => x.id === id), `tidak ditemukan ${id}`);
  }
  pastikan(hasilCari.items.find(x => x.id === terbit.id)?.nama === `${nama} Koreksi`, 'bukan revisi terakhir');
  for (const wildcard of ['%', '_']) {
    const literal = ok(await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid',
      [`${nama}${wildcard}`, null]), 'literal');
    pastikan(literal.items.length === 0, JSON.stringify(literal));
  }
});
await uji('27', 'pencarian dibatasi 20 dan cursor eksklusif berdasarkan id', async () => {
  const nama = `Halaman${randomUUID().slice(0, 8)}`;
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push((await buat({ ...data, nama })).id);
  ids.sort();
  const halaman1 = ok(await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid', [nama, null]), 'halaman 1');
  pastikan(JSON.stringify(halaman1.items.map(x => x.id)) === JSON.stringify(ids.slice(0, 20)),
    JSON.stringify(halaman1));
  pastikan(halaman1.next_cursor === ids[19], JSON.stringify(halaman1));
  const halaman2 = ok(await rpc('a', 'umkm_cari_profil', '$1::text,$2::uuid',
    [nama, halaman1.next_cursor]), 'halaman 2');
  pastikan(JSON.stringify(halaman2.items.map(x => x.id)) === JSON.stringify(ids.slice(20)) &&
    halaman2.next_cursor === null, JSON.stringify(halaman2));
});
await uji('28', 'profil tersembunyi keluar dari antrean', async () => {
  const p = await buat();
  const terbit = ok(await putus('a', p.id, p.versi), 'terbit');
  ok(await vis(p.id, terbit.versi, 'sembunyikan'), 'sembunyikan');
  let cursor = null;
  do {
    const daftar = ok(await rpc('a', 'umkm_daftar_tugas', '$1::text', [cursor]), 'antrean');
    pastikan(!daftar.items.some(x => x.id === p.id), JSON.stringify(daftar));
    cursor = daftar.next_cursor;
  } while (cursor);
});
await uji('29', 'mendesak mempertahankan akses nomor dan izin tidak mengubahnya', async () => {
  const p = await buat();
  const terbit = ok(await putus('a', p.id, p.versi), 'terbit');
  await kueri('UPDATE public.umkm_profil SET mendesak=true WHERE id=$1::uuid', [p.id]);
  const kontak = ok(await rpc('a', 'umkm_akses_kontak_petugas', '$1::uuid', [p.id]), 'akses mendesak');
  pastikan(kontak.nomor === nomor, JSON.stringify(kontak));
  ok(await rpc('a', 'umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text',
    [p.id, terbit.versi, randomUUID(), 'diberikan']), 'izin');
  const rows = await kueri('SELECT mendesak FROM public.umkm_profil WHERE id=$1::uuid', [p.id]);
  pastikan(rows[0].mendesak === true, JSON.stringify(rows));
});
await uji('30', 'admin boleh menonaktifkan penanda diri sendiri', async () => {
  const r = await rpc('adminflag', 'umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid',
    [pet.adminflag, false, randomUUID()]);
  pastikan(ok(r, 'nonaktifkan sendiri').pemeriksa_umkm === false, JSON.stringify(r));
});
await uji('31', 'perubahan role mengosongkan penanda dan tercatat', async () => {
  const user = randomUUID();
  const id = randomUUID();
  await kueri('INSERT INTO auth.users(id,email) VALUES ($1::uuid,$2)', [user, `${user}@example.test`]);
  await kueri(`INSERT INTO public.petugas(id,auth_user_id,nama,role,aktif)
    VALUES ($1::uuid,$2::uuid,'Tes','petugas',true)`,
    [id, user]);
  ok(await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid',
    [id, true, randomUUID()]), 'aktifkan');
  const rows = await kueri("UPDATE public.petugas SET role='admin' WHERE id=$1::uuid RETURNING pemeriksa_umkm", [id]);
  pastikan(rows[0].pemeriksa_umkm === false, JSON.stringify(rows));
  const audit = await kueri("SELECT nilai_lama,nilai_baru FROM audit_log WHERE entitas='petugas' AND entitas_id=$1",
    [id]);
  pastikan(audit.some(x => x.nilai_lama?.role === 'petugas' && x.nilai_baru?.role === 'admin' &&
    x.nilai_lama?.pemeriksa_umkm === true && x.nilai_baru?.pemeriksa_umkm === false), JSON.stringify(audit));
});
await uji('19', 'ganti layanan mempertahankan penanda', async () => {
  const id = randomUUID();
  await kueri('INSERT INTO public.layanan(id,nama) VALUES ($1::uuid,$2)', [id, id]);
  const rows = await kueri('UPDATE public.petugas SET layanan_id=$1::uuid WHERE id=$2::uuid RETURNING pemeriksa_umkm',
    [id, pet.a]);
  pastikan(rows[0].pemeriksa_umkm === true, JSON.stringify(rows));
});
console.log(`\n${hasil.filter(Boolean).length} PASS, ${hasil.filter(x=>!x).length} FAIL`);
console.log('Butir 03 menguji versi berurutan; uji dua koneksi dipindahkan ke tiket 10.');
process.exitCode = hasil.every(Boolean) ? 0 : 1;
await db.close();
