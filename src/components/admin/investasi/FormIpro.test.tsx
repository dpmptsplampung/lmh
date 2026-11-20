// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  replace: vi.fn(), push: vi.fn(), toast: vi.fn(), muat: vi.fn(), dokumen: vi.fn(), unggah: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: h.push }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/storage/unggah', () => ({ unggahKeR2: h.unggah }));
vi.mock('@/lib/data/investasi', async (impor) => ({
  ...(await impor<typeof import('@/lib/data/investasi')>()), daftarDokumenAktif: h.dokumen,
}));

import FormIpro from './FormIpro';

const ID = '3f2b9c1e-1111-4222-8333-444455556666';
const GID = '7a7a7a7a-1111-4222-8333-444455556666';
const proyek = (o: Record<string, unknown> = {}) => ({
  id: ID, sumber: 'ptsp', status: 'draf', slug: 'kawasan', judul: 'Kawasan Industri Tanggamus', judul_en: null, ringkasan: 'Ringkasan proyek.',
  ringkasan_en: null, sektor: 'industri', kab_kota: 'Kab. Tanggamus', nilai_investasi: 1500000000, mata_uang: 'IDR', nilai_teks: null,
  irr_persen: 12.5, tahap_kajian: 'fs', sumber_url: null, urutan: 0, diterbitkan_pada: null, deskripsi: 'Deskripsi proyek.', deskripsi_en: null,
  lokasi_teks: null, lat: null, lng: null, pemilik: null, npv_nilai: null, payback_bulan: 30, skema: null, status_lahan: null, luas_ha: null,
  perizinan: null, dokumen_id: null, kontak_instansi: null, kontak_email: null, kontak_telepon: null, diubah_pada: '2026-11-18T03:00:00Z',
  sumber_slug: null, versi: 3, dibuat_pada: '2026-11-10T03:00:00Z', ...o,
});
const gambar = (o: Record<string, unknown> = {}) => ({
  id: GID, proyek_id: ID, kunci: `ipro-gambar/${ID}/${GID}.webp`, kunci_mini: `ipro-gambar/${ID}/${GID}-640.webp`, lebar: 1600, tinggi: 900,
  url: 'https://gambar.test/proyek.webp', url_mini: 'https://gambar.test/proyek-mini.webp',
  alt: 'Lahan kawasan dari udara', alt_en: null, keterangan: null, keterangan_en: null, utama: true, urutan: 0, ...o,
});
const muat = (p: Record<string, unknown>, g: unknown[] = []) => h.muat.mockImplementation(() => Promise.resolve({ data: { ...p, gambar: g }, error: null }));

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: { method: string }) => ReturnType<typeof balas>>>;
const balas = (status: number, body?: unknown) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const panggilan = (metode: string, url?: string) => fetchMock.mock.calls.filter((c) => c[1]?.method === metode && (!url || c[0] === url));
const badan = (c: unknown[]) => JSON.parse((c[1] as { body: string }).body);

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.dokumen.mockImplementation(() => Promise.resolve({ data: [{ id: 'd1', judul: 'Kajian Kelayakan 2026' }], error: null }));
  fetchMock = vi.fn(() => balas(500, { error: { code: 'GAGAL_INTERNAL', message: 'x' } }));
  vi.stubGlobal('fetch', (url: string, init: { method: string }) => init.method === 'GET'
    ? h.muat(url, init).then((r: { data: unknown; error: unknown }) => balas(r.error ? 500 : r.data ? 200 : 404, r))
    : fetchMock(url, init));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const isi = (label: RegExp, nilai: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: nilai } });
const tab = (nama: string) => fireEvent.click(screen.getByRole('tab', { name: nama }));

it('gambar dan pratinjau memakai URL dari GET detail server', async () => {
  muat(proyek(), [gambar()]);
  render(<FormIpro basis="admin" id={ID} />);
  await screen.findByDisplayValue('Kawasan Industri Tanggamus');
  expect(h.muat).toHaveBeenCalledWith(`/api/admin/ipro/${ID}`, expect.objectContaining({ method: 'GET' }));
  tab('Gambar');
  expect(screen.getByRole('img', { name: 'Lahan kawasan dari udara' }).getAttribute('src')).toBe('https://gambar.test/proyek-mini.webp');
  tab('Pratinjau');
  expect(screen.getByRole('img', { name: 'Lahan kawasan dari udara' }).getAttribute('src')).toBe('https://gambar.test/proyek.webp');
});

describe('FormIpro: proyek baru PTSP', () => {
  it('menampilkan ketujuh tab formulir dan tab Gambar meminta simpan draf dulu', () => {
    render(<FormIpro basis="admin" sumberBaru="ptsp" />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Informasi', 'Angka', 'Lokasi', 'Gambar', 'Dokumen & Kontak', 'Bahasa Inggris', 'Pratinjau']);
    expect(screen.getByRole('heading', { level: 1, name: 'Tambah IPRO PTSP' })).toBeTruthy();
    tab('Gambar');
    expect(screen.getByText('Simpan draf lebih dulu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Terbitkan' })).toBeNull();
  });

  it('simpan kosong: tidak memanggil server, galat per field terhubung aria, dan pesan umum', () => {
    render(<FormIpro basis="admin" sumberBaru="ptsp" />);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Periksa isian yang bertanda galat.')).toBeTruthy();
    const judul = screen.getByLabelText(/^Judul proyek/);
    expect(judul.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(judul.getAttribute('aria-describedby')!)?.textContent).toMatch(/Judul wajib diisi/);
  });

  it('simpan sukses: POST ke /api/admin/ipro lalu pindah ke halaman sunting (admin)', async () => {
    fetchMock.mockImplementation(() => balas(201, { data: proyek({ id: ID }) }));
    render(<FormIpro basis="admin" sumberBaru="ptsp" />);
    isi(/^Judul proyek/, '  Kawasan Industri Tanggamus ');
    isi(/^Ringkasan\s*\*?$/, 'Ringkasan proyek.');
    isi(/^Deskripsi/, 'Isi deskripsi.');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'industri' } });
    tab('Lokasi');
    fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kab. Tanggamus' } });
    tab('Angka');
    isi(/^Nilai investasi/, '1500000000');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(`/admin/ipro/${ID}`));
    const [url, init] = panggilan('POST')[0];
    expect(url).toBe('/api/admin/ipro');
    expect(badan([url, init])).toMatchObject({ sumber: 'ptsp', judul: 'Kawasan Industri Tanggamus', sektor: 'industri', kab_kota: 'Kab. Tanggamus',
      nilai_investasi: 1500000000, mata_uang: 'IDR', deskripsi: 'Isi deskripsi.', deskripsi_en: null });
    expect(badan([url, init])).not.toHaveProperty('sumber_url');
  });

  it('basis petugas berpindah ke /petugas/investasi/ipro/[id]', async () => {
    fetchMock.mockImplementation(() => balas(201, { data: proyek() }));
    render(<FormIpro basis="petugas" sumberBaru="ptsp" />);
    isi(/^Judul proyek/, 'Proyek Baru Petugas'); isi(/^Ringkasan\s*\*?$/, 'Ringkas.');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'energi' } });
    tab('Lokasi'); fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kota Metro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(`/petugas/investasi/ipro/${ID}`));
    expect(screen.getByRole('link', { name: /Daftar IPRO/ }).getAttribute('href')).toBe('/petugas/investasi/ipro');
  });

  it('galat validasi di tab lain memindahkan ke tab tersebut', () => {
    render(<FormIpro basis="admin" sumberBaru="ptsp" />);
    isi(/^Judul proyek/, 'Judul Sah'); isi(/^Ringkasan\s*\*?$/, 'Ringkas');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'energi' } });
    tab('Lokasi'); fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kota Metro' } });
    isi(/^Lintang/, '-5.4');
    tab('Informasi');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    expect(screen.getByRole('tab', { name: 'Lokasi' }).getAttribute('aria-selected')).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FormIpro: kartu FOILA baru', () => {
  it('hanya field kartu: tanpa deskripsi, kontak, atau tab angka dan lokasi', () => {
    render(<FormIpro basis="admin" sumberBaru="foila" />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Kartu', 'Gambar', 'Pratinjau']);
    expect(screen.getByLabelText(/^Tautan proyek di FOILA/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Deskripsi/)).toBeNull();
    expect(screen.queryByLabelText(/Email dinas/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tambah kartu FOILA' })).toBeTruthy();
  });

  it('menolak host yang bukan invest.lampungprov.go.id tanpa memanggil server', () => {
    render(<FormIpro basis="admin" sumberBaru="foila" />);
    isi(/^Judul proyek/, 'Proyek FOILA'); isi(/^Ringkasan\s*\*?$/, 'Cuplikan');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'energi' } });
    fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kota Metro' } });
    isi(/^Tautan proyek di FOILA/, 'https://invest.lampungprov.go.id.evil.com/proyek/x');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Gunakan tautan proyek dari https:\/\/invest\.lampungprov\.go\.id/)).toBeTruthy();
  });

  it('simpan sukses: payload kartu + sumber_url tanpa field detail', async () => {
    fetchMock.mockImplementation(() => balas(201, { data: proyek({ sumber: 'foila' }) }));
    render(<FormIpro basis="admin" sumberBaru="foila" />);
    isi(/^Judul proyek/, 'PLTMH Way Besai'); isi(/^Ringkasan\s*\*?$/, 'Cuplikan proyek.');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'energi' } });
    fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kab. Lampung Barat' } });
    isi(/^Label nilai/, 'IDR 53.18 trillion');
    isi(/^Tautan proyek di FOILA/, 'https://invest.lampungprov.go.id/proyek/pltmh-way-besai');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan draf' }));
    await waitFor(() => expect(h.replace).toHaveBeenCalled());
    const b = badan(panggilan('POST')[0]);
    expect(b).toMatchObject({ sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/proyek/pltmh-way-besai', nilai_teks: 'IDR 53.18 trillion' });
    expect(b).not.toHaveProperty('deskripsi');
    expect(b).not.toHaveProperty('kontak_email');
  });
});

describe('FormIpro: sunting', () => {
  it('memuat data, menampilkan status, lalu PATCH menyertakan versi', async () => {
    muat(proyek());
    fetchMock.mockImplementation(() => balas(200, { data: proyek({ judul: 'Judul Baru', versi: 4 }) }));
    render(<FormIpro basis="admin" id={ID} />);
    const judul = (await screen.findByLabelText(/^Judul proyek/)) as HTMLInputElement;
    expect(judul.value).toBe('Kawasan Industri Tanggamus');
    expect(screen.getByText('Draf')).toBeTruthy();
    fireEvent.change(judul, { target: { value: 'Judul Baru' } });
    expect(screen.getByText('Ada perubahan yang belum disimpan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Perubahan disimpan.', 'success'));
    const [url, init] = panggilan('PATCH')[0];
    expect(url).toBe(`/api/admin/ipro/${ID}`);
    expect(badan([url, init])).toMatchObject({ judul: 'Judul Baru', versi: 3, payback_bulan: 30, irr_persen: 12.5 });
    expect(badan([url, init])).not.toHaveProperty('sumber_url');
    await waitFor(() => expect(screen.queryByText('Ada perubahan yang belum disimpan.')).toBeNull());
  });

  it('KONFLIK_VERSI meminta muat ulang dan tombol Muat ulang mengambil data terbaru', async () => {
    muat(proyek());
    fetchMock.mockImplementation(() => balas(409, { error: { code: 'KONFLIK_VERSI', message: 'Data telah berubah.' } }));
    render(<FormIpro basis="admin" id={ID} />);
    fireEvent.change(await screen.findByLabelText(/^Judul proyek/), { target: { value: 'Ubah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/sudah diubah orang lain/);
    muat(proyek({ judul: 'Versi Terbaru', versi: 9 }));
    fireEvent.click(within(alert).getByRole('button', { name: 'Muat ulang data' }));
    await waitFor(() => expect((screen.getByLabelText(/^Judul proyek/) as HTMLInputElement).value).toBe('Versi Terbaru'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('terbit lewat konfirmasi gagal SYARAT_TERBIT: daftar kekurangan tampil dan status tetap draf', async () => {
    muat(proyek({ deskripsi: 'ada' }));
    fetchMock.mockImplementation(() => balas(409, { error: { code: 'SYARAT_TERBIT', message: 'Lengkapi persyaratan penerbitan.', kekurangan: ['gambar_utama', 'kab_kota'] } }));
    render(<FormIpro basis="admin" id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Terbitkan' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Terbitkan IPRO ini?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terbitkan' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Belum bisa diterbitkan/)).toBeTruthy();
    const butir = within(alert).getAllByRole('listitem').map((li) => li.textContent);
    expect(butir).toEqual([expect.stringMatching(/gambar utama/), expect.stringMatching(/kabupaten\/kota/)]);
    expect(badan(panggilan('POST', `/api/admin/ipro/${ID}/status`)[0])).toEqual({ aksi: 'terbit', versi: 3 });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Draf')).toBeTruthy();
  });

  it('terbit sukses: status menjadi Terbit dan aksi berganti ke Kembalikan ke draf', async () => {
    muat(proyek(), [gambar()]);
    fetchMock.mockImplementation(() => balas(200, { data: proyek({ status: 'terbit', versi: 4 }) }));
    render(<FormIpro basis="admin" id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Terbitkan' }));
    muat(proyek({ status: 'terbit', versi: 4 }), [gambar()]);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Terbitkan' }));
    expect(await screen.findByRole('button', { name: 'Kembalikan ke draf' })).toBeTruthy();
    expect(screen.getByText('Terbit')).toBeTruthy();
    expect(h.toast).toHaveBeenCalledWith('IPRO diterbitkan.', 'success');
    expect(screen.queryByRole('button', { name: 'Hapus draf' })).toBeNull();
  });

  it('aksi status dinonaktifkan selama ada perubahan yang belum disimpan', async () => {
    muat(proyek());
    render(<FormIpro basis="admin" id={ID} />);
    fireEvent.change(await screen.findByLabelText(/^Judul proyek/), { target: { value: 'Belum disimpan' } });
    for (const nama of ['Terbitkan', 'Arsipkan', 'Hapus draf']) expect((screen.getByRole('button', { name: nama }) as HTMLButtonElement).disabled, nama).toBe(true);
  });

  it('arsipkan memakai DialogKonfirmasi; hapus draf memanggil DELETE lalu kembali ke daftar', async () => {
    muat(proyek());
    fetchMock.mockImplementation((_u: string, init: { method: string }) => (init.method === 'DELETE' ? Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error('kosong')) }) : balas(200, { data: proyek({ status: 'arsip', versi: 4 }) })));
    render(<FormIpro basis="petugas" id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus draf' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Hapus draf ini?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hapus draf' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/petugas/investasi/ipro'));
    expect(panggilan('DELETE', `/api/admin/ipro/${ID}`)).toHaveLength(1);
  });

  it('batal pada konfirmasi tidak memanggil server', async () => {
    muat(proyek());
    render(<FormIpro basis="admin" id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Arsipkan' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Batal' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tidak ditemukan dan galat memuat punya keadaan sendiri', async () => {
    h.muat.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    const { unmount } = render(<FormIpro basis="admin" id={ID} />);
    expect(await screen.findByText('IPRO tidak ditemukan', { selector: 'p, h2, div' })).toBeTruthy();
    unmount();
    h.muat.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'x' } }));
    render(<FormIpro basis="admin" id={ID} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/belum dapat dimuat/);
  });

  it('pilihan dokumen berasal dari dokumen aktif dan pratinjau memakai isian terbaru', async () => {
    muat(proyek());
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Judul proyek/);
    tab('Dokumen & Kontak');
    expect(within(screen.getByLabelText('Dokumen kajian')).getByRole('option', { name: 'Kajian Kelayakan 2026' })).toBeTruthy();
    expect(screen.getByText(/Nomor pribadi petugas tidak boleh/)).toBeTruthy();
    tab('Informasi');
    isi(/^Judul proyek/, 'Judul Pratinjau');
    tab('Pratinjau');
    expect(screen.getByRole('heading', { level: 3, name: 'Judul Pratinjau' })).toBeTruthy();
    expect(screen.getByText('Rp 1,5 M')).toBeTruthy();
  });
});

describe('FormIpro: pratinjau kartu FOILA', () => {
  it('merender kartu hanya untuk tautan FOILA sah dan tidak pernah memakai isian mentah sebagai href', () => {
    render(<FormIpro basis="admin" sumberBaru="foila" />);
    isi(/^Judul proyek/, 'PLTMH Way Besai'); isi(/^Ringkasan\s*\*?$/, 'Cuplikan proyek.');
    fireEvent.change(screen.getByLabelText(/^Sektor/), { target: { value: 'energi' } });
    fireEvent.change(screen.getByLabelText(/^Kabupaten\/kota/), { target: { value: 'Kab. Lampung Barat' } });
    isi(/^Label nilai/, 'IDR 53.18 trillion');
    isi(/^Tautan proyek di FOILA/, 'javascript:alert(1)');
    tab('Pratinjau');
    expect(screen.queryByRole('link', { name: /PLTMH Way Besai/ })).toBeNull();
    expect(screen.getByText(/Isi tautan FOILA yang sah/)).toBeTruthy();
    tab('Kartu');
    isi(/^Tautan proyek di FOILA/, 'https://invest.lampungprov.go.id/proyek/pltmh-way-besai');
    tab('Pratinjau');
    const tautan = screen.getByRole('link', { name: /PLTMH Way Besai/ });
    expect(tautan.getAttribute('href')).toBe('https://invest.lampungprov.go.id/proyek/pltmh-way-besai');
    expect(tautan.getAttribute('target')).toBe('_blank');
    expect(tautan.getAttribute('rel')).toBe('noopener noreferrer external');
    expect(within(tautan).getByText('Sumber: FOILA')).toBeTruthy();
    expect(within(tautan).getByText('IDR 53.18 trillion')).toBeTruthy();
  });
});

describe('FormIpro: gambar', () => {
  const berkas = () => new File([new Uint8Array(10)], 'lahan.png', { type: 'image/png' });

  it('dua editor: penyegaran gambar tidak mengadopsi versi isian editor lain dan simpan tetap konflik', async () => {
    muat(proyek(), [gambar()]);
    let server = proyek();
    fetchMock.mockImplementation((_url, init) => {
      if (init.method === 'DELETE') return balas(204);
      if (badan(['', init]).versi !== server.versi) {
        return balas(409, { error: { code: 'KONFLIK_VERSI', message: 'Data telah berubah.' } });
      }
      server = { ...server, ...badan(['', init]) };
      return balas(200, { data: server });
    });
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByDisplayValue('Kawasan Industri Tanggamus');
    isi(/^Ringkasan\s*\*?$/, 'Perubahan editor A.');
    // Editor B menyimpan judul setelah A memuat versi 3.
    server = proyek({ judul: 'Judul dari editor B', versi: 4 });
    muat(server, []);
    tab('Gambar');
    fireEvent.click(screen.getByRole('button', { name: 'Hapus gambar 1' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hapus gambar' }));
    await screen.findByText('Belum ada gambar');
    tab('Informasi');
    expect(screen.getByDisplayValue('Kawasan Industri Tanggamus')).toBeTruthy();
    expect(screen.getByDisplayValue('Perubahan editor A.')).toBeTruthy();
    expect(screen.getByText('Ada perubahan yang belum disimpan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/sudah diubah orang lain/);
    expect(badan(panggilan('PATCH')[0]).versi).toBe(3);
    expect(server.judul).toBe('Judul dari editor B');
  });

  it('unggah: alt wajib; lalu presign/PUT/konfirmasi (unggahKeR2) dan POST gambar dengan kunci mentah', async () => {
    muat(proyek());
    h.unggah.mockImplementation((_a: string, path: string) => Promise.resolve({ kunci: `ipro-mentah/${path}` }));
    fetchMock.mockImplementation(() => balas(201, { data: gambar() }));
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Judul proyek/);
    tab('Gambar');
    expect(screen.getByText('Belum ada gambar')).toBeTruthy();
    const form = screen.getByRole('form', { name: 'Tambah gambar' });
    fireEvent.change(within(form).getByLabelText(/^Berkas gambar/), { target: { files: [berkas()] } });
    fireEvent.click(within(form).getByRole('button', { name: 'Unggah gambar' }));
    expect(within(form).getByText(/Teks alternatif wajib diisi/)).toBeTruthy();
    expect(h.unggah).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText(/^Teks alternatif\s*\*?$/), { target: { value: 'Lahan dari udara' } });
    muat(proyek({ versi: 4 }), [gambar()]);
    fireEvent.click(within(form).getByRole('button', { name: 'Unggah gambar' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Gambar ditambahkan.', 'success'));
    expect(h.unggah).toHaveBeenCalledTimes(1);
    const [area, path] = h.unggah.mock.calls[0];
    expect(area).toBe('ipro-mentah');
    expect(path).toMatch(new RegExp(`^${ID}/[0-9a-f-]{36}\\.png$`));
    const [url, init] = panggilan('POST')[0];
    expect(url).toBe(`/api/admin/ipro/${ID}/gambar`);
    expect(badan([url, init])).toMatchObject({ kunci_mentah: `ipro-mentah/${path}`, alt: 'Lahan dari udara', utama: true });
    expect(await screen.findByLabelText(/^Teks alternatif gambar 1\s*\*?$/)).toBeTruthy();
  });

  it('format tidak didukung ditolak di klien tanpa menyentuh R2', async () => {
    muat(proyek());
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Judul proyek/);
    tab('Gambar');
    const form = screen.getByRole('form', { name: 'Tambah gambar' });
    fireEvent.change(within(form).getByLabelText(/^Berkas gambar/), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    fireEvent.change(within(form).getByLabelText(/^Teks alternatif\s*\*?$/), { target: { value: 'Teks sah' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Unggah gambar' }));
    expect(within(form).getByText(/Format gambar harus JPG, PNG, atau WebP/)).toBeTruthy();
    expect(h.unggah).not.toHaveBeenCalled();
  });

  it('hapus gambar lewat DialogKonfirmasi memanggil DELETE', async () => {
    muat(proyek(), [gambar()]);
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error('kosong')) }));
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Judul proyek/);
    tab('Gambar');
    expect(screen.getByText('Gambar utama')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus gambar 1' }));
    muat(proyek(), []);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hapus gambar' }));
    await waitFor(() => expect(panggilan('DELETE', `/api/admin/ipro/${ID}/gambar/${GID}`)).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Belum ada gambar')).toBeTruthy());
  });

  it('jadikan utama, ubah teks, dan geser urutan memakai PATCH gambar', async () => {
    const g2 = gambar({ id: '8b8b8b8b-1111-4222-8333-444455556666', utama: false, urutan: 1, alt: 'Jalan akses kawasan' });
    muat(proyek(), [gambar(), g2]);
    fetchMock.mockImplementation(() => balas(200, { data: gambar() }));
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Judul proyek/);
    tab('Gambar');
    fireEvent.click(screen.getByRole('button', { name: 'Jadikan gambar utama 2' }));
    await waitFor(() => expect(panggilan('PATCH')).toHaveLength(1));
    expect(badan(panggilan('PATCH')[0])).toEqual({ utama: true });
    fireEvent.click(screen.getByRole('button', { name: 'Turunkan gambar 1' }));
    await waitFor(() => expect(panggilan('PATCH')).toHaveLength(3));
    expect(panggilan('PATCH').slice(1).map((c) => [c[0], badan(c)])).toEqual([
      [`/api/admin/ipro/${ID}/gambar/8b8b8b8b-1111-4222-8333-444455556666`, { urutan: 0 }], [`/api/admin/ipro/${ID}/gambar/${GID}`, { urutan: 1 }],
    ]);
    fireEvent.change(screen.getByLabelText(/^Teks alternatif gambar 2\s*\*?$/), { target: { value: 'Jalan akses baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan teks gambar 2' }));
    await waitFor(() => expect(panggilan('PATCH')).toHaveLength(4));
    expect(badan(panggilan('PATCH')[3])).toEqual({ alt: 'Jalan akses baru', alt_en: null, keterangan: null });
  });

  it('kartu FOILA: satu gambar; formulir tambah hilang setelah batas tercapai', async () => {
    muat(proyek({ sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/proyek/x' }), [gambar()]);
    render(<FormIpro basis="admin" id={ID} />);
    await screen.findByLabelText(/^Tautan proyek di FOILA/);
    tab('Gambar');
    expect(screen.queryByRole('form', { name: 'Tambah gambar' })).toBeNull();
    expect(screen.getByText(/Batas 1 gambar tercapai/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Jadikan gambar utama/ })).toBeNull();
  });
});
