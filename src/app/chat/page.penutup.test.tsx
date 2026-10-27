// @vitest-environment jsdom
// Pengunjung /chat (Tahap C): pesan penutup 'penutup_survei' dari RPC chat_selesai tampil sebagai catatan khusus
// (tempat tautan survei, tanpa URL; survei terpadu = Tahap E), sedangkan pesan bot/petugas biasa tetap bubble.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';

const LAYANAN_ID = '11111111-1111-4111-8111-111111111111';

function siapkanSupabase() {
  const dari = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order', 'or']) b[k] = () => b;
    b.single = () => {
      if (table === 'pengunjung') return Promise.resolve({ data: { id: 'peng-1', nama: 'Budi' }, error: null });
      if (table === 'chat_sesi') {
        return Promise.resolve({ data: { status: 'bot', kontak_pengunjung: 'Budi', layanan_id: LAYANAN_ID }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.insert = () => {
      const sesudah: Record<string, unknown> = {};
      sesudah.select = () => sesudah;
      sesudah.single = () =>
        Promise.resolve({ data: table === 'chat_sesi' ? { id: 'sesi-1', status: 'bot' } : null, error: null });
      return Object.assign(Promise.resolve({ data: null, error: null }), sesudah);
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const hasil =
        table === 'v_layanan_publik'
          ? { data: [{ id: LAYANAN_ID, nama: 'Bank Lampung', chatbot_aktif: true }], error: null }
          : { data: [], error: null };
      return Promise.resolve(hasil).then(resolve, reject);
    };
    return b;
  };
  const saluran: Record<string, unknown> = {};
  saluran.on = () => saluran;
  saluran.subscribe = () => saluran;
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-user-1' } }, error: null }), signInWithOAuth: vi.fn() },
    from: dari,
    channel: () => saluran,
    removeChannel: vi.fn(),
  });
}

async function mulaiSesiChat() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Layanan yang Ditanyakan'), { target: { value: LAYANAN_ID } });
  fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
  const tombol = screen.getByRole('button', { name: /mulai sesi chat/i });
  await waitFor(() => expect(tombol).toBeEnabled());
  fireEvent.click(tombol);
}

const PENUTUP =
  'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung. Tautan survei kepuasan layanan akan disediakan di sini.';

describe('chat pengunjung: pesan penutup sesi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('jenis_jawaban=penutup_survei tampil sebagai catatan khusus tanpa URL; pesan lain tetap bubble', async () => {
    siapkanSupabase();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'selesai',
        messages: [
          { id: 'm1', pengirim: 'petugas', isi: 'Silakan ajukan NIB lewat OSS.', created_at: '2026-10-14T03:00:00Z', client_uuid: null, jenis_jawaban: null },
          { id: 'm2', pengirim: 'bot', isi: PENUTUP, created_at: '2026-10-14T03:01:00Z', client_uuid: null, jenis_jawaban: 'penutup_survei' },
        ],
      }),
    })));
    render(<PublicChatPage />);
    await mulaiSesiChat();

    const penutup = await screen.findByTestId('penutup-sesi');
    expect(penutup).toHaveAttribute('role', 'note');
    // Q24: kalimat tautan survei dihapus (pesan lama disaring di tampilan); tanpa judul survei.
    expect(penutup).toHaveTextContent('Sesi selesai');
    expect(penutup).toHaveTextContent('Terima kasih telah menghubungi DPMPTSP Provinsi Lampung.');
    expect(penutup.textContent).not.toMatch(/survei|tautan/i);
    expect(penutup.querySelector('a')).toBeNull();
    expect(penutup.textContent).not.toMatch(/https?:\/\//);
    // Pesan petugas biasa tetap di bubble chatscope (bukan blok penutup).
    expect(screen.getByText('Silakan ajukan NIB lewat OSS.')).toBeInTheDocument();
    expect(screen.getAllByTestId('penutup-sesi')).toHaveLength(1);
    expect(await screen.findByText(/Sesi sebelumnya sudah selesai/)).toBeInTheDocument();
  });

  it('pesan bot lama tanpa jenis_jawaban tidak diberi gaya penutup (alur bot tidak berubah)', async () => {
    siapkanSupabase();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'bot',
        messages: [{ id: 'm1', pengirim: 'bot', isi: 'Halo, ada yang bisa dibantu?', created_at: '2026-10-14T03:00:00Z', client_uuid: null }],
      }),
    })));
    render(<PublicChatPage />);
    await mulaiSesiChat();
    expect(await screen.findByText('Halo, ada yang bisa dibantu?')).toBeInTheDocument();
    expect(screen.queryByTestId('penutup-sesi')).toBeNull();
  });
});
