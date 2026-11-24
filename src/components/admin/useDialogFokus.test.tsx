// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Dialog from '@/components/ui/Dialog';

afterEach(cleanup);

function Bertumpuk() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setA(true)}>Buka A</button>
      <Dialog terbuka={a} onTutup={() => setA(false)} judul="Dialog A" kaki={<button type="button" onClick={() => setB(true)}>Buka B</button>}>
        <p>Isi A</p>
      </Dialog>
      <Dialog terbuka={b} onTutup={() => setB(false)} judul="Dialog B">
        <label>Isian B <input type="text" /></label>
      </Dialog>
    </>
  );
}

describe('useDialogFokus: dialog bertumpuk', () => {
  it('Esc hanya menutup dialog teratas, Esc berikutnya menutup yang di bawah', () => {
    render(<Bertumpuk />);
    fireEvent.click(screen.getByRole('button', { name: 'Buka A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buka B' }));
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Dialog B', hidden: true })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Dialog A', hidden: true })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('fokus kembali ke pemicu dialog teratas, juga di StrictMode (efek ganda)', () => {
    render(
      <StrictMode>
        <Bertumpuk />
      </StrictMode>,
    );
    const bukaA = screen.getByRole('button', { name: 'Buka A' });
    bukaA.focus();
    fireEvent.click(bukaA);
    const bukaB = screen.getByRole('button', { name: 'Buka B' });
    bukaB.focus();
    fireEvent.click(bukaB);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bukaB).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bukaA).toHaveFocus();
  });
});
