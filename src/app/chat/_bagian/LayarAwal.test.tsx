// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import LayarAwal, { type LayarAwalProps } from './LayarAwal';
import type { FormulirBaruProps } from './FormulirBaru';

afterEach(cleanup);

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';

const formulir = (o: Partial<FormulirBaruProps> = {}): FormulirBaruProps => ({
  memeriksa: false, masuk: true, nama: 'Budi', onNama: vi.fn(), layananUrlMentah: null, onMasukGoogle: vi.fn(),
  layanan: [
    { id: L1, nama: 'Bank Lampung', chatbot_aktif: true, status_tampilan: 'aktif' },
    { id: L2, nama: 'Segera', chatbot_aktif: false, status_tampilan: 'coming_soon' },
  ],
  layananId: '', onPilihLayanan: vi.fn(), memuatLayanan: false, galatLayanan: false, onCobaLagiLayanan: vi.fn(),
  layananBerpercakapan: [], adaPercakapanTerpilih: false, consentGiven: false, onConsent: vi.fn(), galatConsent: null,
  onCobaLagiConsent: vi.fn(), memulai: false, daring: true, onMulai: vi.fn(), ...o,
});

const props = (o: { tampilan?: LayarAwalProps['tampilan']; items?: PercakapanRingkas[]; formulir?: Partial<FormulirBaruProps>; galatSetup?: string | null } = {}): LayarAwalProps => ({
  tampilan: o.tampilan ?? 'baru',
  daftar: { items: o.items ?? [], dibaca: {}, memuat: false, galat: false, onCobaLagi: vi.fn(), onBuka: vi.fn(), onBaru: vi.fn() },
  baru: { galatSetup: o.galatSetup ?? null, onKembaliKeDaftar: vi.fn(), formulir: formulir(o.formulir) },
});

describe('LayarAwal', () => {
  it('memuat: skeleton berperan status', () => {
    render(<LayarAwal {...props({ tampilan: 'memuat' })} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('daftar: meneruskan ke DaftarPercakapan (tombol percakapan baru memanggil onBaru)', () => {
    const p = props({ tampilan: 'daftar' });
    render(<LayarAwal {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /percakapan baru|mulai/i }));
    expect(p.daftar.onBaru).toHaveBeenCalled();
  });

  it('baru: formulir, layanan "segera hadir" nonaktif, tombol mulai terkunci tanpa persetujuan', () => {
    render(<LayarAwal {...props()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Mulai Konsultasi Online' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Segera (Segera hadir)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mulai Sesi Chat' })).toBeDisabled();
  });

  it('baru: persetujuan dicentang -> onConsent; submit memanggil onMulai', () => {
    const p = props({ formulir: { consentGiven: true } });
    render(<LayarAwal {...p} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(p.baru.formulir.onConsent).toHaveBeenCalledWith(false);
    const tombol = screen.getByRole('button', { name: 'Mulai Sesi Chat' });
    expect(tombol).not.toBeDisabled();
    fireEvent.submit(tombol.closest('form')!);
    expect(p.baru.formulir.onMulai).toHaveBeenCalled();
  });

  it('baru: percakapan sudah ada -> tanpa kotak persetujuan, tombol Buka percakapan', () => {
    render(<LayarAwal {...props({ formulir: { adaPercakapanTerpilih: true, layananId: L1, layananBerpercakapan: [L1] } })} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Buka percakapan' })).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'Bank Lampung (percakapan sudah ada)' })).toBeInTheDocument();
  });

  it('baru: belum masuk -> ajakan masuk Google (tanpa formulir), mengingat layanan dari URL', () => {
    const p = props({ formulir: { masuk: false, layananUrlMentah: 'bank' } });
    render(<LayarAwal {...p} />);
    expect(screen.getByText(/dengan layanan yang sama/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nama Anda/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Masuk dengan Google/ }));
    expect(p.baru.formulir.onMasukGoogle).toHaveBeenCalled();
  });

  it('baru: offline dan galat setup tampil sebagai alert; tombol kembali hanya bila ada daftar', () => {
    const { rerender } = render(<LayarAwal {...props({ galatSetup: 'Gagal memulai', formulir: { daring: false } })} />);
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/offline|Gagal memulai/i);
    expect(screen.getByText('Gagal memulai')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Daftar percakapan' })).toBeNull();
    const p = props({ items: [{ layananId: L1 } as PercakapanRingkas] });
    rerender(<LayarAwal {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Daftar percakapan' }));
    expect(p.baru.onKembaliKeDaftar).toHaveBeenCalled();
  });

  it('baru: galat memuat layanan -> pilihan dikunci dan Coba lagi memanggil onCobaLagiLayanan', () => {
    const p = props({ formulir: { galatLayanan: true } });
    render(<LayarAwal {...p} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    expect(p.baru.formulir.onCobaLagiLayanan).toHaveBeenCalled();
  });
});
