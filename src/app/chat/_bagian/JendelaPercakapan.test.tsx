// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatMsg } from '../merge';
import JendelaPercakapan, { type JendelaPercakapanProps } from './JendelaPercakapan';

vi.mock('@/components/chat/GambarLampiran', () => ({ default: ({ pesanId }: { pesanId: string }) => <span data-testid="lampiran">{pesanId}</span> }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const pesan = (o: Partial<ChatMsg> & Pick<ChatMsg, 'id'>): ChatMsg => ({
  pengirim: 'pengunjung', isi: `isi ${o.id}`, created_at: '2026-11-01T02:00:00Z', ...o,
});

const props = (o: Partial<JendelaPercakapanProps> = {}): JendelaPercakapanProps => ({
  status: {
    mode: 'bot', tutup: false, botAktif: true, hanyaBaca: false, daring: true, sesiLayananNama: 'Bank Lampung',
    statusLayanan: null, onKembali: vi.fn(), onMintaPetugas: vi.fn(),
  },
  daftarPesan: [],
  mengetik: false,
  riwayat: { galat: null, memuat: false, adaLebih: false, onCobaLagi: vi.fn(), onMuatLebihLama: vi.fn() },
  faq: { aktif: true, galat: false, memuat: false, daftar: [], onCobaLagi: vi.fn(), onPilih: vi.fn() },
  masukan: { placeholder: 'Ketik pertanyaan Anda...', nonaktif: false, onKirim: vi.fn(), onKirimFoto: vi.fn() },
  onKirimUlang: vi.fn(),
  ...o,
});

describe('JendelaPercakapan', () => {
  it('mode bot: status FAQ aktif, Hubungkan ke Petugas memanggil callback, Daftar percakapan kembali', () => {
    const p = props();
    render(<JendelaPercakapan {...p} />);
    expect(screen.getByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hubungkan ke Petugas' }));
    expect(p.status.onMintaPetugas).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Daftar percakapan' }));
    expect(p.status.onKembali).toHaveBeenCalled();
  });

  it('mode lain: terhubung petugas, hanya baca, offline', () => {
    const { rerender } = render(<JendelaPercakapan {...props({ status: { ...props().status, mode: 'petugas' } })} />);
    expect(screen.getByText('Terhubung langsung dengan Petugas Bank Lampung')).toBeInTheDocument();
    rerender(<JendelaPercakapan {...props({ status: { ...props().status, mode: 'hanyaBaca', hanyaBaca: true } })} />);
    expect(screen.getByText(/tidak lagi melayani chat/)).toBeInTheDocument();
    rerender(<JendelaPercakapan {...props({ status: { ...props().status, daring: false } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('pesan: teks, status Terkirim hanya pada idTerkirim, lampiran, penutup sesi', () => {
    render(
      <JendelaPercakapan
        {...props({
          daftarPesan: [
            pesan({ id: 'm1' }),
            pesan({ id: 'm2', lampiran_kunci: 'k', lampiran_nama: 'foto.png' }),
            pesan({ id: 'm3', pengirim: 'bot', jenis_jawaban: 'penutup_survei', isi: 'Sesi ditutup.' }),
          ],
          idTerkirim: 'm2',
        })}
      />,
    );
    expect(screen.getByText('isi m1')).toBeInTheDocument();
    expect(screen.getAllByText('Terkirim')).toHaveLength(1);
    expect(screen.getByTestId('lampiran')).toHaveTextContent('m2');
    expect(screen.getByTestId('penutup-sesi')).toHaveTextContent('Sesi selesai');
  });

  it('pesan gagal: Kirim ulang memanggil callback dengan pesannya; pending menampilkan Mengirim', () => {
    const gagal = pesan({ id: 'g1', local: 'failed' });
    const p = props({ daftarPesan: [gagal, pesan({ id: 'p1', local: 'pending' })] });
    render(<JendelaPercakapan {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('Mengirim');
    fireEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));
    expect(p.onKirimUlang).toHaveBeenCalledWith(gagal);
  });

  it('riwayat: galat awal + Coba lagi, dan Muat pesan sebelumnya', () => {
    const p = props({ riwayat: { galat: 'awal', memuat: false, adaLebih: true, onCobaLagi: vi.fn(), onMuatLebihLama: vi.fn() } });
    render(<JendelaPercakapan {...p} />);
    expect(screen.getByText(/Riwayat percakapan belum dapat dimuat/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    expect(p.riwayat.onCobaLagi).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Muat pesan sebelumnya' }));
    expect(p.riwayat.onMuatLebihLama).toHaveBeenCalled();
  });

  it('FAQ Cepat: chip mengirim pertanyaan; galat tampil dengan Coba lagi; nonaktif tidak tampil', () => {
    const faq = { id: 'f1', pertanyaan: 'Apa syarat KUR?', jawaban: 'x', layanan_id: null, urutan: 1 };
    const p = props({ faq: { aktif: true, galat: false, memuat: false, daftar: [faq], onCobaLagi: vi.fn(), onPilih: vi.fn() } });
    const { rerender } = render(<JendelaPercakapan {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apa syarat KUR?' }));
    expect(p.faq.onPilih).toHaveBeenCalledWith('Apa syarat KUR?');
    rerender(<JendelaPercakapan {...props({ faq: { ...p.faq, galat: true } })} />);
    expect(screen.getByText('FAQ belum dapat dimuat')).toBeInTheDocument();
    expect(screen.queryByText('FAQ Cepat:')).toBeNull();
    rerender(<JendelaPercakapan {...props({ faq: { ...p.faq, aktif: false } })} />);
    expect(screen.queryByText('FAQ belum dapat dimuat')).toBeNull();
    expect(screen.queryByText('Apa syarat KUR?')).toBeNull();
  });

  it('indikator mengetik muncul hanya saat bot menyusun jawaban', () => {
    const { rerender } = render(<JendelaPercakapan {...props()} />);
    expect(screen.queryByText(/Bot FAQ sedang mengetik/)).toBeNull();
    rerender(<JendelaPercakapan {...props({ mengetik: true })} />);
    expect(screen.getByText(/Bot FAQ sedang mengetik/)).toBeInTheDocument();
  });

  it('kotak ketik: input foto tersembunyi hanya gambar, lampir ada, nonaktif memblokir', () => {
    const p = props();
    const { container, rerender } = render(<JendelaPercakapan {...p} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    const berkas = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [berkas] } });
    expect(p.masukan.onKirimFoto).toHaveBeenCalledWith(berkas);
    expect(container.querySelector('.cs-button--attachment')).not.toBeNull();
    rerender(<JendelaPercakapan {...props({ masukan: { ...p.masukan, nonaktif: true } })} />);
    expect(container.querySelector('.cs-message-input--disabled')).not.toBeNull();
  });
});
