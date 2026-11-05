// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import TamuForm from './TamuForm';

afterEach(cleanup);

const isi = (label: RegExp, nilai: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: nilai } });
const isiLengkap = () => {
  isi(/^Nama tamu/, 'Budi Santoso');
  isi(/Instansi/, 'CV Maju');
  isi(/Nomor HP/, '0812-3456-7890');
  isi(/Bertemu siapa/, 'Kepala Bidang');
};
const kirim = () => fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));

describe('TamuForm', () => {
  it('urutan isian: nama, instansi, nomor HP, bertemu siapa, tujuan; semua wajib kecuali tujuan', () => {
    render(<TamuForm onSubmit={vi.fn()} />);
    const ids = screen.getAllByRole('textbox').map((e) => e.id);
    expect(ids).toEqual(['tamuNama', 'tamuInstansi', 'tamuHp', 'tamuBertemu', 'tamuTujuan']);
    expect(screen.getByLabelText(/Nomor HP/).getAttribute('inputmode')).toBe('tel');
    expect(screen.getByLabelText(/Tujuan/).closest('.form-group')?.querySelector('.form-label--required')).toBeNull();
    for (const l of [/^Nama tamu/, /Instansi/, /Nomor HP/, /Bertemu siapa/]) {
      expect(screen.getByLabelText(l).getAttribute('aria-required')).toBe('true');
    }
  });

  it('kirim kosong: setiap isian wajib menampilkan galatnya sendiri, tidak memanggil server, fokus ke isian pertama', async () => {
    const onSubmit = vi.fn();
    render(<TamuForm onSubmit={onSubmit} />);
    kirim();
    expect(await screen.findByText('Nama wajib diisi.')).toBeTruthy();
    expect(screen.getByText('Asal / instansi wajib diisi.')).toBeTruthy();
    expect(screen.getByText('Nomor HP wajib diisi.')).toBeTruthy();
    expect(screen.getByText(/Tulis siapa yang ingin ditemui/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Nama tamu/).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText(/^Nama tamu/));
  });

  it('galat nomor HP muncul saat meninggalkan isian dan hilang setelah dibetulkan', () => {
    render(<TamuForm onSubmit={vi.fn()} />);
    const hp = screen.getByLabelText(/Nomor HP/);
    fireEvent.change(hp, { target: { value: '0721123456' } });
    expect(screen.queryByText(/telepon rumah/)).toBeNull(); // belum disentuh
    fireEvent.blur(hp);
    expect(screen.getByText(/telepon rumah\/kantor/)).toBeTruthy();
    expect(hp.getAttribute('aria-invalid')).toBe('true');
    expect(hp.getAttribute('aria-describedby')).toContain('tamuHp-galat');
    fireEvent.change(hp, { target: { value: '081234567890' } });
    expect(screen.queryByText(/telepon rumah/)).toBeNull();
    expect(hp.getAttribute('aria-invalid')).toBeNull();
  });

  it('nama berangka ditolak; nama huruf besar semua dirapikan saat blur; HP dirapikan saat blur', () => {
    render(<TamuForm onSubmit={vi.fn()} />);
    const nama = screen.getByLabelText(/^Nama tamu/) as HTMLInputElement;
    fireEvent.change(nama, { target: { value: 'BUDI123' } });
    fireEvent.blur(nama);
    expect(screen.getByText(/tidak boleh berisi angka/)).toBeTruthy();
    fireEvent.change(nama, { target: { value: 'BUDI  SANTOSO' } });
    fireEvent.blur(nama);
    expect(nama.value).toBe('Budi Santoso');
    const hp = screen.getByLabelText(/Nomor HP/) as HTMLInputElement;
    fireEvent.change(hp, { target: { value: '+62 812 3456 7890' } });
    fireEvent.blur(hp);
    expect(hp.value).toBe('0812-3456-7890');
  });

  it('mengirim data lengkap: HP kanonik 08..., tujuan hanya bila diisi; isian dikosongkan setelah berhasil', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TamuForm onSubmit={onSubmit} />);
    isiLengkap();
    kirim();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      nama: 'Budi Santoso', instansi: 'CV Maju', no_hp: '081234567890', bertemu: 'Kepala Bidang',
    });
    await waitFor(() => expect((screen.getByLabelText(/^Nama tamu/) as HTMLInputElement).value).toBe(''));
    isiLengkap();
    isi(/Tujuan/, 'Audiensi');
    kirim();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ tujuan: 'Audiensi' });
  });

  it('galat dari server ditampilkan sebagai peringatan dan isian tetap terjaga', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Gagal menyimpan tamu'));
    render(<TamuForm onSubmit={onSubmit} />);
    isiLengkap();
    kirim();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Gagal menyimpan tamu/);
    expect((screen.getByLabelText(/^Nama tamu/) as HTMLInputElement).value).toBe('Budi Santoso');
  });
});
