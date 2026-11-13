// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KerangkaModal from './KerangkaModal';

afterEach(cleanup);

function pasang(props: Partial<React.ComponentProps<typeof KerangkaModal>> = {}) {
  const onTutup = vi.fn();
  render(
    <KerangkaModal terbuka onTutup={onTutup} judul="Judul kotak" varian="dialog" {...props}>
      <input type="text" aria-label="Isian" />
    </KerangkaModal>,
  );
  return { onTutup };
}

describe('KerangkaModal: perilaku bawaan', () => {
  it('Esc memanggil onTutup; dikunci mengabaikan Esc dan menonaktifkan X', () => {
    const a = pasang();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(a.onTutup).toHaveBeenCalledTimes(1);
    cleanup();

    const b = pasang({ dikunci: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(b.onTutup).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Tutup dialog' })).toBeDisabled();
  });
});

describe('KerangkaModal: onEscape dan escapeDikunci', () => {
  it('Esc memanggil onEscape, bukan onTutup; tombol X tetap memanggil onTutup', () => {
    const onEscape = vi.fn();
    const { onTutup } = pasang({ onEscape });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onTutup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup dialog' }));
    expect(onTutup).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('escapeDikunci mengabaikan Esc tanpa menonaktifkan X', () => {
    const onEscape = vi.fn();
    const { onTutup } = pasang({ onEscape, escapeDikunci: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    expect(onTutup).not.toHaveBeenCalled();
    const x = screen.getByRole('button', { name: 'Tutup dialog' });
    expect(x).toBeEnabled();
    fireEvent.click(x);
    expect(onTutup).toHaveBeenCalledTimes(1);
  });

  it('escapeDikunci=false menimpa dikunci: Esc tetap jalan, X nonaktif', () => {
    const { onTutup } = pasang({ dikunci: true, escapeDikunci: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Tutup dialog' })).toBeDisabled();
  });
});

describe('KerangkaModal: slot tambahan', () => {
  it('lencanaJudul di samping h2 tanpa masuk ke nama aksesibel dialog', () => {
    pasang({ lencanaJudul: <span data-testid="lencana">Sedang Dilayani</span> });
    const dialog = screen.getByRole('dialog', { name: 'Judul kotak' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Judul kotak$/);
    expect(dialog).toContainElement(screen.getByTestId('lencana'));
    expect(screen.getByTestId('lencana').closest('h2')).toBeNull();
  });

  it('tambahanKepala berada di kepala sesudah deskripsi dan di luar deskripsi', () => {
    pasang({ deskripsi: 'Penjelasan', tambahanKepala: <p role="status">Peringatan</p> });
    const deskripsi = screen.getByText('Penjelasan');
    const status = screen.getByRole('status');
    expect(deskripsi.parentElement).toContainElement(status);
    expect(deskripsi).not.toContainElement(status);
    expect(deskripsi.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Penjelasan');
  });

  it('bawahKepala di antara kepala dan badan; atasKaki di antara badan dan kaki', () => {
    pasang({
      bawahKepala: <div data-testid="bawah-kepala" />,
      atasKaki: <div data-testid="atas-kaki" />,
      kaki: <button type="button">Simpan</button>,
    });
    const kepala = screen.getByRole('banner');
    const bawahKepala = screen.getByTestId('bawah-kepala');
    const isian = screen.getByLabelText('Isian');
    const atasKaki = screen.getByTestId('atas-kaki');
    const kaki = screen.getByRole('contentinfo');
    const ikut = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(ikut(kepala, bawahKepala)).toBe(true);
    expect(ikut(bawahKepala, isian)).toBe(true);
    expect(ikut(isian, atasKaki)).toBe(true);
    expect(ikut(atasKaki, kaki)).toBe(true);
    // Keduanya di luar area gulir badan.
    expect(isian.parentElement?.contains(bawahKepala)).toBe(false);
    expect(isian.parentElement?.contains(atasKaki)).toBe(false);
  });

  it('atasKaki berada di dalam form saat onKirim', () => {
    pasang({ onKirim: (e) => e.preventDefault(), atasKaki: <div data-testid="atas-kaki" />, kaki: <button type="submit">Kirim</button> });
    expect(screen.getByTestId('atas-kaki').closest('form')).not.toBeNull();
  });
});

describe('KerangkaModal: penuhDiHp', () => {
  it('penuhDiHp menambah kelas layar penuh HP pada latar dan kotak; bawaan tidak', () => {
    pasang({ penuhDiHp: true });
    const kotak = screen.getByRole('dialog');
    expect(kotak.className).toMatch(/kotakPenuhHp/);
    expect(kotak.parentElement?.className).toMatch(/latarPenuhHp/);
    cleanup();

    pasang();
    const biasa = screen.getByRole('dialog');
    expect(biasa.className).not.toMatch(/kotakPenuhHp/);
    expect(biasa.parentElement?.className).not.toMatch(/latarPenuhHp/);
  });
});
