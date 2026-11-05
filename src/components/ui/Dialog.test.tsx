// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dialog from './Dialog';
import PanelSamping from './PanelSamping';

afterEach(cleanup);

function Contoh({ dikunci = false, latar = false }: { dikunci?: boolean; latar?: boolean }) {
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBuka(true)}>
        Buka
      </button>
      <Dialog
        terbuka={buka}
        onTutup={() => setBuka(false)}
        judul="Alihkan tiket"
        deskripsi="Pilih tujuan."
        dikunci={dikunci}
        tutupDenganLatar={latar}
        kaki={<button type="button">Simpan</button>}
      >
        <label>
          Alasan <input type="text" />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('tidak dirender saat tertutup', () => {
    render(<Contoh />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('role dialog + aria-modal, nama dari judul, deskripsi terhubung', () => {
    render(<Contoh />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    const d = screen.getByRole('dialog', { name: 'Alihkan tiket' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleDescription('Pilih tujuan.');
  });

  it('fokus pindah ke isian pertama, Esc menutup, fokus kembali ke pemicu', () => {
    render(<Contoh />);
    const pemicu = screen.getByRole('button', { name: 'Buka' });
    pemicu.focus();
    fireEvent.click(pemicu);
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });

  it('Tab berputar di dalam dialog (jebak fokus)', () => {
    render(<Contoh />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    const simpan = screen.getByRole('button', { name: 'Simpan' });
    simpan.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Tutup dialog' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(simpan).toHaveFocus();
  });

  it('dikunci: Esc dan tombol tutup tidak menutup', () => {
    render(<Contoh dikunci />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tutup dialog' })).toBeDisabled();
  });

  it('klik latar menutup hanya bila tutupDenganLatar', () => {
    const { unmount } = render(<Contoh />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();
    render(<Contoh latar />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mengunci gulir body selama terbuka dan memulihkannya', () => {
    render(<Contoh />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });
});

describe('PanelSamping', () => {
  it('berperilaku sebagai dialog modal dengan kaki dan tombol tutup', () => {
    const onTutup = vi.fn();
    render(
      <PanelSamping terbuka onTutup={onTutup} judul="Tambah widget" lebar="lebar" kaki={<button type="button">Terapkan</button>}>
        isi panel
      </PanelSamping>,
    );
    expect(screen.getByRole('dialog', { name: 'Tambah widget' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('isi panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup dialog' }));
    expect(onTutup).toHaveBeenCalledTimes(1);
  });
});
