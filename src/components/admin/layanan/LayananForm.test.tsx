// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LayananForm, { type LayananRow } from './LayananForm';

const LAYANAN: LayananRow = {
  id: 'L1', nama: 'Helpdesk OSS', nomor_loket: '1', prefiks_antrean: 'HO', status_tampilan: 'aktif', tampil_di_layar: true,
  punya_antrean: true, punya_chat: true, form_pendataan: 'oss', slug: 'helpdesk-oss', urutan: 1, website_terkait: [], tampil_di_homepage: true,
} as unknown as LayananRow;

function tampil(onSubmit = vi.fn()) {
  render(<LayananForm layanan={LAYANAN} instansi={[]} saving={false} error="" onSubmit={onSubmit} onCancel={() => {}} />);
  return onSubmit;
}

afterEach(() => cleanup());

describe('LayananForm: konfirmasi ganti nama (B-06, C3-07)', () => {
  it('tekan Simpan setelah ganti nama: peringatan muncul sebagai alert biasa (bukan alertdialog), digulir dan difokuskan', () => {
    const gulir = vi.fn();
    Element.prototype.scrollIntoView = gulir;
    const onSubmit = tampil();
    fireEvent.change(screen.getByLabelText(/Nama layanan/), { target: { value: 'Helpdesk OSS Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const peringatan = screen.getByRole('alert', { name: /Konfirmasi ganti nama/ });
    expect(peringatan).toHaveTextContent(/Helpdesk OSS Baru/);
    expect(peringatan).toHaveFocus();
    expect(gulir).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ya, ganti nama' })).toBeInTheDocument();
  });

  it('"Ya, ganti nama" mengirim perubahan nama', () => {
    const onSubmit = tampil();
    fireEvent.change(screen.getByLabelText(/Nama layanan/), { target: { value: 'Helpdesk OSS Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, ganti nama' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].patch).toEqual({ nama: 'Helpdesk OSS Baru' });
  });

  it('mengetik ulang nama menutup peringatan', () => {
    tampil();
    fireEvent.change(screen.getByLabelText(/Nama layanan/), { target: { value: 'Helpdesk OSS Baru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    fireEvent.change(screen.getByLabelText(/Nama layanan/), { target: { value: 'Helpdesk OSS Baru 2' } });
    expect(screen.queryByRole('alert', { name: /Konfirmasi ganti nama/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeInTheDocument();
  });
});
