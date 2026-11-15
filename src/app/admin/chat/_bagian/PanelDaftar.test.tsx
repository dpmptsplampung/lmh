// @vitest-environment jsdom
// Kontrak PanelDaftar (tugas 7.3): tampilan murni dari props. Eskalasi di atas, ringkasan, penanda belum dibaca,
// aria-pressed sesi terpilih, keadaan memuat/galat/kosong, dan filter "selesai".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RingkasSesi } from '@/lib/data/chat-staf';
import PanelDaftar, { type PanelDaftarProps } from './PanelDaftar';

const sesi = (o: Partial<RingkasSesi> = {}): RingkasSesi => ({
  id: 's1', status: 'eskalasi', layanan_id: 'l1', pengunjung_id: null, ditangani_oleh: null,
  created_at: '2026-10-14T01:00:00Z', updated_at: '2026-10-14T01:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-10-14T01:00:01Z', last_pengirim: 'pengunjung', unread: true, ...o,
});

const dasar = (o: Partial<PanelDaftarProps> = {}): PanelDaftarProps => ({
  sesi: [sesi()], terpilihId: null, memuat: false, dimuat: true, galat: '', onMuatUlang: vi.fn(), rt: 'ok',
  tampilSelesai: false, onTampilSelesai: vi.fn(), dibuka: {}, layananNama: { l1: 'Helpdesk OSS', l2: 'Bank' },
  kontak: { s1: 'Ani' }, labelStatus: (s) => s.status, pemegang: () => null, onPilih: vi.fn(), ...o,
});

afterEach(cleanup);

describe('PanelDaftar', () => {
  it('eskalasi tampil paling atas dengan ringkasan aktif dan menunggu', () => {
    render(<PanelDaftar {...dasar({ sesi: [sesi({ id: 'a', status: 'bot', layanan_id: 'l2' }), sesi({ id: 'b' })] })} />);
    const tombol = screen.getAllByRole('button', { name: /Helpdesk OSS|Bank/ });
    expect(tombol[0].textContent).toMatch(/Helpdesk OSS/);
    expect(screen.getByText('2 aktif, 1 menunggu diambil')).toBeTruthy();
  });

  it('klik sesi memanggil onPilih dengan baris itu; sesi terpilih aria-pressed dan tanpa penanda belum dibaca', () => {
    const onPilih = vi.fn();
    const s = sesi();
    const { rerender } = render(<PanelDaftar {...dasar({ sesi: [s], onPilih })} />);
    expect(screen.getByLabelText('Pesan belum dibalas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/ }));
    expect(onPilih).toHaveBeenCalledExactlyOnceWith(s);
    rerender(<PanelDaftar {...dasar({ sesi: [s], terpilihId: 's1', onPilih })} />);
    expect(screen.getByRole('button', { name: /Helpdesk OSS/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByLabelText('Pesan belum dibalas')).toBeNull();
  });

  it('sesi aktif menampilkan pemegang; selain itu nama kontak atau "Pengunjung"', () => {
    render(<PanelDaftar {...dasar({
      sesi: [sesi({ id: 'a', status: 'aktif' }), sesi({ id: 'b', status: 'bot', layanan_id: 'l2' })],
      pemegang: () => 'Sari', kontak: {},
    })} />);
    expect(screen.getByText('Ditangani: Sari')).toBeTruthy();
    expect(screen.getByText('Pengunjung')).toBeTruthy();
  });

  it('memuat = skeleton; galat = pesan dengan Coba lagi; kosong = status kosong', () => {
    const onMuatUlang = vi.fn();
    const { rerender } = render(<PanelDaftar {...dasar({ memuat: true, dimuat: false })} />);
    expect(screen.getByText('Memuat sesi chat…')).toBeTruthy();
    expect(screen.queryByText('Belum ada sesi chat')).toBeNull();
    rerender(<PanelDaftar {...dasar({ galat: 'Gagal memuat sesi chat', onMuatUlang })} />);
    expect(screen.getByRole('alert').textContent).toContain('Gagal memuat sesi chat');
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    expect(onMuatUlang).toHaveBeenCalled();
    expect(screen.queryByText(/aktif/)).toBeNull();
    rerender(<PanelDaftar {...dasar({ sesi: [] })} />);
    expect(screen.getByText('Belum ada sesi chat')).toBeTruthy();
  });

  it('realtime tak tersambung memberi catatan; kotak "Tampilkan sesi selesai" memanggil onTampilSelesai', () => {
    const onTampilSelesai = vi.fn();
    render(<PanelDaftar {...dasar({ rt: 'down', onTampilSelesai })} />);
    expect(screen.getByText('Pembaruan berkala saat realtime belum tersambung.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tampilkan sesi selesai' }));
    expect(onTampilSelesai).toHaveBeenCalledWith(true);
  });
});
