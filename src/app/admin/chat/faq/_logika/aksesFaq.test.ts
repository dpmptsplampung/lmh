// Aturan akses halaman Kelola FAQ (tugas 8.1): cakupan per peran selaras RLS, gerbang muat, lingkup daftar, dan Pengaturan bot.
import { describe, expect, it } from 'vitest';
import type { LayananFaq } from '@/lib/data/faq';
import { lingkupFaq, turunkanAksesFaq, type MasukanAksesFaq } from './aksesFaq';

const L1: LayananFaq = { id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true };
const L2: LayananFaq = { id: 'l2', nama: 'Non OSS', chatbot_aktif: false };
const dasar = (o: Partial<MasukanAksesFaq> = {}): MasukanAksesFaq => ({
  role: 'admin', layananPetugasId: null, layananList: [L1, L2], layananSelesai: true, layananError: false, botPilih: '', ...o,
});

describe('lingkupFaq', () => {
  it('petugas berlayanan = layanannya; Front Office = umum; admin dan sisanya = semua', () => {
    expect(lingkupFaq('petugas', 'l1')).toEqual({ jenis: 'layanan', layananId: 'l1' });
    expect(lingkupFaq('front_office', null)).toEqual({ jenis: 'umum' });
    expect(lingkupFaq('admin', null)).toEqual({ jenis: 'semua' });
    expect(lingkupFaq('petugas', null)).toEqual({ jenis: 'semua' });
    expect(lingkupFaq(null, null)).toEqual({ jenis: 'semua' });
  });
});

describe('turunkanAksesFaq: peran dan cakupan', () => {
  it('admin: FAQ umum + semua layanan; panel bot tampil', () => {
    const a = turunkanAksesFaq(dasar());
    expect(a).toMatchObject({ isAdmin: true, isPetugas: false, isFrontOffice: false, siapMuat: true, tanpaAkses: false, tampilPanelBot: true });
    expect(a.opsiLayanan.map((o) => o.id)).toEqual([null, 'l1', 'l2']);
    expect(a.opsiBot.map((o) => o.id)).toEqual(['l1', 'l2']);
  });

  it('petugas: hanya layanannya; panel bot tampil (read-only di UI)', () => {
    const a = turunkanAksesFaq(dasar({ role: 'petugas', layananPetugasId: 'l1' }));
    expect(a.opsiLayanan.map((o) => o.id)).toEqual(['l1']);
    expect(a).toMatchObject({ isPetugas: true, siapMuat: true, tampilPanelBot: true, botLayananId: 'l1' });
  });

  it('Front Office: hanya FAQ umum; tanpa panel bot', () => {
    const a = turunkanAksesFaq(dasar({ role: 'front_office' }));
    expect(a.opsiLayanan.map((o) => o.id)).toEqual([null]);
    expect(a).toMatchObject({ isFrontOffice: true, siapMuat: true, tampilPanelBot: false, botLayananId: null, botLayanan: undefined });
  });

  it('petugas tanpa layanan dan peran tak dikenal = tanpa akses', () => {
    expect(turunkanAksesFaq(dasar({ role: 'petugas' })).tanpaAkses).toBe(true);
    expect(turunkanAksesFaq(dasar({ role: 'unknown' })).tanpaAkses).toBe(true);
  });
});

describe('turunkanAksesFaq: gerbang muat', () => {
  it('peran belum dimuat: belum siap, belum tanpa akses', () => {
    expect(turunkanAksesFaq(dasar({ role: null }))).toMatchObject({ siapMuat: false, tanpaAkses: false, opsiLayanan: [] });
  });

  it('layanan belum selesai dimuat: tidak siap dan belum dinyatakan tanpa akses', () => {
    expect(turunkanAksesFaq(dasar({ layananSelesai: false }))).toMatchObject({ siapMuat: false, tanpaAkses: false });
  });

  it('gagal memuat layanan memblokir admin dan petugas berlayanan, tidak Front Office', () => {
    const adm = turunkanAksesFaq(dasar({ layananList: [], layananError: true }));
    expect(adm).toMatchObject({ layananGagalBlokir: true, siapMuat: false, tanpaAkses: false });
    expect(turunkanAksesFaq(dasar({ role: 'petugas', layananPetugasId: 'l1', layananList: [], layananError: true }))).toMatchObject({ layananGagalBlokir: true });
    expect(turunkanAksesFaq(dasar({ role: 'front_office', layananList: [], layananError: true }))).toMatchObject({
      layananGagalBlokir: false, siapMuat: true,
    });
  });
});

describe('turunkanAksesFaq: Pengaturan bot', () => {
  it('pilihan sah dipakai; pilihan basi/kosong jatuh ke opsi pertama', () => {
    expect(turunkanAksesFaq(dasar({ botPilih: 'l2' })).botLayanan).toEqual(L2);
    expect(turunkanAksesFaq(dasar({ botPilih: 'tidak-ada' })).botLayananId).toBe('l1');
    expect(turunkanAksesFaq(dasar()).botLayananId).toBe('l1');
  });

  it('nama layanan terpetakan per id', () => {
    expect(turunkanAksesFaq(dasar()).namaLayanan.get('l2')).toBe('Non OSS');
  });
});
