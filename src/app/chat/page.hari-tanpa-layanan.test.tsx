// @vitest-environment jsdom
// Live chat pada HARI TANPA PELAYANAN (keputusan CEO 2026-10-14): Sabtu, Minggu, atau tanggal di tabel hari_libur.
// Pengunjung diberi pemberitahuan jelas bahwa live chat dengan petugas tidak tersedia (bot saja), tombol "Hubungkan ke
// Petugas" disembunyikan, layanan tanpa bot tidak dapat dipilih, dan sesi 'eskalasi' tetap dijawab bot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';

const LAYANAN_BOT = '11111111-1111-4111-8111-111111111111';
const LAYANAN_PETUGAS = '22222222-2222-4222-8222-222222222222';

interface Opsi {
  libur?: Array<{ tanggal: string; keterangan: string }>;
  kanal?: Array<{ key: string; value: string }>;
  sesiStatus?: 'bot' | 'eskalasi';
}

function siapkanSupabase(opsi: Opsi = {}) {
  const kueri: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const dari = (table: string) => {
    const ops: Array<[string, unknown[]]> = [];
    kueri.push({ table, ops });
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'neq', 'order', 'or', 'gte', 'lte', 'in']) {
      b[k] = (...a: unknown[]) => {
        ops.push([k, a]);
        return b;
      };
    }
    b.single = () => {
      if (table === 'pengunjung') return Promise.resolve({ data: { id: 'peng-1', nama: 'Budi' }, error: null });
      if (table === 'chat_sesi') {
        return Promise.resolve({
          data: { status: opsi.sesiStatus ?? 'bot', kontak_pengunjung: 'Budi', layanan_id: LAYANAN_BOT },
          error: null,
        });
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
          ? {
              data: [
                { id: LAYANAN_BOT, nama: 'Bank Lampung', chatbot_aktif: true },
                { id: LAYANAN_PETUGAS, nama: 'Konsultasi Langsung', chatbot_aktif: false },
              ],
              error: null,
            }
          : table === 'hari_libur'
            ? { data: opsi.libur ?? [], error: null }
            : table === 'site_settings'
              ? { data: opsi.kanal ?? [], error: null }
              : table === 'faq_knowledge_base'
                ? { data: [{ id: 'faq-1', pertanyaan: 'Apa syarat NIB?', jawaban: 'KTP', layanan_id: LAYANAN_BOT, urutan: 1 }], error: null }
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
  return kueri;
}

const fetchMock = () =>
  vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/api/chat/ai')
        ? { jawaban: 'Jawaban bot', eskalasi: false, pesan: null, status: null }
        : String(url).includes('/api/chat/messages') ? { messages: [], status: 'bot' } : {},
  }));

async function mulaiSesiChat() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Layanan yang Ditanyakan'), { target: { value: LAYANAN_BOT } });
  fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
  const tombol = screen.getByRole('button', { name: /mulai sesi chat/i });
  await waitFor(() => expect(tombol).toBeEnabled());
  fireEvent.click(tombol);
}

describe('chat pengunjung: hari tanpa pelayanan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('Sabtu: pemberitahuan jelas (bot saja, hari kerja berikutnya, kanal dari pengaturan) dan layanan tanpa bot nonaktif', async () => {
    vi.setSystemTime(new Date('2026-10-17T10:00:00+07:00')); // Sabtu
    siapkanSupabase({ kanal: [{ key: 'wa_number', value: '081200000000' }, { key: 'contact_email', value: 'layanan@contoh.go.id' }] });
    vi.stubGlobal('fetch', fetchMock());
    render(<PublicChatPage />);

    const catatan = await screen.findByTestId('chat-hari-tanpa-layanan');
    expect(catatan).toHaveAttribute('role', 'note');
    expect(catatan).toHaveTextContent('Live chat dengan petugas tidak tersedia hari ini.');
    expect(catatan).toHaveTextContent(/karena hari ini Sabtu/);
    expect(catatan).toHaveTextContent(/hanya dapat bertanya kepada asisten virtual \(bot\)/);
    expect(catatan).toHaveTextContent(/Senin, 19 Oktober 2026/);
    expect(catatan).toHaveTextContent(/WhatsApp 081200000000 \/ email layanan@contoh\.go\.id/);

    const opsiPetugas = await screen.findByRole('option', { name: /Konsultasi Langsung \(hanya petugas, tidak tersedia hari ini\)/ });
    expect(opsiPetugas).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Bank Lampung' })).not.toBeDisabled();
  });

  it('Sabtu: dalam sesi bot tombol "Hubungkan ke Petugas" tidak ada dan status menyebut petugas tidak bertugas', async () => {
    vi.setSystemTime(new Date('2026-10-17T10:00:00+07:00'));
    siapkanSupabase();
    vi.stubGlobal('fetch', fetchMock());
    render(<PublicChatPage />);
    await screen.findByTestId('chat-hari-tanpa-layanan');
    await mulaiSesiChat();

    expect(await screen.findByText('Mode Chatbot FAQ — petugas tidak bertugas hari ini')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hubungkan ke Petugas' })).toBeNull();
    // pemberitahuan tetap tampil selama sesi
    expect(screen.getByTestId('chat-hari-tanpa-layanan')).toHaveTextContent(/pertanyaan tidak diteruskan ke petugas/);
  });

  it('hari libur (tabel hari_libur) pada hari kerja: keterangan libur disebut; sesi eskalasi tetap dijawab bot', async () => {
    vi.setSystemTime(new Date('2026-10-14T10:00:00+07:00')); // Rabu, ditandai libur
    const kueri = siapkanSupabase({ libur: [{ tanggal: '2026-10-14', keterangan: 'Cuti bersama' }], sesiStatus: 'eskalasi' });
    localStorage.setItem('lmh_chat_sesi_id', 'sesi-1');
    localStorage.setItem('lmh_chat_layanan_id', LAYANAN_BOT);
    const f = fetchMock();
    vi.stubGlobal('fetch', f);
    render(<PublicChatPage />);

    await waitFor(() =>
      expect(screen.getByTestId('chat-hari-tanpa-layanan')).toHaveTextContent(/hari ini hari libur \(Cuti bersama\)/));
    expect(await screen.findByText(/Petugas tidak bertugas hari ini/)).toBeInTheDocument();
    expect(screen.queryByText(/Menghubungkan ke petugas operasional/)).toBeNull();
    // hari libur dibaca dari tanggal WIB hari ini
    const libur = kueri.find((k) => k.table === 'hari_libur')!;
    expect(libur.ops).toContainEqual(['gte', ['tanggal', '2026-10-14']]);

    // Pesan pada sesi 'eskalasi' di hari libur -> diteruskan ke bot (/api/chat/ai), bukan menunggu petugas.
    // FAQ cepat hanya tampil dalam mode bot: tampilnya di sesi eskalasi membuktikan mode bot aktif.
    fireEvent.click(await screen.findByRole('button', { name: 'Apa syarat NIB?' }));
    await waitFor(() =>
      expect(f.mock.calls.some((c) => String(c[0]).includes('/api/chat/ai'))).toBe(true));
  });

  it('hari kerja tanpa libur: tidak ada pemberitahuan, tombol "Hubungkan ke Petugas" tetap ada', async () => {
    vi.setSystemTime(new Date('2026-10-14T10:00:00+07:00')); // Rabu
    siapkanSupabase();
    vi.stubGlobal('fetch', fetchMock());
    render(<PublicChatPage />);
    expect(await screen.findByRole('option', { name: 'Konsultasi Langsung' })).not.toBeDisabled();
    await mulaiSesiChat();
    expect(await screen.findByRole('button', { name: 'Hubungkan ke Petugas' })).toBeInTheDocument();
    expect(screen.queryByTestId('chat-hari-tanpa-layanan')).toBeNull();
  });
});
