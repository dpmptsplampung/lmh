// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@/components/Toast';
import KerangkaModal from './KerangkaModal';

afterEach(cleanup);

function Aplikasi({ onTutup, tutupDenganLatar = false }: { onTutup: () => void; tutupDenganLatar?: boolean }) {
  const { toast } = useToast();
  const [buka, setBuka] = useState(false);
  return (
    <>
      <button type="button" onClick={() => toast('Gagal menyimpan', 'error')}>
        picu
      </button>
      <button type="button" onClick={() => setBuka((b) => !b)}>
        modal
      </button>
      <KerangkaModal
        terbuka={buka}
        onTutup={() => {
          onTutup();
          setBuka(false);
        }}
        judul="Judul"
        varian="dialog"
        tutupDenganLatar={tutupDenganLatar}
      >
        <input type="text" aria-label="Isian" />
      </KerangkaModal>
    </>
  );
}

function pasang(onTutup = vi.fn(), tutupDenganLatar = false) {
  render(
    <ToastProvider>
      <Aplikasi onTutup={onTutup} tutupDenganLatar={tutupDenganLatar} />
    </ToastProvider>,
  );
  return onTutup;
}

describe('Toast di dalam modal', () => {
  it('saat modal terbuka, toast berada di dalam subtree <dialog> (tidak inert)', () => {
    pasang();
    fireEvent.click(screen.getByRole('button', { name: 'modal' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'picu' }));
    });
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const alert = screen.getByRole('alert');
    expect(dialog.contains(alert)).toBe(true);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('tombol tutup toast menutup toast tanpa menutup dialog, meski tutupDenganLatar aktif', () => {
    const onTutup = pasang(vi.fn(), true);
    fireEvent.click(screen.getByRole('button', { name: 'modal' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'picu' }));
    });
    const tutup = screen.getByRole('button', { name: 'Tutup notifikasi' });
    fireEvent.mouseDown(tutup);
    fireEvent.click(tutup);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onTutup).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('Esc pada tombol tutup toast hanya menutup toast, bukan dialog', () => {
    const onTutup = pasang();
    fireEvent.click(screen.getByRole('button', { name: 'modal' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'picu' }));
    });
    // fireEvent mengembalikan false bila keydown di-preventDefault: itu yang mencegah peramban memicu `cancel` pada <dialog>.
    const tidakDicegah = fireEvent.keyDown(screen.getByRole('button', { name: 'Tutup notifikasi' }), { key: 'Escape' });
    expect(tidakDicegah).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onTutup).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).not.toBeNull();

    // Esc kedua (fokus di dalam dialog, bukan di toast) menutup dialog seperti biasa.
    fireEvent.keyDown(screen.getByLabelText('Isian'), { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('Esc di dialog tanpa toast menutup dialog', () => {
    const onTutup = pasang();
    fireEvent.click(screen.getByRole('button', { name: 'modal' }));
    fireEvent.keyDown(screen.getByLabelText('Isian'), { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('toast yang tampil sebelum modal ikut pindah ke dalam dialog, lalu kembali keluar saat modal ditutup', () => {
    pasang();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'picu' }));
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'modal' }));
    expect(document.querySelector('dialog')!.contains(screen.getByRole('alert'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Tutup dialog' }));
    expect(document.querySelector('dialog')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Gagal menyimpan');
    expect(alert.closest('dialog')).toBeNull();
  });
});
