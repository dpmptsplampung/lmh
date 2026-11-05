// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const klik = vi.hoisted(() => vi.fn());
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(e) => { klik(href); onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));

import PerintahCepat, { saring, susunPerintah } from './PerintahCepat';

afterEach(() => {
  cleanup();
  klik.mockClear();
  document.body.style.overflow = '';
});

const label = (role: string) => susunPerintah(role).map((p) => p.label);

describe('susunPerintah: hak akses mengikuti peran', () => {
  it('petugas: tanpa tindakan Front Office/Admin dan tanpa menu admin-saja', () => {
    const l = label('petugas');
    expect(l).not.toContain('Registrasi Walk-in');
    expect(l).not.toContain('Scan QR');
    expect(l).not.toContain('Buka layar TV');
    expect(l).not.toContain('Kelola Petugas');
    expect(l).toContain('Antrean');
    expect(l).toContain('Profil Saya');
  });

  it('front_office: Registrasi Walk-in dan Scan QR, tanpa layar TV dan menu admin', () => {
    const l = label('front_office');
    expect(l).toContain('Registrasi Walk-in');
    expect(l).toContain('Scan QR');
    expect(l).not.toContain('Buka layar TV');
    expect(l).not.toContain('Kelola Layar');
    expect(l).not.toContain('Log AI Chat');
  });

  it('admin: semua tindakan dan menu; tindakan lebih dulu', () => {
    const p = susunPerintah('admin');
    expect(p.slice(0, 3).map((x) => x.label)).toEqual(['Registrasi Walk-in', 'Scan QR', 'Buka layar TV']);
    expect(p.map((x) => x.label)).toEqual(expect.arrayContaining(['Dasbor', 'Kelola Petugas', 'Log AI Chat', 'Tampilan Publik']));
  });

  it('tidak memuat "Panggil berikutnya" (gelombang 2) dan tidak memuat entri tersembunyi', () => {
    for (const role of ['admin', 'front_office', 'petugas']) {
      expect(label(role)).not.toContain('Panggil berikutnya');
      expect(label(role).filter((teks) => teks === 'Hasil Survei')).toHaveLength(1);
      expect(label(role)).not.toContain('Rekap Front Office');
    }
  });

  it('peran tak dikenal atau kosong: tidak ada perintah', () => {
    expect(susunPerintah(null)).toEqual([]);
    expect(susunPerintah('pengunjung')).toEqual([]);
  });

  it('id unik per entri (tindakan "Buka layar TV" sengaja menuju halaman yang sama dengan menu Kelola Layar)', () => {
    const ids = susunPerintah('admin').map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('saring', () => {
  const daftar = susunPerintah('admin');
  it('kueri kosong = semua', () => expect(saring(daftar, '  ')).toHaveLength(daftar.length));
  it('tidak peka huruf besar dan semua kata harus cocok', () => {
    expect(saring(daftar, 'LIVE chat').map((p) => p.label)).toEqual(['Live Chat']);
    expect(saring(daftar, 'chat log').map((p) => p.label)).toEqual(['Log AI Chat']);
  });
  it('mencocokkan nama kelompok dan kata tambahan tindakan', () => {
    expect(saring(daftar, 'kemitraan').map((p) => p.label)).toEqual(['UMKM', 'Lead Investasi', 'Investment Gallery']);
    expect(saring(daftar, 'tv').map((p) => p.label)).toContain('Buka layar TV');
  });
  it('tidak ada yang cocok = kosong', () => expect(saring(daftar, 'zzzz')).toEqual([]));
});

describe('PerintahCepat: keyboard dan ARIA', () => {
  const buka = () => fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

  it('tertutup bawaan; Ctrl K membuka dialog dengan combobox + listbox, fokus di isian', () => {
    render(<PerintahCepat role="front_office" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    buka();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    const kotak = screen.getByRole('combobox');
    expect(kotak).toHaveFocus();
    expect(kotak).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(5);
    expect(kotak.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('Cmd K juga membuka', () => {
    render(<PerintahCepat role="admin" />);
    fireEvent.keyDown(document, { key: 'K', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('"/" membuka saat fokus di luar isian, tetapi tidak saat mengetik di isian lain', () => {
    render(
      <>
        <input aria-label="lain" />
        <PerintahCepat role="admin" />
      </>,
    );
    const lain = screen.getByLabelText('lain');
    lain.focus();
    fireEvent.keyDown(lain, { key: '/' });
    expect(screen.queryByRole('dialog')).toBeNull();
    lain.blur();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Esc menutup dan fokus kembali ke elemen yang memicu', () => {
    render(
      <>
        <button>pemicu</button>
        <PerintahCepat role="admin" />
      </>,
    );
    const pemicu = screen.getByRole('button', { name: 'pemicu' });
    pemicu.focus();
    buka();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('mengetik menyaring hasil; panah menggeser pilihan; Enter membuka tautan terpilih dan menutup', () => {
    render(<PerintahCepat role="admin" />);
    buka();
    const kotak = screen.getByRole('combobox');
    fireEvent.change(kotak, { target: { value: 'chat' } });
    const opsi = screen.getAllByRole('option');
    expect(opsi.map((o) => o.textContent)).toEqual(['Live ChatLayanan Online', 'Log AI ChatLayanan Online']);
    expect(opsi[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(kotak, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(kotak.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(kotak, { key: 'Enter' });
    expect(klik).toHaveBeenCalledWith('/admin/chat/ai-log');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ArrowUp dari pilihan pertama berputar ke terakhir; Home dan End', () => {
    render(<PerintahCepat role="admin" />);
    buka();
    const kotak = screen.getByRole('combobox');
    const n = screen.getAllByRole('option').length;
    fireEvent.keyDown(kotak, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[n - 1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(kotak, { key: 'Home' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(kotak, { key: 'End' });
    expect(screen.getAllByRole('option')[n - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('tanpa hasil: pesan kosong, tanpa aria-activedescendant, Enter tidak melakukan apa pun', () => {
    render(<PerintahCepat role="petugas" />);
    buka();
    const kotak = screen.getByRole('combobox');
    fireEvent.change(kotak, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status')).toHaveTextContent('Tidak ada menu atau tindakan yang cocok');
    expect(kotak).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(kotak, { key: 'Enter' });
    expect(klik).not.toHaveBeenCalled();
  });

  it('Tab tidak melepas fokus dari dialog', () => {
    render(<PerintahCepat role="admin" />);
    buka();
    const kotak = screen.getByRole('combobox');
    expect(fireEvent.keyDown(kotak, { key: 'Tab' })).toBe(false); // preventDefault dipanggil
  });

  it('klik latar menutup; klik pilihan menutup dan menavigasi', () => {
    const { container } = render(<PerintahCepat role="front_office" />);
    buka();
    fireEvent.mouseDown(container.querySelector('[role="presentation"]')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    buka();
    fireEvent.click(screen.getByRole('option', { name: /Registrasi Walk-in/ }));
    expect(klik).toHaveBeenCalledWith('/admin/fo/registrasi?tab=walkin');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('peran belum diketahui: pintasan tidak aktif', () => {
    render(<PerintahCepat role={null} />);
    buka();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mode terkendali: onUbah dipanggil saat pintasan dan penutupan', () => {
    const onUbah = vi.fn();
    const { rerender } = render(<PerintahCepat role="admin" buka={false} onUbah={onUbah} />);
    buka();
    expect(onUbah).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull(); // induk yang memegang state
    rerender(<PerintahCepat role="admin" buka onUbah={onUbah} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onUbah).toHaveBeenLastCalledWith(false);
  });
});
