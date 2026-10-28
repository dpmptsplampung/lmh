// @vitest-environment jsdom
// Fase 5: daftar percakapan (satu per Layanan), riwayat lintas sesi, sesi baru malas, cadangan tanpa RPC.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';
import type { OpsiHarness } from './chat.test-utils';
import { L_BANK, L_BPJS, STATUS_BUKA, barisRpc, siapkanHarness } from './chat.test-utils';

const harness = (opsi: OpsiHarness = {}) => siapkanHarness(createClient, opsi);

/** Mengetik di MessageInput chatscope (contenteditable) lalu menekan Enter. */
async function ketik(teks: string) {
  const editor = await waitFor(() => {
    const el = document.querySelector('.cs-message-input__content-editor') as HTMLElement | null;
    if (!el) throw new Error('editor belum ada');
    return el;
  });
  editor.innerHTML = teks;
  fireEvent.input(editor, { target: { innerHTML: teks, textContent: teks, innerText: teks } });
  const kirim = document.querySelector('.cs-button--send') as HTMLElement;
  fireEvent.click(kirim);
}

describe('chat pengunjung: daftar percakapan dan riwayat (Fase 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('dua percakapan tampil dengan pratinjau; penanda "Belum dibaca" hanya yang lebih baru dari penanda perangkat', async () => {
    localStorage.setItem(`lmh_chat_dibaca_${L_BPJS}`, '2026-10-30T05:00:00Z'); // BPJS sudah dibaca
    harness({
      rpcDaftar: [
        barisRpc(),
        barisRpc({
          layanan_id: L_BPJS, layanan_nama: 'BPJS Kesehatan', sesi_terakhir_id: 'sesi-9', sesi_terbuka_id: null,
          status_terakhir: 'selesai', last_pesan: 'Terima kasih', last_pesan_at: '2026-10-30T03:00:00Z', last_pengirim: 'petugas',
        }),
      ],
    });
    render(<PublicChatPage />);

    const bank = await screen.findByRole('button', { name: /buka percakapan bank lampung, ada pesan baru/i });
    expect(bank).toHaveTextContent('Syarat KUR adalah ...');
    expect(bank).toHaveTextContent('Belum dibaca');
    const bpjs = screen.getByRole('button', { name: /^buka percakapan bpjs kesehatan$/i });
    expect(bpjs).toHaveTextContent('Sesi selesai');
    expect(bpjs).not.toHaveTextContent('Belum dibaca');
    expect(screen.queryByLabelText('Layanan yang Ditanyakan')).toBeNull(); // bukan formulir
  });

  it('membuka percakapan memuat riwayat lintas sesi dari sesi terakhir dan menampilkan semua pesan urut', async () => {
    const { panggilan } = harness({
      rpcDaftar: [barisRpc()],
      messages: () => ({
        status: 'bot',
        ada_lebih: false,
        sesi_terbuka_id: 'sesi-2',
        messages: [
          { id: 'm1', sesi_id: 'sesi-1', pengirim: 'pengunjung', isi: 'Pertanyaan bulan lalu', created_at: '2026-09-01T01:00:00Z' },
          { id: 'm2', sesi_id: 'sesi-2', pengirim: 'bot', isi: 'Jawaban terbaru', created_at: '2026-10-30T01:00:00Z' },
        ],
      }),
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));

    expect(await screen.findByText('Pertanyaan bulan lalu')).toBeInTheDocument();
    expect(screen.getByText('Jawaban terbaru')).toBeInTheDocument();
    const riwayat = panggilan.find((p) => p.url.includes('riwayat=1'));
    expect(riwayat?.url).toContain('sesi_id=sesi-2');
    expect(window.localStorage.getItem(`lmh_chat_dibaca_${L_BANK}`)).not.toBeNull(); // ditandai dibaca
    expect(screen.getByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
  });

  it('"Muat pesan sebelumnya" mengambil halaman lebih lama dengan parameter sebelum', async () => {
    const { panggilan } = harness({
      rpcDaftar: [barisRpc()],
      messages: (url) =>
        url.includes('sebelum=')
          ? { status: 'bot', ada_lebih: false, messages: [{ id: 'm0', sesi_id: 'sesi-0', pengirim: 'bot', isi: 'Pesan tertua', created_at: '2026-08-01T01:00:00Z' }] }
          : { status: 'bot', ada_lebih: true, messages: [{ id: 'm2', sesi_id: 'sesi-2', pengirim: 'bot', isi: 'Pesan baru', created_at: '2026-10-30T01:00:00Z' }] },
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    fireEvent.click(await screen.findByRole('button', { name: /muat pesan sebelumnya/i }));

    expect(await screen.findByText('Pesan tertua')).toBeInTheDocument();
    const lama = panggilan.find((p) => p.url.includes('sebelum='));
    expect(lama?.url).toContain(encodeURIComponent('2026-10-30T01:00:00Z'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /muat pesan sebelumnya/i })).toBeNull());
  });

  it('sesi terakhir selesai + kirim pesan: chat_sesi baru dibuat lalu pesan dikirim ke sesi baru', async () => {
    const { inserts, panggilan } = harness({
      rpcDaftar: [barisRpc({ sesi_terbuka_id: null, status_terakhir: 'selesai', sesi_terakhir_id: 'sesi-lama' })],
      messages: () => ({ status: 'selesai', ada_lebih: false, messages: [] }),
      sesiBaru: { id: 'sesi-baru', status: 'bot' },
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    expect(await screen.findByText(/Sesi sebelumnya sudah selesai/)).toBeInTheDocument();

    await ketik('Halo lagi');
    await waitFor(() => expect(inserts.some((i) => i.table === 'chat_sesi')).toBe(true));
    expect(inserts.find((i) => i.table === 'chat_sesi')?.payload).toMatchObject({
      layanan_id: L_BANK, pengunjung_id: 'peng-1', status: 'bot',
    });
    await waitFor(() => expect(panggilan.some((p) => p.method === 'POST' && p.url === '/api/chat/messages')).toBe(true));
    expect(panggilan.find((p) => p.method === 'POST' && p.url === '/api/chat/messages')?.body).toMatchObject({
      sesi_id: 'sesi-baru', isi: 'Halo lagi',
    });
  });

  it('gagal membuat sesi baru: pesan "Gagal terkirim" + Kirim ulang, tanpa POST pesan', async () => {
    const { panggilan } = harness({
      rpcDaftar: [barisRpc({ sesi_terbuka_id: null, status_terakhir: 'selesai', sesi_terakhir_id: 'sesi-lama' })],
      messages: () => ({ status: 'selesai', ada_lebih: false, messages: [] }),
      sesiBaru: { error: { message: 'boom', code: '500' } },
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    await screen.findByText(/Sesi sebelumnya sudah selesai/);
    await ketik('Halo lagi');

    expect(await screen.findByText(/Gagal terkirim/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kirim ulang/i })).toBeInTheDocument();
    expect(panggilan.some((p) => p.method === 'POST' && p.url === '/api/chat/messages')).toBe(false);
  });

  it('layanan yang tidak lagi melayani chat: percakapan hanya-baca dengan alasan', async () => {
    harness({
      layanan: [{ id: L_BPJS, nama: 'BPJS Kesehatan', chatbot_aktif: true }], // L_BANK tidak ada (diarsipkan)
      rpcDaftar: [barisRpc({ sesi_terbuka_id: null, status_terakhir: 'selesai', layanan_aktif: false })],
      messages: () => ({ status: 'selesai', ada_lebih: false, messages: [] }),
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    expect(await screen.findByText(/tidak lagi melayani chat/i)).toBeInTheDocument();
  });

  it('RPC daftar belum ada: daftar disusun dari chat_sesi (cadangan, tanpa crash)', async () => {
    harness({
      sesiRows: [
        { id: 'a', layanan_id: L_BANK, status: 'selesai', created_at: '2026-10-01T00:00:00Z' },
        { id: 'b', layanan_id: L_BANK, status: 'bot', created_at: '2026-10-02T00:00:00Z' },
      ],
    });
    render(<PublicChatPage />);
    const item = await screen.findByRole('button', { name: /buka percakapan bank lampung/i });
    expect(item).toHaveTextContent('Asisten virtual');
  });

  it('tanpa percakapan: langsung formulir; ?layanan= untuk Layanan yang sudah punya percakapan membukanya', async () => {
    harness({ rpcDaftar: [] });
    render(<PublicChatPage />);
    expect(await screen.findByLabelText('Layanan yang Ditanyakan')).toBeInTheDocument();
    cleanup();

    harness({ rpcDaftar: [barisRpc()], status: STATUS_BUKA, messages: () => ({ status: 'bot', ada_lebih: false, messages: [] }) });
    window.history.pushState({}, '', `/chat?layanan=${L_BANK}`);
    try {
      render(<PublicChatPage />);
      expect(await screen.findByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});
