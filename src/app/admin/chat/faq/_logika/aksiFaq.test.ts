import { describe, expect, it } from 'vitest';
import type { IsianFaq } from '@/components/admin/faq/types';
import { dasarDariIsian, himpunanDengan, himpunanTanpa, ringkasanProsesMassal, teksFaqBerubah } from './aksiFaq';

const isian = (o: Partial<IsianFaq> = {}): IsianFaq => ({ pertanyaan: '  Apa itu OSS? ', jawaban: ' Perizinan terpadu ', dasarHukum: '  ', urutan: 3, kunci: 'umum', pernyataan: true, ...o });

describe('dasarDariIsian', () => {
  it('memangkas teks dan mengubah dasar hukum kosong menjadi null', () => {
    expect(dasarDariIsian(isian())).toEqual({ pertanyaan: 'Apa itu OSS?', jawaban: 'Perizinan terpadu', dasarHukum: null, urutan: 3 });
  });
  it('dasar hukum terisi dipertahankan (dipangkas)', () => {
    expect(dasarDariIsian(isian({ dasarHukum: ' PP 5/2021 ' })).dasarHukum).toBe('PP 5/2021');
  });
});

describe('teksFaqBerubah', () => {
  const faq = { pertanyaan: 'A', jawaban: 'B' };
  it('false bila pertanyaan dan jawaban sama', () => expect(teksFaqBerubah(faq, { pertanyaan: 'A', jawaban: 'B' })).toBe(false));
  it('true bila salah satu berubah', () => {
    expect(teksFaqBerubah(faq, { pertanyaan: 'A2', jawaban: 'B' })).toBe(true);
    expect(teksFaqBerubah(faq, { pertanyaan: 'A', jawaban: 'B2' })).toBe(true);
  });
});

describe('ringkasanProsesMassal', () => {
  it('semua berhasil -> success tanpa catatan tambahan', () => {
    expect(ringkasanProsesMassal({ diproses: 4, gagal: 0, sisa: 0 })).toEqual({ pesan: '4 FAQ diproses.', jenis: 'success' });
  });
  it('ada gagal dan sisa -> error dengan catatan keduanya', () => {
    expect(ringkasanProsesMassal({ diproses: 2, gagal: 1, sisa: 5 })).toEqual({
      pesan: '2 FAQ diproses. 1 belum berhasil, coba lagi. 5 masih menunggu.',
      jenis: 'error',
    });
  });
  it('hanya sisa -> tetap success', () => {
    expect(ringkasanProsesMassal({ diproses: 50, gagal: 0, sisa: 3 }).jenis).toBe('success');
  });
});

describe('himpunanDengan / himpunanTanpa', () => {
  it('mengembalikan salinan baru tanpa memutasi asal', () => {
    const asal = new Set(['a']);
    const tambah = himpunanDengan(asal, 'b');
    expect([...tambah].sort()).toEqual(['a', 'b']);
    expect([...asal]).toEqual(['a']);
    const kurang = himpunanTanpa(tambah, 'a');
    expect([...kurang]).toEqual(['b']);
    expect(tambah.has('a')).toBe(true);
  });
  it('menghapus id yang tidak ada tidak mengubah isi', () => {
    expect([...himpunanTanpa(new Set(['a']), 'z')]).toEqual(['a']);
  });
});
