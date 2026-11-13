// @vitest-environment jsdom
// Tugas 6.5: dengan data awal dari server, muat awal /chat tidak membuat query Layanan/FAQ dari browser; tanpa data awal
// (null) dimuat dari browser seperti sebelumnya.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import ChatKlien from './ChatKlien';
import { createClient } from '@/lib/supabase/client';
import { L_BANK, L_BPJS, barisRpc, siapkanHarness } from './chat.test-utils';

const layananAwal = [
  { id: L_BANK, nama: 'Bank Lampung', chatbot_aktif: true, status_tampilan: 'aktif', punya_chat: true },
  { id: L_BPJS, nama: 'BPJS Kesehatan', chatbot_aktif: true, status_tampilan: 'aktif', punya_chat: true },
];
const faqAwal = [
  { id: 'f1', pertanyaan: 'Apa syarat KUR?', jawaban: 'x', layanan_id: L_BANK, urutan: 1 },
  { id: 'f2', pertanyaan: 'Pertanyaan BPJS', jawaban: 'x', layanan_id: L_BPJS, urutan: 1 },
];

/** Daftar tabel yang diquery klien peramban selama pengujian. */
function pantauTabel() {
  const klien = (createClient as unknown as () => { from: (t: string) => unknown })();
  const dari = klien.from;
  const tabel: string[] = [];
  klien.from = (t: string) => {
    tabel.push(t);
    return dari(t);
  };
  return tabel;
}

describe('ChatKlien dengan data awal dari server', () => {
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

  it('formulir percakapan baru memakai Layanan awal tanpa query v_layanan_publik dari browser', async () => {
    siapkanHarness(createClient, { rpcDaftar: [] });
    const tabel = pantauTabel();
    render(<ChatKlien layananAwal={layananAwal} faqAwal={faqAwal} />);
    expect(await screen.findByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'BPJS Kesehatan' })).toBeInTheDocument();
    expect(tabel).not.toContain('v_layanan_publik');
    expect(tabel).not.toContain('faq_knowledge_base');
  });

  it('membuka percakapan menampilkan FAQ Cepat dari data awal (layanan itu + umum) tanpa query faq_knowledge_base', async () => {
    siapkanHarness(createClient, { rpcDaftar: [barisRpc()] });
    const tabel = pantauTabel();
    render(<ChatKlien layananAwal={layananAwal} faqAwal={faqAwal} />);
    (await screen.findByRole('button', { name: /buka percakapan/i })).click();
    expect(await screen.findByText('Apa syarat KUR?')).toBeInTheDocument();
    expect(screen.queryByText('Pertanyaan BPJS')).toBeNull();
    expect(tabel).not.toContain('v_layanan_publik');
    expect(tabel).not.toContain('faq_knowledge_base');
  });

  it('data awal null: Layanan dimuat dari browser', async () => {
    siapkanHarness(createClient, { rpcDaftar: [] });
    const tabel = pantauTabel();
    render(<ChatKlien layananAwal={null} faqAwal={null} />);
    expect(await screen.findByRole('option', { name: 'Bank Lampung' })).toBeInTheDocument();
    await waitFor(() => expect(tabel).toContain('v_layanan_publik'));
  });
});
