// @vitest-environment node
// /chat sebagai Server Component ber-cache (tugas 6.5): Layanan dan FAQ dimuat di server dan dioper ke pulau klien sebagai
// data biasa; gagal dimuat di server = null (klien memuat sendiri); halaman tanpa 'use client'/sesi dan tanpa klien peramban.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayananEtalase } from '@/lib/homepage/data';

const h = vi.hoisted(() => ({ layanan: vi.fn(), faq: vi.fn(), peramban: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/publik-server', () => ({ muatLayananPublik: h.layanan, muatFaqPublik: h.faq }));
// Klien PERAMBAN: tidak boleh tersentuh saat halaman server dijalankan.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    h.peramban();
    return {};
  },
}));

import PublicChatPage, * as modulHalaman from './page';
import ChatKlien from './ChatKlien';

const etalase = (o: Partial<LayananEtalase>): LayananEtalase => ({
  id: 'l1', nama: 'Bank Lampung', slug: 'bank', deskripsi: null, urutan: 1, instansi: null, instansiSingkatan: null,
  websiteTerkait: [], statusTampilan: 'aktif', punyaAntrean: true, punyaChat: true, tampilDiHomepage: true,
  chatbotAktif: true, tipe: 'konsultatif', ...o,
});
const faq = { id: 'f1', pertanyaan: 'Syarat KUR?', jawaban: 'Lihat ...', layanan_id: null, urutan: 1 };

beforeEach(() => {
  h.layanan.mockReset();
  h.faq.mockReset();
  h.peramban.mockReset();
});

describe('halaman /chat (server)', () => {
  it('merender ChatKlien dengan Layanan chat dan FAQ dari server', async () => {
    h.layanan.mockResolvedValue({
      galat: false,
      layanan: [etalase({ id: 'b', nama: 'B' }), etalase({ id: 'm', nama: 'Modul', tipe: 'modul_publik' }), etalase({ id: 'a', nama: 'A', punyaChat: false }), etalase({ id: 'c', nama: 'A2', chatbotAktif: false })],
    });
    h.faq.mockResolvedValue({ galat: false, faq: [faq] });
    const el = (await PublicChatPage()) as ReactElement<{ layananAwal: unknown; faqAwal: unknown }>;
    expect(el.type).toBe(ChatKlien);
    expect(el.props.layananAwal).toEqual([
      { id: 'c', nama: 'A2', chatbot_aktif: false, status_tampilan: 'aktif', punya_chat: true },
      { id: 'b', nama: 'B', chatbot_aktif: true, status_tampilan: 'aktif', punya_chat: true },
    ]);
    expect(el.props.faqAwal).toEqual([faq]);
    expect(JSON.parse(JSON.stringify(el.props))).toEqual(el.props); // props JSON-aman (dioper ke komponen klien)
    expect(h.peramban).not.toHaveBeenCalled();
  });

  it('galat memuat di server -> null (klien memuat sendiri); daftar kosong yang sah tetap dioper', async () => {
    h.layanan.mockResolvedValue({ galat: true, layanan: [] });
    h.faq.mockResolvedValue({ galat: false, faq: [] });
    const el = (await PublicChatPage()) as ReactElement<{ layananAwal: unknown; faqAwal: unknown }>;
    expect(el.props.layananAwal).toBeNull();
    expect(el.props.faqAwal).toEqual([]);

    h.layanan.mockResolvedValue({ galat: false, layanan: [] });
    h.faq.mockResolvedValue({ galat: true, faq: [] });
    const el2 = (await PublicChatPage()) as ReactElement<{ layananAwal: unknown; faqAwal: unknown }>;
    expect(el2.props.layananAwal).toEqual([]);
    expect(el2.props.faqAwal).toBeNull();
  });

  it('FAQ terpotong (melebihi batas global) -> null supaya klien memuat FAQ per Layanan sendiri', async () => {
    h.layanan.mockResolvedValue({ galat: false, layanan: [] });
    h.faq.mockResolvedValue({ galat: false, terpotong: true, faq: [faq] });
    const el = (await PublicChatPage()) as ReactElement<{ layananAwal: unknown; faqAwal: unknown }>;
    expect(el.props.faqAwal).toBeNull();
  });

  it('ISR 60 detik, tanpa use client, tanpa sesi/cookies', () => {
    expect(modulHalaman.revalidate).toBe(60);
    const sumber = readFileSync(join(process.cwd(), 'src/app/chat/page.tsx'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(sumber).not.toMatch(/['"]use client['"]/);
    expect(sumber).not.toMatch(/cookies|headers|supabase\/(client|server|service)/);
  });
});
