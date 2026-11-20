// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FormulirHubungi from './FormulirHubungi';
import FormulirMinat from './FormulirMinat';
import { NASKAH_PDP } from './teks-pdp';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));

const IPRO = { id: '20000000-0000-4000-8000-000000000001', judul: 'Kawasan Wisata Pesisir' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let fetchMock: ReturnType<typeof vi.fn>;

const balas = (status: number, isi: unknown) => Promise.resolve(new Response(JSON.stringify(isi), { status }));
const sukses = () => balas(201, { data: { id: '30000000-0000-4000-8000-000000000001' } });
const badan = (n = 0) => JSON.parse((fetchMock.mock.calls[n][1] as { body: string }).body) as Record<string, unknown>;

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: 'anon' } } }, error: null });
  fetchMock = vi.fn(sukses);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function Pemicu() {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button onClick={() => setBuka(true)}>Hubungi petugas</button>
      <FormulirHubungi terbuka={buka} onTutup={() => setBuka(false)} ipro={IPRO} />
    </>
  );
}
const bukaForm = () => { render(<Pemicu />); fireEvent.click(screen.getByRole('button', { name: 'Hubungi petugas' })); return screen.getByRole('dialog'); };
function isi(dialog: HTMLElement, nilai: Partial<Record<'Nama' | 'Email' | 'Pesan', string>> = {}) {
  const data = { Nama: 'Sari Dewi', Email: 'sari@contoh.id', Pesan: 'Mohon informasi kelayakan proyek ini.', ...nilai };
  for (const [label, value] of Object.entries(data)) fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${label}`)), { target: { value } });
}
const centang = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('checkbox'));
const kirim = (dialog: HTMLElement) => fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);

describe('FormulirHubungi: tampilan dan a11y', () => {
  it('dialog bernama "Hubungi petugas", memuat konteks proyek, label tiap bidang, tanpa login', () => {
    const dialog = bukaForm();
    expect(dialog).toHaveAccessibleName('Hubungi petugas');
    expect(within(dialog).getByText('Kawasan Wisata Pesisir')).toBeInTheDocument();
    for (const label of [/^Nama/, /^Email/, /^Nomor HP/, /^Instansi/, /^Pesan/]) expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Masuk' })).toBeNull();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('naskah PDP: tujuan, data, penerima, retensi 365 hari, tautan kebijakan privasi (tanpa nomor versi)', () => {
    const dialog = bukaForm();
    const kotak = within(dialog).getByRole('checkbox');
    expect(kotak).toHaveAccessibleName(/nama, email, nomor HP \(bila diisi\), instansi, dan pesan/);
    expect(kotak).toHaveAccessibleName(/petugas Investment Gallery DPMPTSP/);
    expect(kotak).toHaveAccessibleName(/menanggapi minat investasi/);
    expect(kotak).toHaveAccessibleDescription(/365 hari/);
    expect(within(dialog).getByRole('link', { name: NASKAH_PDP.teksTautan })).toHaveAttribute('href', '/kebijakan-privasi');
    expect(dialog.textContent).not.toMatch(/versi|1\.1/i);
  });

  it('honeypot situs_web tersembunyi dari pembaca layar dan papan ketik', () => {
    const dialog = bukaForm();
    const jebakan = dialog.querySelector('input[name="situs_web"]') as HTMLInputElement;
    expect(jebakan).toHaveAttribute('tabindex', '-1');
    expect(jebakan).toHaveAttribute('autocomplete', 'off');
    expect(jebakan.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: /Situs web/ })).toBeNull();
  });

  it('Escape menutup dan fokus kembali ke tombol pemicu', () => {
    bukaForm();
    const pemicu = screen.getByRole('button', { name: 'Hubungi petugas' });
    pemicu.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });
});

describe('FormulirHubungi: validasi sisi klien', () => {
  it('kirim kosong menampilkan galat per bidang terhubung aria-describedby, tidak memanggil jaringan, fokus ke bidang pertama', async () => {
    const dialog = bukaForm();
    kirim(dialog);
    const nama = within(dialog).getByLabelText(/^Nama/);
    expect(nama).toHaveAttribute('aria-invalid', 'true');
    expect(nama).toHaveAccessibleDescription('Nama wajib diisi.');
    expect(within(dialog).getByLabelText(/^Email/)).toHaveAccessibleDescription(/Email wajib diisi/);
    expect(within(dialog).getByLabelText(/^Pesan/)).toHaveAccessibleDescription(/minimal 10 karakter/);
    expect(within(dialog).getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('checkbox')).toHaveAccessibleDescription(/Centang persetujuan/);
    await waitFor(() => expect(nama).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('email salah dan nomor HP salah ditolak; mengetik menghapus galat bidang itu', () => {
    const dialog = bukaForm();
    isi(dialog, { Email: 'bukan-email' });
    fireEvent.change(within(dialog).getByLabelText(/^Nomor HP/), { target: { value: '12ab' } });
    centang(dialog);
    kirim(dialog);
    expect(within(dialog).getByLabelText(/^Email/)).toHaveAccessibleDescription(/alamat email yang benar/);
    expect(within(dialog).getByLabelText(/^Nomor HP/)).toHaveAccessibleDescription(/8 sampai 20 angka/);
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'sari@contoh.id' } });
    expect(within(dialog).getByLabelText(/^Email/)).not.toHaveAttribute('aria-invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FormulirHubungi: pengiriman', () => {
  it('sukses: sesi anonim dibuat, badan sesuai kontrak, operasi_id uuid, honeypot kosong, isian tidak ditampilkan ulang', async () => {
    const dialog = bukaForm();
    isi(dialog);
    fireEvent.change(within(dialog).getByLabelText(/^Nomor HP/), { target: { value: '0812-3456-7890' } });
    fireEvent.change(within(dialog).getByLabelText(/^Instansi/), { target: { value: 'PT Contoh' } });
    centang(dialog);
    kirim(dialog);
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Pesan terkirim. Petugas akan menghubungi Anda melalui email.');
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/investasi/pesan');
    expect(badan()).toEqual({
      ipro_id: IPRO.id, nama: 'Sari Dewi', email: 'sari@contoh.id', no_hp: '0812-3456-7890', instansi: 'PT Contoh',
      pesan: 'Mohon informasi kelayakan proyek ini.', setuju_pdp: true, situs_web: '', operasi_id: expect.stringMatching(UUID),
    });
    expect(screen.queryByDisplayValue('sari@contoh.id')).toBeNull();
    expect(dialog.textContent).not.toContain('sari@contoh.id');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sesi yang sudah ada tidak dibuat ulang; bidang opsional kosong tidak dikirim', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null });
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await within(dialog).findByRole('status');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(badan()).not.toHaveProperty('no_hp');
    expect(badan()).not.toHaveProperty('instansi');
  });

  it('honeypot terisi (bot) tetap dikirim apa adanya agar server menyaring; nilainya sampai ke badan', async () => {
    const dialog = bukaForm();
    isi(dialog); centang(dialog);
    fireEvent.change(dialog.querySelector('input[name="situs_web"]') as HTMLInputElement, { target: { value: 'https://spam.example' } });
    kirim(dialog);
    await within(dialog).findByRole('status');
    expect(badan().situs_web).toBe('https://spam.example');
  });

  it('operasi_id berbeda tiap pembukaan formulir', async () => {
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await within(dialog).findByRole('status');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hubungi petugas' }));
    const lagi = screen.getByRole('dialog');
    expect(within(lagi).getByLabelText(/^Nama/)).toHaveValue('');
    isi(lagi); centang(lagi); kirim(lagi);
    await within(lagi).findByRole('status');
    expect(badan(1).operasi_id).not.toBe(badan(0).operasi_id);
  });

  it('galat 500: pesan ramah di role=alert, dialog tetap terbuka, retry memakai operasi_id yang sama', async () => {
    fetchMock.mockImplementationOnce(() => balas(500, { error: { code: 'GAGAL_INTERNAL', message: 'x' } }));
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Pengiriman belum berhasil/));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Nama/)).toHaveValue('Sari Dewi');
    kirim(dialog);
    await within(dialog).findByRole('status');
    expect(badan(1).operasi_id).toBe(badan(0).operasi_id);
  });

  it('jaringan putus: pesan ramah dan retry memakai operasi_id yang sama', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('gagal')));
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Koneksi terputus/));
    kirim(dialog);
    await within(dialog).findByRole('status');
    expect(badan(1).operasi_id).toBe(badan(0).operasi_id);
  });

  it.each([
    [400, 'INPUT_TIDAK_VALID', /Periksa kembali isian/],
    [429, 'TERLALU_BANYAK', /Terlalu banyak pengiriman/],
    [409, 'KONFLIK_OPERASI', /Kiriman sebelumnya sudah diterima/],
    [404, 'TIDAK_DITEMUKAN', /tidak lagi tersedia/],
  ])('galat %i (%s): pesan ramah dan operasi_id tetap pada percobaan berikutnya', async (status, code, pesan) => {
    fetchMock.mockImplementationOnce(() => balas(status, { error: { code, message: 'x' }, request_id: 'r' }));
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(pesan));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveFocus());
    kirim(dialog);
    await within(dialog).findByRole('status');
    expect(badan(1).operasi_id).toBe(badan(0).operasi_id);
  });

  it('respons hilang lalu isian diedit: operasi tetap sama, konflik dijelaskan, pembukaan berikutnya baru mendapat UUID baru', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('respons hilang'));
    fetchMock.mockImplementationOnce(() => balas(409, { error: { code: 'KONFLIK_OPERASI' } }));
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await within(dialog).findByRole('alert');
    fireEvent.change(within(dialog).getByLabelText(/^Pesan/), { target: { value: 'Pesan baru sesudah respons hilang.' } });
    kirim(dialog);
    const galat = await within(dialog).findByRole('alert');
    expect(galat).toHaveTextContent(/Kiriman sebelumnya sudah diterima dengan isian yang berbeda/);
    expect(galat).toHaveTextContent(/Perubahan ini belum dikirim/);
    expect(galat).toHaveTextContent(/Tutup lalu buka kembali formulir/);
    expect(badan(1).operasi_id).toBe(badan(0).operasi_id);
    expect(badan(1).pesan).toBe('Pesan baru sesudah respons hilang.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hubungi petugas' }));
    const berikutnya = screen.getByRole('dialog');
    isi(berikutnya); centang(berikutnya); kirim(berikutnya);
    await within(berikutnya).findByRole('status');
    expect(badan(2).operasi_id).not.toBe(badan(0).operasi_id);
  });

  it('sesi anonim gagal dibuat: galat 401 ramah dan tanpa panggilan ke route', async () => {
    auth.signInAnonymously.mockResolvedValue({ data: { session: null }, error: { message: 'x' } });
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Sesi belum berhasil disiapkan/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tombol dikunci saat mengirim (Escape dan Batal diabaikan)', async () => {
    let selesai: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { selesai = r; }));
    const dialog = bukaForm();
    isi(dialog); centang(dialog); kirim(dialog);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    selesai(new Response(JSON.stringify({ data: { id: '30000000-0000-4000-8000-000000000001' } }), { status: 201 }));
    await within(dialog).findByRole('status');
  });
});

describe('FormulirMinat kanal dokumen', () => {
  it('memakai rute /lead, tanpa nomor HP, pesan opsional, doc_id', async () => {
    render(<FormulirMinat terbuka onTutup={() => {}} kanal="dokumen" refId="40000000-0000-4000-8000-000000000001" konteks="Profil Kopi" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Ajukan Minat Investasi');
    expect(within(dialog).queryByLabelText(/^Nomor HP/)).toBeNull();
    expect(within(dialog).getByRole('checkbox')).toHaveAccessibleName(/nama, email, instansi, dan pesan/);
    isi(dialog, { Pesan: '' }); centang(dialog); kirim(dialog);
    expect(await within(dialog).findByText(/Permintaan Anda tercatat/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/investasi/lead');
    expect(badan()).toMatchObject({ doc_id: '40000000-0000-4000-8000-000000000001', setuju_pdp: true, situs_web: '' });
    expect(badan()).not.toHaveProperty('ipro_id');
    expect(badan()).not.toHaveProperty('pesan');
  });
});
