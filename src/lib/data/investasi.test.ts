// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buatSupabaseTiruan, ID, LAIN_ID, isianProyek } from '@/app/api/admin/ipro/uji-fixture';
import { buatIpro, daftarDokumenAktif, daftarIproKelola, daftarIproTerbit, daftarMinat, gambarUntukProyek,
  iproKelolaById, iproTerbitBySlug, minatById, ubahGambar, ubahIpro, ubahStatusMinat } from './investasi';
let t: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { t = buatSupabaseTiruan(); });
it('daftar publik hanya terbit dengan batas 200 dan gambar eksplisit', async () => {
  expect((await daftarIproTerbit(t.sb)).data).toEqual([]);
  t.state.tabel.ipro_proyek[0].status = 'terbit';
  expect((await daftarIproTerbit(t.sb)).data).toHaveLength(1);
  expect(t.state.catatan.at(-1)?.langkah).toContainEqual(['limit', 200]);
  expect((await gambarUntukProyek(t.sb, [ID])).data).toHaveLength(1);
  const jumlah = t.state.catatan.length;
  expect((await gambarUntukProyek(t.sb, [])).data).toEqual([]);
  expect(t.state.catatan).toHaveLength(jumlah);
});
it('detail publik mengecualikan draf dan FOILA, detail pengelola memuat gambar', async () => {
  expect((await iproTerbitBySlug(t.sb, 'energi-lampung')).data).toBeNull();
  expect((await iproKelolaById(t.sb, ID)).data?.gambar).toHaveLength(1);
  t.state.tabel.ipro_proyek[0].status = 'terbit';
  expect((await iproTerbitBySlug(t.sb, 'energi-lampung')).data?.id).toBe(ID);
  t.state.tabel.ipro_proyek[0].sumber = 'foila';
  expect((await iproTerbitBySlug(t.sb, 'energi-lampung')).data).toBeNull();
});
it('paginasi pengelola berbatas, pencarian meng-escape wildcard', async () => {
  const r = await daftarIproKelola(t.sb, { cari: '100%_\\', dari: 0, sampai: 9 });
  expect(r.count).toBe(1);
  expect(t.state.catatan[0].langkah).toContainEqual(['ilike', 'judul', '%100\\%\\_\\\\%']);
  expect((await daftarIproKelola(t.sb, { dari: 0, sampai: 100 })).error?.message).toBe('INPUT_TIDAK_VALID');
});
it('kotak masuk daftar tanpa email, detail dengan kontak, mutasi hanya RPC', async () => {
  await daftarMinat(t.sb, { kanal: 'ipro', status: 'baru', dari: 0, sampai: 49 });
  const kolom = t.state.catatan[0].langkah.find(x => x[0] === 'select')?.[1] as string;
  expect(kolom).not.toMatch(/email|no_hp|aktor_uid|sidik/);
  await minatById(t.sb, ID);
  const detail = t.state.catatan[1].langkah.find(x => x[0] === 'select')?.[1] as string;
  expect(detail).toContain('email, no_hp');
  const r = await ubahStatusMinat(t.sb, ID, 'dihubungi', 1);
  expect(r.data).toEqual({ id: ID, status: 'dihubungi', versi: 2 });
  expect(t.state.rpc).toContainEqual({ nama: 'investasi_ubah_status_minat', args: { p_id: ID, p_status: 'dihubungi', p_versi: 1 } });
});
it('pencarian kotak masuk dikirim sebagai tiga nilai ilike terkutip sebelum paginasi', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'lead-email' }]), {
    headers: { 'Content-Type': 'application/json', 'Content-Range': '25-25/26' },
  }));
  const sb = createClient('https://lokal.test', 'anon-uji', { global: { fetch }, auth: { persistSession: false } });
  const r = await daftarMinat(sb, { cari: '  nama,email(PT) "100%_\\"  ', kanal: 'ipro', status: 'baru', dari: 25, sampai: 49 });
  expect(r.error).toBeNull();
  expect(r.data).toEqual([{ id: 'lead-email' }]);
  expect(r.count).toBe(26);
  const url = new URL(fetch.mock.calls[0][0]);
  const nilai = '"%nama,email(PT) \\"100\\\\%\\\\_\\\\\\\\\\"%"';
  expect(url.searchParams.get('or')).toBe(`(nama.ilike.${nilai},email.ilike.${nilai},instansi.ilike.${nilai})`);
  expect(url.searchParams.get('kanal')).toBe('eq.ipro');
  expect(url.searchParams.get('status')).toBe('eq.baru');
  expect(url.searchParams.get('offset')).toBe('25');
  expect(url.searchParams.get('limit')).toBe('25');
});
it.each(['a'.repeat(201), 'nama\u0000', '*'])('pencarian tidak sah ditolak sebelum query: %s', async cari => {
  expect((await daftarMinat(t.sb, { cari, dari: 0, sampai: 24 })).error?.message).toBe('INPUT_TIDAK_VALID');
  expect(t.state.catatan).toHaveLength(0);
});
it('pencarian kosong tidak menambahkan ekspresi or', async () => {
  await daftarMinat(t.sb, { cari: '  ', dari: 0, sampai: 24 });
  expect(t.state.catatan[0].langkah.some(([nama]) => nama === 'or')).toBe(false);
});
it('bentrok versi dibedakan dari proyek tidak ditemukan', async () => {
  expect((await ubahIpro(t.sb, ID, { versi: 2, judul: 'Baru' })).error?.message).toBe('KONFLIK_VERSI');
  expect((await ubahIpro(t.sb, LAIN_ID, { versi: 1, judul: 'Baru' })).error?.message).toBe('TIDAK_DITEMUKAN');
});
it('slug bentrok dicoba ulang dan kartu FOILA dinormalisasi', async () => {
  const r = await buatIpro(t.sb, { ...isianProyek, sumber: 'ptsp' });
  expect(r.data?.slug).toBe('energi-lampung-2');
  const f = await buatIpro(t.sb, { ...isianProyek, judul: 'Pelabuhan', sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/project/pelabuhan/' });
  expect(f.data?.sumber_slug).toBe('pelabuhan');
});
it('semua kueri memakai kolom eksplisit dan dokumen dibatasi', async () => {
  await daftarDokumenAktif(t.sb, 9999);
  expect(t.state.catatan.at(-1)?.langkah).toContainEqual(['limit', 200]);
  for (const q of t.state.catatan) for (const [metode, kolom] of q.langkah) if (metode === 'select') expect(kolom).not.toBe('*');
});
it('perubahan utama memakai satu RPC tanpa reset terpisah dari klien', async () => {
  await ubahGambar(t.sb, ID, LAIN_ID, { utama: true, urutan: 2 });
  expect(t.state.rpc).toContainEqual({ nama: 'ipro_ubah_gambar', args: {
    p_proyek_id: ID, p_gambar_id: LAIN_ID, p_data: { utama: true, urutan: 2 },
  } });
  expect(t.state.catatan).toHaveLength(0);
});
it('daftar pengelola mengambil batas maksimum ditambah satu agar anomali tidak tersembunyi', async () => {
  const awal = t.state.tabel.ipro_gambar[0];
  t.state.tabel.ipro_gambar = Array.from({ length: 13 }, (_, i) => ({ ...awal, id: String(i) }));
  expect((await iproKelolaById(t.sb, ID)).data?.gambar).toHaveLength(13);
});

it('memetakan dokumen lama tanpa membocorkan kunci halaman atau menebak mata uang', async () => {
  const { dokumenPublik } = await import('./investasi');
  expect(dokumenPublik({
    id: ID, judul: 'Lampung', kategori: ' peta-potensi ', deskripsi: null,
    nilai_investasi: 'Rp 2,4 Triliun', jumlah_halaman: 17, urutan_tampil: 4,
    halaman_gambar: ['pages/1.png', 'pages/2.png', null, 'pages/4.png'],
  })).toEqual({
    id: ID, judul: 'Lampung', kategori: 'Peta Potensi', deskripsi: null,
    nilai_investasi: 'Rp 2,4 Triliun', mata_uang: 'IDR', jumlah_halaman: 2, urutan_tampil: 4,
    sampul: `/api/investment-docs/page-image?doc_id=${ID}&page=1&varian=sampul`, sorotan: true,
  });
});
