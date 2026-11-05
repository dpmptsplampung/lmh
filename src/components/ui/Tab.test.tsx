// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Tab, { PanelTab, type ItemTab } from './Tab';

afterEach(cleanup);

const TAB: ItemTab[] = [
  { kunci: 'a', label: 'Harian' },
  { kunci: 'b', label: 'Helpdesk', jumlah: 4 },
  { kunci: 'c', label: 'Nonaktif', nonaktif: true },
  { kunci: 'd', label: 'Kinerja' },
];

function Contoh() {
  const [aktif, setAktif] = useState('a');
  return (
    <>
      <Tab id="t" label="Jenis rekap" tab={TAB} aktif={aktif} onGanti={setAktif} />
      {TAB.map((t) => (
        <PanelTab key={t.kunci} idTab="t" kunci={t.kunci} aktif={aktif}>
          Isi {t.label}
        </PanelTab>
      ))}
    </>
  );
}

describe('Tab (pola ARIA tabs)', () => {
  it('tablist bernama, tab terpilih aria-selected, roving tabindex, panel terhubung', () => {
    render(<Contoh />);
    expect(screen.getByRole('tablist', { name: 'Jenis rekap' })).toBeInTheDocument();
    const a = screen.getByRole('tab', { name: 'Harian' });
    const b = screen.getByRole('tab', { name: /Helpdesk/ });
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(a).toHaveAttribute('tabindex', '0');
    expect(b).toHaveAttribute('aria-selected', 'false');
    expect(b).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Harian');
    expect(a.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
  });

  it('panah kanan/kiri berputar dan melewati tab nonaktif, fokus ikut pindah', () => {
    render(<Contoh />);
    const a = screen.getByRole('tab', { name: 'Harian' });
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    const b = screen.getByRole('tab', { name: /Helpdesk/ });
    expect(b).toHaveAttribute('aria-selected', 'true');
    expect(b).toHaveFocus();
    fireEvent.keyDown(b, { key: 'ArrowRight' });
    const d = screen.getByRole('tab', { name: 'Kinerja' });
    expect(d).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(d, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Harian' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Harian' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Kinerja' })).toHaveFocus();
  });

  it('Home dan End', () => {
    render(<Contoh />);
    const a = screen.getByRole('tab', { name: 'Harian' });
    fireEvent.keyDown(a, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Kinerja' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Kinerja' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Harian' })).toHaveAttribute('aria-selected', 'true');
  });

  it('klik mengganti panel; hanya panel aktif dirender; tab nonaktif tidak bisa dipilih', () => {
    render(<Contoh />);
    fireEvent.click(screen.getByRole('tab', { name: /Helpdesk/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Isi Helpdesk');
    expect(screen.queryByText('Isi Harian')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Nonaktif' })).toBeDisabled();
  });
});
