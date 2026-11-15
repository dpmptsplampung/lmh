// Turunan murni halaman chat pengunjung (tugas 6.1).
import { describe, expect, it } from 'vitest';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import type { FaqChat } from '@/lib/data/chat-pengunjung';
import type { ChatMsg } from '../merge';
import {
  TEKS_BOT_TIDAK_TERSEDIA,
  cariLayananDariParam,
  hanyaBaca,
  idPesanPengunjungTerakhir,
  keputusanAwal,
  layananPercakapan,
  pesanPemberitahuan,
  pesanSambutan,
  placeholderPesan,
  tampilanAktif,
  teksBotGagal,
  urutkanFaq,
} from './turunan';

const L = '11111111-1111-4111-8111-111111111111';
const faq = (id: string, layanan_id: string | null, urutan: number | null): FaqChat => ({ id, pertanyaan: id, jawaban: '', layanan_id, urutan });
const ringkas = (layananId: string): PercakapanRingkas => ({
  layananId, layananNama: layananId, layananAktif: true, punyaChat: true, chatbotAktif: true, jumlahSesi: 1,
  sesiTerakhirId: `s-${layananId}`, sesiTerbukaId: null, statusTerakhir: 'selesai', lastPesan: null, lastPesanAt: null,
  lastPengirim: null,
});

describe('urutkanFaq', () => {
  it('FAQ layanan lebih dulu, lalu umum; tiap kelompok menurut urutan, stabil', () => {
    const hasil = urutkanFaq([faq('u1', null, 1), faq('l2', L, 3), faq('l1', L, 2), faq('u2', null, 4), faq('l3', L, 2)], L);
    expect(hasil.map((f) => f.id)).toEqual(['l1', 'l3', 'l2', 'u1', 'u2']);
  });
});

describe('cariLayananDariParam', () => {
  const daftar = [{ id: L, nama: 'Bank Lampung' }, { id: 'x', nama: 'Helpdesk OSS' }];
  it('id persis, nama tanpa beda huruf besar, lalu nama memuat', () => {
    expect(cariLayananDariParam(daftar, L)?.id).toBe(L);
    expect(cariLayananDariParam(daftar, 'helpdesk oss')?.id).toBe('x');
    expect(cariLayananDariParam(daftar, 'lampung')?.id).toBe(L);
    expect(cariLayananDariParam(daftar, 'tidak ada')).toBeUndefined();
    expect(cariLayananDariParam(daftar, null)).toBeUndefined();
  });
});

describe('keputusanAwal', () => {
  it('?layanan= dengan percakapan dibuka; tanpa percakapan formulir; tanpa parameter daftar/formulir; gagal = daftar', () => {
    const items = [ringkas(L)];
    expect(keputusanAwal(items, { id: L })).toEqual({ buka: items[0] });
    expect(keputusanAwal(items, { id: 'lain' })).toEqual({ tampilan: 'baru' });
    expect(keputusanAwal(items, undefined)).toEqual({ tampilan: 'daftar' });
    expect(keputusanAwal([], undefined)).toEqual({ tampilan: 'baru' });
    expect(keputusanAwal(null, { id: L })).toEqual({ tampilan: 'daftar' });
  });
});

describe('pesan lokal', () => {
  it('sambutan menyebut nama dan Layanan; teks berbeda bila chatbot nonaktif', () => {
    const bot = pesanSambutan({ nama: 'Budi', layananNama: 'Bank Lampung', botAktif: true, waktu: 'T' });
    expect(bot).toMatchObject({ id: 'welcome', pengirim: 'bot', created_at: 'T', local: 'notice' });
    expect(bot.isi).toContain('Halo Bapak/Ibu Budi.');
    expect(bot.isi).toContain('Live Chat Bank Lampung');
    expect(bot.isi).toContain('asisten virtual (bot)');
    const tanpaBot = pesanSambutan({ nama: 'Budi', layananNama: '', botAktif: false, waktu: 'T' });
    expect(tanpaBot.isi).toContain('Live Chat DPMPTSP');
    expect(tanpaBot.isi).toContain('chatbot FAQ saat ini nonaktif');
  });

  it('pemberitahuan: id berawalan notice-, transient bawaan false', () => {
    expect(pesanPemberitahuan('x', { id: 'a', waktu: 'T' })).toEqual({
      id: 'notice-a', pengirim: 'bot', isi: 'x', created_at: 'T', local: 'notice', transient: false,
    });
    expect(pesanPemberitahuan('x', { id: 'a', waktu: 'T', transient: true }).transient).toBe(true);
  });

  it('galat bot: waktu habis dibedakan menurut jam layanan', () => {
    expect(teksBotGagal({ waktuHabis: false, tutup: true })).toBe(TEKS_BOT_TIDAK_TERSEDIA);
    expect(teksBotGagal({ waktuHabis: true, tutup: false })).toContain('Hubungkan ke Petugas');
    expect(teksBotGagal({ waktuHabis: true, tutup: true })).toContain('kirim ulang pertanyaan');
  });
});

describe('nilai turunan tampilan', () => {
  it('tampilan awal: memuat selama cek login atau daftar belum siap; selain itu formulir', () => {
    expect(tampilanAktif({ tampilan: 'awal', memeriksa: true, masuk: false, daftarSiap: false })).toBe('memuat');
    expect(tampilanAktif({ tampilan: 'awal', memeriksa: false, masuk: true, daftarSiap: false })).toBe('memuat');
    expect(tampilanAktif({ tampilan: 'awal', memeriksa: false, masuk: false, daftarSiap: false })).toBe('baru');
    expect(tampilanAktif({ tampilan: 'daftar', memeriksa: true, masuk: true, daftarSiap: false })).toBe('daftar');
  });

  it('layanan sesi lebih dulu dari pilihan formulir; hanya-baca hanya setelah daftar layanan berhasil dimuat', () => {
    const daftar = [{ id: 'a' }, { id: 'b' }];
    expect(layananPercakapan(daftar, 'b', 'a')?.id).toBe('b');
    expect(layananPercakapan(daftar, null, 'a')?.id).toBe('a');
    const dasar = { tampilan: 'percakapan' as const, memuatLayanan: false, galatLayanan: false, adaLayanan: false };
    expect(hanyaBaca(dasar)).toBe(true);
    expect(hanyaBaca({ ...dasar, memuatLayanan: true })).toBe(false);
    expect(hanyaBaca({ ...dasar, galatLayanan: true })).toBe(false);
    expect(hanyaBaca({ ...dasar, adaLayanan: true })).toBe(false);
    expect(hanyaBaca({ ...dasar, tampilan: 'daftar' })).toBe(false);
  });

  it('pesan pengunjung terakhir dan placeholder input', () => {
    const m = (id: string, pengirim: ChatMsg['pengirim']): ChatMsg => ({ id, pengirim, isi: '', created_at: '' });
    expect(idPesanPengunjungTerakhir([m('1', 'pengunjung'), m('2', 'bot'), m('3', 'pengunjung'), m('4', 'petugas')])).toBe('3');
    expect(idPesanPengunjungTerakhir([m('2', 'bot')])).toBeUndefined();
    const p = { daring: true, hanyaBaca: false, sesiId: 's', status: 'bot' as const };
    expect(placeholderPesan({ ...p, daring: false, hanyaBaca: true })).toBe('Anda sedang offline...');
    expect(placeholderPesan({ ...p, hanyaBaca: true })).toBe('Percakapan ini hanya dapat dibaca...');
    expect(placeholderPesan({ ...p, status: 'selesai' })).toBe('Ketik pesan untuk memulai sesi baru...');
    expect(placeholderPesan({ ...p, sesiId: null })).toBe('Ketik pesan untuk memulai sesi baru...');
    expect(placeholderPesan(p)).toBe('Ketik pertanyaan Anda...');
  });
});
