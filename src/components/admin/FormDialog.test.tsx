// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FormDialog from './FormDialog';

afterEach(cleanup);

interface Opsi {
  mengirim?: boolean;
  galat?: string | null;
  kirimNonaktif?: boolean;
  maxWidth?: number;
  onSubmit?: () => void;
  onClose?: () => void;
}

// Pemicu + dialog: fokus harus kembali ke "Buka" setelah dialog ditutup.
function Contoh({ mengirim = false, galat = null, kirimNonaktif, maxWidth, onSubmit = () => undefined, onClose }: Opsi) {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBuka(true)}>
        Buka
      </button>
      {buka && (
        <FormDialog
          judul={<span>Alihkan tiket</span>}
          deskripsi="Pilih tujuan."
          labelKirim="Alihkan"
          mengirim={mengirim}
          kirimNonaktif={kirimNonaktif}
          galat={galat}
          maxWidth={maxWidth}
          onClose={() => {
            onClose?.();
            setBuka(false);
          }}
          onSubmit={onSubmit}
        >
          {({ galat: idGalat }) => (
            <label>
              Alasan <input type="text" aria-describedby={idGalat} />
            </label>
          )}
        </FormDialog>
      )}
    </>
  );
}

function buka(opsi: Opsi = {}) {
  render(<Contoh {...opsi} />);
  const pemicu = screen.getByRole('button', { name: 'Buka' });
  pemicu.focus();
  fireEvent.click(pemicu);
  return { pemicu, dialog: screen.getByRole('dialog') };
}

describe('FormDialog', () => {
  it('role dialog + aria-modal, nama dari judul, deskripsi terhubung', () => {
    const { dialog } = buka();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Alihkan tiket');
    expect(dialog).toHaveAccessibleDescription('Pilih tujuan.');
  });

  it('judul menjadi heading level 2 di dalam dialog', () => {
    const { dialog } = buka();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Alihkan tiket' })).toBeInTheDocument();
  });

  it('fokus awal ke isian pertama, bukan tombol Tutup', () => {
    const { dialog } = buka();
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
  });

  it('Escape menutup dan fokus kembali ke pemicu', () => {
    const onClose = vi.fn();
    const { pemicu } = buka({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });

  it('selama mengirim Escape diabaikan; tombol Tutup, Batal, dan Kirim terkunci', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ mengirim: true, onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Tutup' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeDisabled();
    const kirim = within(dialog).getByRole('button', { name: 'Memproses…' });
    expect(kirim).toBeDisabled();
    expect(kirim).toHaveAttribute('aria-busy', 'true');
  });

  it('Tab berputar di dalam dialog (jebak fokus), Shift+Tab sebaliknya', () => {
    const { dialog } = buka();
    const tutup = within(dialog).getByRole('button', { name: 'Tutup' });
    const kirim = within(dialog).getByRole('button', { name: 'Alihkan' });
    kirim.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(tutup).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(kirim).toHaveFocus();
  });

  it('klik latar tidak menutup (isian tidak hilang tak sengaja)', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ onClose });
    const latar = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(latar);
    fireEvent.click(latar);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('tombol Tutup dan Batal memanggil onClose', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ onClose });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tombol Tutup di kepala memanggil onClose', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ onClose });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tombol kirim di kaki mengirim formulir tepat sekali; formulir ada di dalam dialog', () => {
    const onSubmit = vi.fn();
    const { dialog } = buka({ onSubmit });
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('novalidate');
    expect(form).toContainElement(within(dialog).getByRole('textbox'));
    expect(form).toContainElement(within(dialog).getByRole('button', { name: 'Alihkan' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Alihkan' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submit saat mengirim atau kirimNonaktif tidak memanggil onSubmit', () => {
    const onSubmit = vi.fn();
    const { dialog } = buka({ mengirim: true, onSubmit });
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();

    const onSubmit2 = vi.fn();
    const { dialog: d2 } = buka({ kirimNonaktif: true, onSubmit: onSubmit2 });
    const kirim = within(d2).getByRole('button', { name: 'Alihkan' });
    expect(kirim).toBeDisabled();
    fireEvent.click(kirim);
    expect(onSubmit2).not.toHaveBeenCalled();
  });

  it('galat tingkat formulir tampil di role=alert dan idnya diteruskan ke children', () => {
    const { dialog } = buka({ galat: 'Gagal mengalihkan.' });
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('Gagal mengalihkan.');
    expect(within(dialog).getByRole('textbox')).toHaveAttribute('aria-describedby', alert.id);
  });

  it('tanpa galat tidak ada role=alert', () => {
    const { dialog } = buka();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('lebar maksimum bawaan 520 px dan bisa diatur lewat maxWidth', () => {
    const lebar = (d: HTMLElement) =>
      [d, ...Array.from(d.querySelectorAll<HTMLElement>('form'))].map((e) => e.style.maxWidth).find(Boolean);
    const { dialog } = buka();
    expect(lebar(dialog)).toBe('520px');
    cleanup();
    const { dialog: d2 } = buka({ maxWidth: 460 });
    expect(lebar(d2)).toBe('460px');
  });

  it('mengunci gulir halaman selama terbuka lalu mengembalikannya', () => {
    document.body.style.overflow = 'auto';
    buka();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});
