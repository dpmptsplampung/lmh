// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import PerluTindakan, { BATAS_MEMUAT_MS, susunTindakan } from './PerluTindakan';
import type { NavBadges } from '@/lib/hooks/useNavBadges';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const lencana = (n: number): NavBadges[keyof NavBadges] => ({ count: n, label: `${n}` });

describe('susunTindakan', () => {
  it('berurut berdasar bobot; SLA terlambat paling atas; jumlah 0 dibuang', () => {
    const badges: NavBadges = {
      antrian: lencana(17), liveChat: lencana(2), kotakMasukFo: lencana(4), pengaduan: lencana(0), saran: lencana(1),
    };
    const baris = susunTindakan(badges, { terlambat: 3, mendekati: 1 });
    expect(baris.map((b) => b.kunci)).toEqual(['sla-terlambat', 'sla-mendekati', 'kotakMasukFo', 'liveChat', 'antrian', 'saran']);
  });

  it('sla null: tidak ada baris SLA, bukan baris bernilai 0', () => {
    expect(susunTindakan({ pengaduan: lencana(2) }, null).map((b) => b.kunci)).toEqual(['pengaduan']);
  });
});

describe('PerluTindakan', () => {
  it('menampilkan tiap baris sebagai tautan ke halamannya dengan jumlah dan teks', () => {
    render(<PerluTindakan memuat={false} sla={{ terlambat: 3, mendekati: 0 }} badges={{ kotakMasukFo: lencana(4), liveChat: lencana(2), antrian: lencana(17) }} />);
    const daftar = screen.getByRole('list');
    const tautan = within(daftar).getAllByRole('link');
    expect(tautan.map((a) => a.getAttribute('href'))).toEqual(['/admin/pengaduan', '/admin/fo/kotak-masuk', '/admin/chat', '/admin/antrian']);
    expect(within(tautan[0]).getByText('3')).toBeInTheDocument();
    expect(within(tautan[0]).getByText('pengaduan terlambat SLA')).toBeInTheDocument();
    expect(within(tautan[3]).getByText('tiket menunggu di antrean')).toBeInTheDocument();
  });

  it('semua nol: "Tidak ada yang mendesak" sebagai keadaan baik', () => {
    render(<PerluTindakan memuat={false} sla={{ terlambat: 0, mendekati: 0 }} badges={{ antrian: lencana(0), saran: lencana(0) }} />);
    expect(screen.getByText('Tidak ada yang mendesak')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('memuat: kerangka (bukan "Tidak ada yang mendesak" palsu)', () => {
    const { container } = render(<PerluTindakan memuat sla={null} badges={{}} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('Tidak ada yang mendesak')).toBeNull();
  });

  it('memuat terlalu lama: catatan jelas, bukan kerangka selamanya dan bukan keadaan baik', () => {
    vi.useFakeTimers();
    render(<PerluTindakan memuat sla={null} badges={{}} />);
    act(() => { vi.advanceTimersByTime(BATAS_MEMUAT_MS + 10); });
    expect(screen.getByText(/belum dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Tidak ada yang mendesak')).toBeNull();
  });
});
