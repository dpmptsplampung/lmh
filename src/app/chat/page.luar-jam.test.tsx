// @vitest-environment jsdom
// Fase 5: di luar jam operasional Layanan bot tetap menjawab; petugas hanya diminta lewat tombol (email di DB).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';
import type { OpsiHarness } from './chat.test-utils';
import { L_BANK, STATUS_BUKA, STATUS_TUTUP, barisRpc, siapkanHarness } from './chat.test-utils';

const harness = (opsi: OpsiHarness = {}) => siapkanHarness(createClient, opsi);
const MENUNGGU = 'Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.';

async function bukaBank() {
  render(<PublicChatPage />);
  fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
}

async function ketik(teks: string) {
  const editor = await waitFor(() => {
    const el = document.querySelector('.cs-message-input__content-editor') as HTMLElement | null;
    if (!el) throw new Error('editor belum ada');
    return el;
  });
  editor.innerHTML = teks;
  fireEvent.input(editor, { target: { innerHTML: teks, textContent: teks, innerText: teks } });
  fireEvent.click(document.querySelector('.cs-button--send') as HTMLElement);
}

describe('chat pengunjung: di luar jam operasional Layanan (Fase 5)', () => {
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

  it('status tutup: spanduk menyebut Layanan dan jadwal berikutnya; bot tetap tersedia; tombol petugas ada', async () => {
    harness({ rpcDaftar: [barisRpc()], status: STATUS_TUTUP });
    await bukaBank();

    const spanduk = await screen.findByTestId('chat-luar-jam');
    expect(spanduk).toHaveAttribute('role', 'note');
    expect(spanduk).toHaveTextContent('Petugas Bank Lampung sedang tidak tersedia');
    expect(spanduk).toHaveTextContent('Senin, 2 November 2026 pukul 08.00 WIB');
    expect(spanduk).toHaveTextContent('asisten virtual');
    expect(screen.getByText(/Mode Chatbot FAQ — petugas sedang tidak tersedia/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hubungkan ke Petugas' })).toBeInTheDocument();
  });

  it('status buka: tanpa spanduk luar jam', async () => {
    const { panggilan } = harness({ rpcDaftar: [barisRpc()], status: STATUS_BUKA });
    await bukaBank();
    await waitFor(() => expect(panggilan.some((p) => p.url.startsWith('/api/chat/status'))).toBe(true));
    await screen.findByText('Mode Chatbot FAQ Aktif');
    expect(screen.queryByTestId('chat-luar-jam')).toBeNull();
  });

  it('"Hubungkan ke Petugas" di luar jam: POST petugas, teks tunggu persis spec, tombol hilang, status menunggu', async () => {
    const { panggilan } = harness({
      rpcDaftar: [barisRpc()],
      status: STATUS_TUTUP,
      petugas: {
        status: 200,
        body: {
          ok: true, noop: false, buka: false, status: 'eskalasi', penerima: 2,
          pesan: { id: 'sys-1', pengirim: 'bot', isi: MENUNGGU, created_at: '2026-10-31T01:00:00Z', jenis_jawaban: 'minta_petugas_luar_jam' },
        },
      },
    });
    await bukaBank();
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungkan ke Petugas' }));

    expect(await screen.findByText(MENUNGGU)).toBeInTheDocument();
    const minta = panggilan.find((p) => p.url === '/api/chat/petugas');
    expect(minta?.method).toBe('POST');
    expect(minta?.body).toEqual({ sesi_id: 'sesi-2' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hubungkan ke Petugas' })).toBeNull());
    expect(screen.getByText(/Menunggu petugas — petugas akan menjawab pada jam kerja/)).toBeInTheDocument();
  });

  it('migrasi belum diterapkan (409): jalur lama, pertanyaan "ingin berbicara dengan petugas" dikirim ke AI', async () => {
    const { panggilan } = harness({
      rpcDaftar: [barisRpc()],
      status: STATUS_BUKA,
      petugas: { status: 409, body: { kode: 'MIGRASI_BELUM_DITERAPKAN', error: 'belum' } },
    });
    await bukaBank();
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungkan ke Petugas' }));
    await waitFor(() => expect(panggilan.some((p) => p.url === '/api/chat/ai')).toBe(true));
    expect(panggilan.find((p) => p.url === '/api/chat/ai')?.body).toMatchObject({
      pertanyaan: 'Saya ingin berbicara dengan petugas loket.', sesi_id: 'sesi-2',
    });
  });

  it('Layanan tanpa bot di luar jam: pengunjung boleh meninggalkan pesan (composer aktif), tanpa memanggil AI', async () => {
    const { panggilan } = harness({
      layanan: [{ id: L_BANK, nama: 'Bank Lampung', chatbot_aktif: false }],
      rpcDaftar: [barisRpc({ chatbot_aktif: false, status_terakhir: 'eskalasi' })],
      status: STATUS_TUTUP,
      messages: () => ({ status: 'eskalasi', ada_lebih: false, messages: [] }),
    });
    await bukaBank();

    const spanduk = await screen.findByTestId('chat-luar-jam');
    expect(spanduk).toHaveTextContent('tinggalkan pesan Anda');
    expect(spanduk).not.toHaveTextContent('asisten virtual');
    const editor = document.querySelector('.cs-message-input__content-editor') as HTMLElement;
    expect(editor.getAttribute('contenteditable')).toBe('true');

    await ketik('Mohon bantuan KUR');
    await waitFor(() => expect(panggilan.some((p) => p.method === 'POST' && p.url === '/api/chat/messages')).toBe(true));
    expect(panggilan.some((p) => p.url === '/api/chat/ai')).toBe(false);
  });
});
