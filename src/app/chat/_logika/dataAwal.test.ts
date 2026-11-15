import { describe, expect, it } from 'vitest';
import type { FaqChat } from '@/lib/data/chat-pengunjung';
import type { LayananEtalase } from '@/lib/homepage/data';
import { faqUntukLayanan, layananChatDariEtalase } from './dataAwal';

const etalase = (o: Partial<LayananEtalase>): LayananEtalase => ({
  id: 'l1', nama: 'Bank', slug: 'bank', deskripsi: null, urutan: 1, instansi: null, instansiSingkatan: null,
  websiteTerkait: [], statusTampilan: 'aktif', punyaAntrean: true, punyaChat: true, tampilDiHomepage: true,
  chatbotAktif: true, tipe: 'konsultatif', ...o,
});
const f = (id: string, layanan_id: string | null, urutan: number): FaqChat => ({ id, pertanyaan: id, jawaban: id, layanan_id, urutan });

describe('layananChatDariEtalase', () => {
  it('membuang modul_publik dan punya_chat=false, memetakan kolom, urut nama (bukan urutan etalase)', () => {
    const hasil = layananChatDariEtalase([
      etalase({ id: 'z', nama: 'Zakat', urutan: 1 }),
      etalase({ id: 'm', nama: 'Modul', tipe: 'modul_publik' }),
      etalase({ id: 'x', nama: 'Tanpa chat', punyaChat: false }),
      etalase({ id: 'a', nama: 'Alfa', urutan: 9, statusTampilan: 'coming_soon', chatbotAktif: false }),
    ]);
    expect(hasil).toEqual([
      { id: 'a', nama: 'Alfa', chatbot_aktif: false, status_tampilan: 'coming_soon', punya_chat: true },
      { id: 'z', nama: 'Zakat', chatbot_aktif: true, status_tampilan: 'aktif', punya_chat: true },
    ]);
  });

  it('tipe null (kolom tak terbaca) tetap lolos', () => {
    expect(layananChatDariEtalase([etalase({ tipe: null })])).toHaveLength(1);
  });
});

describe('faqUntukLayanan', () => {
  it('memilih FAQ Layanan itu dan FAQ umum, urutan server dipertahankan', () => {
    const semua = [f('a', 'L1', 1), f('b', 'L2', 2), f('c', null, 3), f('d', 'L1', 4)];
    expect(faqUntukLayanan(semua, 'L1').map((x) => x.id)).toEqual(['a', 'c', 'd']);
    expect(faqUntukLayanan(semua, 'L9').map((x) => x.id)).toEqual(['c']);
  });
});
