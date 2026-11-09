// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FormulirKatalog from './FormulirKatalog';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth }) }));
const id = '10000000-0000-4000-8000-000000000001';
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInAnonymously.mockResolvedValue({ data: { session: { user: { id: 'sintetis' } } }, error: null });
  request = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 'receipt-acak' } }))));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function fill() {
  for (const [label, value] of Object.entries({
    'Nama Anda': 'Pengirim Uji', Perusahaan: 'Usaha Uji', 'Nomor kontak': '081200001111', Pesan: 'Mencari produk kopi',
  })) fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
}

describe('formulir publik', () => {
  it.each([
    ['pesan', 'Selesai'], ['laporan', 'Selesai'],
    ['pesan', 'Tutup dialog'], ['laporan', 'Tutup dialog'],
    ['pesan', 'Escape'], ['laporan', 'Escape'],
  ] as const)('membuka %s baru setelah sukses ditutup lewat %s', async (jenis, tutup) => {
    const onTutup = vi.fn();
    const props = { jenis, konteks: { profil_id: id }, onTutup };
    const { rerender } = render(<FormulirKatalog telemetriAktif={false} {...props} terbuka />);
    const isi = () => {
      if (jenis === 'pesan') fill();
      else {
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nomor_tampil' } });
        fireEvent.change(screen.getByLabelText('Catatan (opsional)'), { target: { value: 'Nomor pada foto' } });
      }
    };
    isi();
    fireEvent.click(screen.getByRole('button', { name: `Kirim ${jenis}` }));
    await screen.findByRole('button', { name: 'Selesai' });
    const first = JSON.parse(request.mock.calls[0][1].body);
    // Biarkan efek dialog terpasang dulu; saat mesin sibuk tombol Escape bisa datang sebelum pendengarnya siap.
    await act(async () => {});
    if (tutup === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: tutup }));
    expect(onTutup).toHaveBeenCalledOnce();
    rerender(<FormulirKatalog telemetriAktif={false} {...props} terbuka={false} />);
    rerender(<FormulirKatalog telemetriAktif={false} {...props} terbuka />);
    expect(screen.queryByText(/^(Pesan|Laporan) diterima/)).toBeNull();
    if (jenis === 'pesan') {
      for (const field of screen.getAllByRole('textbox')) expect(field).toHaveValue('');
    } else {
      expect(screen.getByRole('combobox')).toHaveValue('');
      expect(screen.getByLabelText('Catatan (opsional)')).toHaveValue('');
    }
    isi();
    fireEvent.click(screen.getByRole('button', { name: `Kirim ${jenis}` }));
    await screen.findByRole('button', { name: 'Selesai' });
    expect(JSON.parse(request.mock.calls[1][1].body).operasi_id).not.toBe(first.operasi_id);
  });

  it('menutup hasil belum pasti mempertahankan isian dan kunci saat dibuka lagi', async () => {
    request.mockRejectedValueOnce(new TypeError('Koneksi terputus'));
    const props = { jenis: 'pesan' as const, konteks: { profil_id: id }, onTutup: vi.fn() };
    const { rerender } = render(<FormulirKatalog telemetriAktif={false} {...props} terbuka />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    await screen.findByRole('alert');
    const first = JSON.parse(request.mock.calls[0][1].body);
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    rerender(<FormulirKatalog telemetriAktif={false} {...props} terbuka={false} />);
    rerender(<FormulirKatalog telemetriAktif={false} {...props} terbuka />);
    expect(screen.getByRole('textbox', { name: 'Pesan' })).toHaveValue('Mencari produk kopi');
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    await screen.findByRole('button', { name: 'Selesai' });
    expect(JSON.parse(request.mock.calls[1][1].body).operasi_id).toBe(first.operasi_id);
  });

  it.each([
    ['pesan', 'Pesan', 1000], ['laporan', 'Catatan (opsional)', 500],
  ] as const)('membatasi isian %s sesuai kontrak', (jenis, label, batas) => {
    render(<FormulirKatalog telemetriAktif={false} terbuka jenis={jenis} konteks={{ profil_id: id }} onTutup={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('maxlength', String(batas));
  });

  it('menyiapkan sesi anon dan mengirim konteks tanpa meminta isian tambahan', async () => {
    render(<FormulirKatalog telemetriAktif={false} terbuka jenis="pesan" konteks={{ profil_id: id, nama: 'Kopi Lampung' }}
      onTutup={vi.fn()} />);
    fill();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Pesan diterima');
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
    const payload = JSON.parse(request.mock.calls[0][1].body);
    expect(payload).toMatchObject({ profil_id: id, nama: 'Pengirim Uji', pesan: 'Mencari produk kopi' });
    expect(payload.operasi_id).toBeTruthy();
    expect(document.body.textContent).not.toContain('receipt-acak');
  });

  it('sesi yang sudah ada dipakai kembali dan laporan hanya membawa profil, foto, alasan, catatan', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'pengunjung' } } }, error: null });
    render(<FormulirKatalog telemetriAktif={false} terbuka jenis="laporan" konteks={{ profil_id: id, foto_id: 'foto-uji' }}
      onTutup={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Alasan laporan' }), { target: { value: 'nomor_tampil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim laporan' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Laporan diterima');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      profil_id: id, foto_id: 'foto-uji', alasan: 'nomor_tampil',
    });
    expect(screen.queryByLabelText('Nomor kontak')).toBeNull();
  });

  it('pengiriman tidak pasti memakai kunci sama sampai isian berubah', async () => {
    request.mockRejectedValue(new TypeError('Koneksi terputus'));
    render(<FormulirKatalog telemetriAktif={false} terbuka jenis="pesan" konteks={{ kata_kunci: 'kopi' }} onTutup={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    await screen.findByRole('alert');
    const first = JSON.parse(request.mock.calls[0][1].body);
    expect(first).toMatchObject({ kata_kunci: 'kopi' });
    expect(first).not.toHaveProperty('profil_id');
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kirim pesan' })).not.toHaveAttribute('aria-busy'));
    expect(JSON.parse(request.mock.calls[1][1].body).operasi_id).toBe(first.operasi_id);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesan' }), { target: { value: 'Perubahan pesan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(JSON.parse(request.mock.calls[2][1].body).operasi_id).not.toBe(first.operasi_id);
  });

  it('429 mengumumkan galat tanpa angka batas dan mempertahankan isian', async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'TERLALU_BANYAK', message: '10/600' } }),
      { status: 429 }));
    render(<FormulirKatalog telemetriAktif={false} terbuka jenis="pesan" konteks={{}} onTutup={vi.fn()} />);
    fill(); fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Permintaan sedang padat');
    expect(alert.textContent).not.toContain('10/600');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Pesan' })).toHaveValue('Mencari produk kopi');
  });
});
