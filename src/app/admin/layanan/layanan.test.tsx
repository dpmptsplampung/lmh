// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import KelolaLayananPage from './page';

const lay = (o: Record<string, unknown>) => ({
  id: 'l1', nama: 'Helpdesk OSS', tipe: 'layanan', aktif: true, penyerta: false, status_tampilan: 'aktif',
  tampil_di_layar: true, punya_antrean: true, punya_chat: true, chatbot_aktif: true,
  nomor_loket: '2', prefiks_antrean: 'OS', ...o,
});

let fetchMock: ReturnType<typeof vi.fn>;
function setup(bisaUbah: boolean) {
  fetchMock = vi.fn((url: string) => {
    const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (url === '/api/admin/layanan') return ok({ layanan: [lay({}), lay({ id: 'l2', nama: 'Bank Lampung', status_tampilan: 'coming_soon' })], bisa_ubah: bisaUbah });
    return ok({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
}
const patchCalls = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
afterEach(cleanup);

describe('kelola layanan', () => {
  describe('Admin', () => {
    beforeEach(() => setup(true));

    it('menampilkan tabel, keterangan Admin, dan tombol ubah', async () => {
      render(<KelolaLayananPage />);
      expect(await screen.findByText('Bank Lampung')).toBeTruthy();
      expect(screen.getByRole('note').textContent).toMatch(/Admin/);
      expect(screen.getByText('Segera hadir')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Ubah Helpdesk OSS' })).toBeTruthy();
    });

    it('mengganti NAMA meminta konfirmasi dulu, baru mengirim PATCH', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Nama layanan'), { target: { value: 'Helpdesk OSS Baru' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      expect(await screen.findByRole('alertdialog')).toBeTruthy();
      expect(patchCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Ya, ganti nama' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0][0]).toBe('/api/admin/layanan/l1');
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ nama: 'Helpdesk OSS Baru' });
    });

    it('ubah non-nama tidak minta konfirmasi dan hanya mengirim field yang berubah', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Di halaman utama / daftar layanan'), { target: { value: 'nonaktif' } });
      fireEvent.click(screen.getByLabelText('Tampil di layar TV'));
      fireEvent.change(screen.getByLabelText('Prefiks antrean'), { target: { value: 'hd' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ status_tampilan: 'nonaktif', tampil_di_layar: false, prefiks: 'HD' });
    });

    it('kotak "Tampil di homepage" (default tercentang): mengubahnya hanya mengirim tampil_di_homepage', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      const kotak = screen.getByLabelText('Tampil di homepage') as HTMLInputElement;
      expect(kotak.checked).toBe(true);
      fireEvent.click(kotak);
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ tampil_di_homepage: false });
    });

    it('prefiks: tepat 2 huruf, otomatis kapital, hanya huruf, dan tidak lebih dari 2', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      const input = screen.getByLabelText('Prefiks antrean') as HTMLInputElement;
      expect(input.maxLength).toBe(2);
      fireEvent.change(input, { target: { value: 'b1m' } });
      expect(input.value).toBe('BM');
      fireEvent.change(input, { target: { value: 'abcd' } });
      expect(input.value).toBe('AB');
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ prefiks: 'AB' });
    });

    it('prefiks 1 huruf ditolak di klien (alert di bawah isian, aria-invalid) tanpa PATCH', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      const input = screen.getByLabelText('Prefiks antrean');
      fireEvent.change(input, { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/tepat 2 huruf/);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input.getAttribute('aria-describedby')).toContain('lyPrefiksGalat');
      expect(patchCalls()).toHaveLength(0);
    });

    it('prefiks dikosongkan = kirim null (kode otomatis dari DB)', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Prefiks antrean'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ prefiks: null });
    });

    it('prefiks lama yang tidak disentuh tidak memblokir perubahan lain (data lama 3 huruf)', async () => {
      fetchMock.mockImplementation((url: string) => {
        const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
        if (url === '/api/admin/layanan') return ok({ layanan: [lay({ prefiks_antrean: 'OSS' })], bisa_ubah: true });
        return ok({ ok: true });
      });
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Nomor loket'), { target: { value: '5' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ nomor_loket: '5' });
    });

    it('galat 409 bentrok prefiks dari server tampil jelas di bawah isian prefiks (bukan di atas form)', async () => {
      fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === 'PATCH') {
          return Promise.resolve({
            ok: false, status: 409,
            json: () => Promise.resolve({ error: 'Prefiks antrean sudah dipakai layanan lain. Pilih 2 huruf yang berbeda.', kode: 'PREFIKS_BENTROK' }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ layanan: [lay({})], bisa_ubah: true }) });
      });
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      const input = screen.getByLabelText('Prefiks antrean');
      fireEvent.change(input, { target: { value: 'bm' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      const alerts = await screen.findAllByRole('alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(/Prefiks antrean sudah dipakai layanan lain/);
      expect(alerts[0].id).toBe('lyPrefiksGalat');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('Formulir Pendataan (layanan.form_pendataan, 202610140012): tampil di tabel, diubah lewat form, kosong = null', async () => {
      fetchMock.mockImplementation((url: string) => {
        const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
        if (url === '/api/admin/layanan') return ok({ layanan: [lay({ form_pendataan: 'oss' })], bisa_ubah: true });
        return ok({ ok: true });
      });
      render(<KelolaLayananPage />);
      expect(await screen.findByText('OSS (Helpdesk OSS)')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Ubah Helpdesk OSS' }));
      const pilih = screen.getByLabelText('Formulir Pendataan') as HTMLSelectElement;
      expect(pilih.value).toBe('oss');
      fireEvent.change(pilih, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ form_pendataan: null });
    });

    it('toggle bot memanggil endpoint /bot', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('switch', { name: 'Bot Helpdesk OSS' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0][0]).toBe('/api/admin/layanan/l1/bot');
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ aktif: false });
    });
  });

  describe('layanan dinamis (Admin)', () => {
    const INSTANSI = [{ id: 'i1', nama: 'Dinas Penanaman Modal', singkatan: 'DPMPTSP' }];
    let layananList: Record<string, unknown>[];
    let instansiList: Array<{ id: string; nama: string; singkatan: string | null }>;
    const resp = (status: number, b: unknown) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) });
    const panggilan = (metode: string, bagian: string) =>
      fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === metode && String(c[0]).includes(bagian));

    beforeEach(() => {
      layananList = [
        lay({ slug: 'helpdesk-oss', instansi_id: 'i1', urutan: 10, deskripsi: null, konten_sumber_url: null, website_terkait: [], diarsipkan_at: null }),
        lay({ id: 'l9', nama: 'Layanan Lama', aktif: false, slug: 'layanan-lama', diarsipkan_at: '2026-10-20T03:00:00Z', website_terkait: [] }),
      ];
      instansiList = [...INSTANSI];
      fetchMock = vi.fn((url: string, init?: { method?: string; body?: string }) => {
        const metode = init?.method ?? 'GET';
        if (url === '/api/admin/layanan' && metode === 'GET') return resp(200, { layanan: layananList, instansi: instansiList, bisa_ubah: true });
        if (url === '/api/admin/layanan' && metode === 'POST') return resp(201, { id: 'baru1', slug: 'x' });
        if (url === '/api/admin/instansi' && metode === 'POST') {
          const b = JSON.parse(init!.body!);
          instansiList = [...instansiList, { id: 'i2', nama: b.nama, singkatan: b.singkatan ?? null }];
          return resp(201, { id: 'i2' });
        }
        return resp(200, { ok: true });
      });
      vi.stubGlobal('fetch', fetchMock);
    });

    it('baris lama aktif=false tanpa diarsipkan_at tampil di "Diarsipkan" dengan "Aktifkan lagi", bukan di daftar aktif', async () => {
      layananList = [
        lay({ slug: 'helpdesk-oss', instansi_id: 'i1', urutan: 10, deskripsi: null, konten_sumber_url: null, website_terkait: [], diarsipkan_at: null }),
        lay({ id: 'l7', nama: 'Layanan Lawas', aktif: false, slug: 'layanan-lawas', diarsipkan_at: null, website_terkait: [] }),
      ];
      render(<KelolaLayananPage />);
      const judul = await screen.findByRole('heading', { name: 'Diarsipkan' });
      const bagianArsip = judul.closest('section') as HTMLElement;
      expect(within(bagianArsip).getByText('Layanan Lawas')).toBeTruthy();
      expect(within(bagianArsip).getAllByText('—').length).toBeGreaterThan(0); // tanggal kosong
      fireEvent.click(within(bagianArsip).getByRole('button', { name: 'Aktifkan lagi Layanan Lawas' }));
      await waitFor(() => expect(panggilan('POST', '/l7/arsip')).toHaveLength(1));
      expect(JSON.parse(panggilan('POST', '/l7/arsip')[0][1].body)).toEqual({ arsip: false });
      // tidak muncul di tabel aktif
      const tabelAktif = screen.getByRole('table', { name: 'Daftar layanan aktif' });
      expect(within(tabelAktif).queryByText('Layanan Lawas')).toBeNull();
      expect(within(tabelAktif).getByText('Helpdesk OSS')).toBeTruthy();
    });

    it('"Tambah layanan" membuka form kosong dan mengirim POST dengan form_pendataan eksplisit', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tambah layanan' }));
      expect((screen.getByLabelText('Nama layanan') as HTMLInputElement).value).toBe('');
      fireEvent.change(screen.getByLabelText('Nama layanan'), { target: { value: 'Konsultasi Investasi' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(panggilan('POST', '/api/admin/layanan')).toHaveLength(1));
      const body = JSON.parse(panggilan('POST', '/api/admin/layanan')[0][1].body);
      expect(body.nama).toBe('Konsultasi Investasi');
      expect(body).toHaveProperty('form_pendataan', null);
      expect(body).toHaveProperty('tampil_di_homepage', true);
      expect(panggilan('PUT', '/tautan')).toHaveLength(0);
    });

    it('form memuat Instansi, Deskripsi, Urutan, Sumber konten, dan opsi "Tanpa formulir tetap"', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tambah layanan' }));
      const instansi = screen.getByLabelText('Instansi') as HTMLSelectElement;
      expect(instansi.tagName).toBe('SELECT');
      expect(Array.from(instansi.options).map((o) => o.textContent)).toContain('Dinas Penanaman Modal (DPMPTSP)');
      expect(screen.getByLabelText('Deskripsi')).toBeTruthy();
      expect(screen.getByLabelText('Urutan tampil')).toBeTruthy();
      expect(screen.getByLabelText('Sumber konten (alamat https://)')).toBeTruthy();
      const form = screen.getByLabelText('Formulir Pendataan') as HTMLSelectElement;
      expect(Array.from(form.options).map((o) => o.textContent)).toContain('Tanpa formulir tetap');
    });

    it('layanan baru + website terkait: POST lalu PUT /tautan ke id baru', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tambah layanan' }));
      fireEvent.change(screen.getByLabelText('Nama layanan'), { target: { value: 'Konsultasi Investasi' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tambah website' }));
      fireEvent.change(screen.getByLabelText('Nama website 1'), { target: { value: 'OSS RBA' } });
      fireEvent.change(screen.getByLabelText('Alamat website 1'), { target: { value: 'https://oss.go.id' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(panggilan('PUT', '/api/admin/layanan/baru1/tautan')).toHaveLength(1));
      expect(JSON.parse(panggilan('PUT', '/tautan')[0][1].body)).toEqual({ tautan: [{ label: 'OSS RBA', url: 'https://oss.go.id' }] });
    });

    it('layanan baru: PUT /tautan gagal -> galat tampil; ulang hanya mengirim PUT (tanpa PATCH slug kosong / prefiks null)', async () => {
      const dasar = fetchMock.getMockImplementation() as (u: string, i?: unknown) => Promise<unknown>;
      let putKe = 0;
      fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (url === '/api/admin/layanan' && init?.method === 'POST') {
          // Slug & prefiks dikosongkan di form; server mengisinya otomatis.
          layananList = [...layananList, lay({
            id: 'baru1', nama: 'Konsultasi Investasi', slug: 'konsultasi-investasi', prefiks_antrean: 'KI',
            instansi_id: null, urutan: 100, deskripsi: null, konten_sumber_url: null, website_terkait: [], diarsipkan_at: null,
          })];
          return resp(201, { id: 'baru1', slug: 'konsultasi-investasi' });
        }
        if (init?.method === 'PUT') {
          putKe += 1;
          return putKe === 1 ? resp(500, { error: 'Gagal menyimpan website terkait' }) : resp(200, { ok: true });
        }
        return dasar(url, init);
      });
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Tambah layanan' }));
      fireEvent.change(screen.getByLabelText('Nama layanan'), { target: { value: 'Konsultasi Investasi' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tambah website' }));
      fireEvent.change(screen.getByLabelText('Nama website 1'), { target: { value: 'OSS RBA' } });
      fireEvent.change(screen.getByLabelText('Alamat website 1'), { target: { value: 'https://oss.go.id' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Layanan sudah tersimpan, tetapi website terkait belum: Gagal menyimpan website terkait/);
      // Form dipasang ulang dari baris server: nilai otomatis terisi dan isian website tidak hilang.
      await waitFor(() => expect((screen.getByLabelText('Alamat halaman (slug)') as HTMLInputElement).value).toBe('konsultasi-investasi'));
      expect((screen.getByLabelText('Prefiks antrean') as HTMLInputElement).value).toBe('KI');
      expect((screen.getByLabelText('Alamat website 1') as HTMLInputElement).value).toBe('https://oss.go.id');

      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(panggilan('PUT', '/api/admin/layanan/baru1/tautan')).toHaveLength(2));
      expect(JSON.parse(panggilan('PUT', '/tautan')[1][1].body)).toEqual({ tautan: [{ label: 'OSS RBA', url: 'https://oss.go.id' }] });
      expect(patchCalls()).toHaveLength(0);
      expect(panggilan('POST', '/api/admin/layanan')).toHaveLength(1);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /Ubah layanan/ })).toBeNull());
    });

    it('website terkait: tambah/hapus baris; http:// diberi pesan galat dan tidak dikirim; simpan mengirim PUT', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tambah website' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tambah website' }));
      expect(screen.getByLabelText('Nama website 2')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Hapus website 2' }));
      expect(screen.queryByLabelText('Nama website 2')).toBeNull();

      fireEvent.change(screen.getByLabelText('Nama website 1'), { target: { value: 'Portal lama' } });
      const url = screen.getByLabelText('Alamat website 1');
      fireEvent.change(url, { target: { value: 'http://contoh.go.id' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/https:\/\//);
      expect(url).toHaveAttribute('aria-invalid', 'true');
      expect(url.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
      expect(panggilan('PUT', '/tautan')).toHaveLength(0);
      expect(patchCalls()).toHaveLength(0);

      fireEvent.change(url, { target: { value: 'https://contoh.go.id' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(panggilan('PUT', '/api/admin/layanan/l1/tautan')).toHaveLength(1));
      expect(JSON.parse(panggilan('PUT', '/tautan')[0][1].body)).toEqual({ tautan: [{ label: 'Portal lama', url: 'https://contoh.go.id' }] });
      expect(patchCalls()).toHaveLength(0);
    });

    it('Arsipkan meminta konfirmasi lalu POST /arsip {arsip:true}; baris arsip ada di bagian "Diarsipkan" dengan "Aktifkan lagi"', async () => {
      render(<KelolaLayananPage />);
      expect(await screen.findByRole('heading', { name: 'Diarsipkan' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Aktifkan lagi Layanan Lama' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Arsipkan Helpdesk OSS' }));
      expect(await screen.findByRole('dialog', { name: /Arsipkan Helpdesk OSS/ })).toBeTruthy();
      expect(panggilan('POST', '/arsip')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Ya, arsipkan' }));
      await waitFor(() => expect(panggilan('POST', '/api/admin/layanan/l1/arsip')).toHaveLength(1));
      expect(JSON.parse(panggilan('POST', '/arsip')[0][1].body)).toEqual({ arsip: true });
    });

    it('Aktifkan lagi mengirim POST /arsip {arsip:false} tanpa konfirmasi', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Aktifkan lagi Layanan Lama' }));
      await waitFor(() => expect(panggilan('POST', '/api/admin/layanan/l9/arsip')).toHaveLength(1));
      expect(JSON.parse(panggilan('POST', '/arsip')[0][1].body)).toEqual({ arsip: false });
    });

    it('Hapus permanen hanya untuk layanan arsip; 409 SUDAH_DIPAKAI menampilkan pesan ramah', async () => {
      const dasar = fetchMock.getMockImplementation() as (u: string, i?: unknown) => Promise<unknown>;
      fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'DELETE') {
          return resp(409, { error: 'Layanan sudah pernah dipakai (tiket, ...). Arsipkan saja.', kode: 'SUDAH_DIPAKAI' });
        }
        return dasar(url, init);
      });
      render(<KelolaLayananPage />);
      await screen.findByText('Layanan Lama');
      expect(screen.queryByRole('button', { name: 'Hapus permanen Helpdesk OSS' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Hapus permanen Layanan Lama' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Ya, hapus permanen' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Layanan ini sudah pernah dipakai, jadi hanya bisa diarsipkan.');
      expect(panggilan('DELETE', '/api/admin/layanan/l9')).toHaveLength(1);
    });

    it('Instansi: bagian di halaman (bukan dialog); tambah lewat baris terakhir lalu muncul di pilihan form', async () => {
      render(<KelolaLayananPage />);
      const judul = await screen.findByRole('heading', { name: 'Instansi' });
      expect(judul.closest('section')?.id).toBe('instansi');
      expect(screen.getByRole('link', { name: 'Kelola Instansi' })).toHaveAttribute('href', '#instansi');
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.change(screen.getByLabelText('Nama instansi baru'), { target: { value: 'Bank Lampung' } });
      fireEvent.change(screen.getByLabelText('Singkatan instansi baru'), { target: { value: 'BL' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tambah instansi' }));
      await waitFor(() => expect(panggilan('POST', '/api/admin/instansi')).toHaveLength(1));
      expect(JSON.parse(panggilan('POST', '/api/admin/instansi')[0][1].body)).toEqual({ nama: 'Bank Lampung', singkatan: 'BL' });
      fireEvent.click(await screen.findByRole('button', { name: 'Tambah layanan' }));
      const instansi = screen.getByLabelText('Instansi') as HTMLSelectElement;
      await waitFor(() => expect(Array.from(instansi.options).map((o) => o.textContent)).toContain('Bank Lampung (BL)'));
    });

    it('Instansi: nama terlalu pendek ditolak di klien tanpa POST', async () => {
      render(<KelolaLayananPage />);
      await screen.findByRole('heading', { name: 'Instansi' });
      fireEvent.change(screen.getByLabelText('Nama instansi baru'), { target: { value: 'B' } });
      fireEvent.click(screen.getByRole('button', { name: 'Tambah instansi' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/2 sampai 150 karakter/);
      expect(panggilan('POST', '/api/admin/instansi')).toHaveLength(0);
    });

    it('Instansi: nama dan singkatan diedit langsung di sel (PATCH satu field); bentrok nama tampil sebagai galat di bawah input', async () => {
      const dasar = fetchMock.getMockImplementation() as (u: string, i?: unknown) => Promise<unknown>;
      fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'PATCH' && url === '/api/admin/instansi/i1' && JSON.parse(init.body ?? '{}').nama === 'Dinas Lain') {
          return resp(409, { error: 'Nama instansi sudah dipakai', kode: 'NAMA_BENTROK' });
        }
        return dasar(url, init);
      });
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah nama instansi Dinas Penanaman Modal' }));
      const nama = screen.getByRole('textbox', { name: 'Nama instansi Dinas Penanaman Modal' });
      fireEvent.change(nama, { target: { value: 'Dinas Lain' } });
      fireEvent.keyDown(nama, { key: 'Enter' });
      expect(await screen.findByRole('alert')).toHaveTextContent('Nama instansi sudah dipakai');
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ nama: 'Dinas Lain' });

      fireEvent.keyDown(nama, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Ubah singkatan instansi Dinas Penanaman Modal' }));
      const sing = screen.getByRole('textbox', { name: 'Singkatan instansi Dinas Penanaman Modal' });
      fireEvent.change(sing, { target: { value: '' } });
      fireEvent.keyDown(sing, { key: 'Enter' });
      await waitFor(() => expect(patchCalls()).toHaveLength(2));
      expect(patchCalls()[1][0]).toBe('/api/admin/instansi/i1');
      expect(JSON.parse(patchCalls()[1][1].body)).toEqual({ singkatan: null });
    });
  });

  it('Front Office tidak melihat tombol tambah, arsip, aktifkan, maupun hapus', async () => {
    fetchMock = vi.fn((url: string) => {
      const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
      if (url === '/api/admin/layanan') return ok({ layanan: [lay({}), lay({ id: 'l9', nama: 'Layanan Lama', aktif: false, diarsipkan_at: '2026-10-20T03:00:00Z' })], instansi: [], bisa_ubah: false });
      return ok({});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<KelolaLayananPage />);
    expect(await screen.findByText('Layanan Lama')).toBeTruthy();
    for (const nama of [/^Tambah layanan/, /^Kelola Instansi/, /^Arsipkan/, /^Aktifkan lagi/, /^Hapus permanen/]) {
      expect(screen.queryByRole('button', { name: nama })).toBeNull();
    }
  });

  it('Front Office: mode baca saja, tanpa tombol ubah maupun toggle bot', async () => {
    setup(false);
    render(<KelolaLayananPage />);
    expect(await screen.findByText('Bank Lampung')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/hanya untuk dilihat/);
    expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
