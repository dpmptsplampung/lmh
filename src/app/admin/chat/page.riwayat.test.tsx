// @vitest-environment jsdom
// Fase 5: petugas melihat seluruh riwayat percakapan pengunjung (lintas sesi) di Layanannya, dengan pembatas sesi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const SESI = 's2';
const row = {
  id: SESI, status: 'aktif', layanan_id: 'l1', pengunjung_id: 'p1', ditangani_oleh: 'pet-1',
  created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-10-30T00:00:01Z', last_pengirim: 'pengunjung', unread: false,
};

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => {
  const q = (data: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'order']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data });
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(data) ? data : [data] }).then(r);
    return b;
  };
  const channel = { on: () => channel, subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channel; } };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: (t: string) =>
        t === 'petugas' ? q({ id: 'pet-1', role: 'petugas', layanan_id: 'l1', nama: 'Budi' })
        : t === 'layanan' ? q({ id: 'l1', nama: 'Helpdesk OSS', aktif: true, punya_chat: true })
        : t === 'penanganan' ? q([])
        : q({ kontak_pengunjung: 'Ani' }),
      rpc: () => Promise.resolve({ data: [row], error: null }),
      channel: () => channel,
      removeChannel: () => {},
    }),
  };
});

import AdminChatPage from './page';

const PENUTUP_LAMA =
  'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung. Tautan survei kepuasan layanan akan disediakan di sini.';

describe('admin chat: riwayat percakapan lintas sesi (Fase 5)', () => {
  let urls: string[];
  beforeEach(() => {
    urls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      const u = String(url);
      if (u.includes('sebelum=')) {
        return { ok: true, status: 200, json: async () => ({ status: 'aktif', ada_lebih: false, messages: [{ id: 'm0', sesi_id: 's0', pengirim: 'pengunjung', isi: 'Pesan tertua', created_at: '2026-08-01T01:00:00Z' }] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'aktif',
          ada_lebih: u.includes('riwayat=1'),
          messages: [
            { id: 'm1', sesi_id: 's1', pengirim: 'pengunjung', isi: 'Pertanyaan sesi lama', created_at: '2026-09-01T01:00:00Z' },
            { id: 'm2', sesi_id: 's1', pengirim: 'bot', isi: PENUTUP_LAMA, created_at: '2026-09-01T01:05:00Z', jenis_jawaban: 'penutup_survei' },
            { id: 'm3', sesi_id: 's2', pengirim: 'pengunjung', isi: 'Pertanyaan sesi ini', created_at: '2026-10-30T01:00:00Z' },
          ],
        }),
      };
    }));
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T10:00:00+07:00'));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('memilih sesi memuat riwayat penuh; dua pembatas sesi; poll berikutnya hanya sesi terpilih', async () => {
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));

    expect(await screen.findByText('Pertanyaan sesi lama')).toBeTruthy();
    expect(screen.getByText('Pertanyaan sesi ini')).toBeTruthy();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(urls.some((u) => u.includes('sesi_id=s2') && u.includes('riwayat=1'))).toBe(true);
    // Muat awal saja yang berriwayat; pemuatan ulang (mis. setelah aksi) memuat satu sesi.
    expect(urls.filter((u) => u.includes('riwayat=1')).length).toBe(1);
  });

  it('pesan penutup lama disaring dari kalimat survei', async () => {
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    await screen.findByText('Pertanyaan sesi lama');
    expect(screen.queryByText(/Tautan survei/)).toBeNull();
    expect(screen.getByText('Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung.')).toBeTruthy();
  });

  it('"Muat riwayat sebelumnya" memanggil route dengan sebelum = pesan tertua lalu menyembunyikan tombol', async () => {
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Muat riwayat sebelumnya/ }));

    expect(await screen.findByText('Pesan tertua')).toBeTruthy();
    expect(urls.some((u) => u.includes('sebelum=' + encodeURIComponent('2026-09-01T01:00:00Z')))).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Muat riwayat sebelumnya/ })).toBeNull());
  });
});
