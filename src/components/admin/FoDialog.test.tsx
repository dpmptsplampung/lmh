// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type FormEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FoDialog from './FoDialog';

afterEach(cleanup);

interface Opsi {
  dikunci?: boolean;
  denganDeskripsi?: boolean;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  onClose?: () => void;
}

function Contoh({ dikunci = false, denganDeskripsi = true, onSubmit, onClose }: Opsi) {
  const [buka, setBuka] = useState(false);
  const tutup = () => {
    onClose?.();
    setBuka(false);
  };
  return (
    <>
      <button type="button" onClick={() => setBuka(true)}>
        Buka
      </button>
      {buka && (
        <FoDialog
          judul="Tolak pengunjung"
          deskripsi={denganDeskripsi ? 'Reservasi akan dibatalkan.' : undefined}
          onClose={tutup}
          dikunci={dikunci}
          onSubmit={onSubmit}
          footer={
            <>
              <button type="button" onClick={tutup}>
                Batal
              </button>
              <button type="submit">Tolak</button>
            </>
          }
        >
          <label>
            Alasan <textarea data-autofocus="" />
          </label>
        </FoDialog>
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

describe('FoDialog', () => {
  it('role dialog + aria-modal, nama dari judul, deskripsi terhubung', () => {
    const { dialog } = buka();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Tolak pengunjung');
    expect(dialog).toHaveAccessibleDescription('Reservasi akan dibatalkan.');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Tolak pengunjung' })).toBeInTheDocument();
  });

  it('tanpa deskripsi tidak ada aria-describedby', () => {
    const { dialog } = buka({ denganDeskripsi: false });
    expect(dialog).not.toHaveAttribute('aria-describedby');
  });

  it('fokus awal ke elemen bertanda data-autofocus', () => {
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

  it('dikunci: Escape diabaikan dan tombol Tutup nonaktif', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ dikunci: true, onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Tutup dialog' })).toBeDisabled();
  });

  it('Tab berputar di dalam dialog (jebak fokus), Shift+Tab sebaliknya', () => {
    const { dialog } = buka();
    const tutup = within(dialog).getByRole('button', { name: 'Tutup dialog' });
    const tolak = within(dialog).getByRole('button', { name: 'Tolak' });
    tolak.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(tutup).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(tolak).toHaveFocus();
  });

  it('klik latar tidak menutup', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ onClose });
    const latar = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(latar);
    fireEvent.click(latar);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tombol Tutup di kepala memanggil onClose', () => {
    const onClose = vi.fn();
    const { dialog } = buka({ onClose });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('isi dan kaki berada di dalam satu formulir di dalam dialog; tombol submit kaki memanggil onSubmit', () => {
    const onSubmit = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault());
    const { dialog } = buka({ onSubmit });
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('novalidate');
    expect(form).toContainElement(within(dialog).getByRole('textbox'));
    expect(form).toContainElement(within(dialog).getByRole('button', { name: 'Tolak' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tolak' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('tanpa onSubmit tidak error saat formulir dikirim', () => {
    const { dialog } = buka();
    expect(() => fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)).not.toThrow();
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
