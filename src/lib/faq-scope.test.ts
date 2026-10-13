// Cakupan layanan yang boleh dikelola per peran pada halaman Kelola FAQ.
// Harus selaras dengan RLS faq_knowledge_base:
//   admin         -> faq_admin_all  (semua baris)
//   petugas       -> faq_petugas_all (layanan_id = get_my_layanan_id())
//   front_office  -> faq_fo_umum     (layanan_id IS NULL saja)
import { describe, it, expect } from 'vitest';
import { layananFaqBolehDikelola, OPSI_FAQ_UMUM } from './faq-scope';

const SEMUA = [
  { id: 'l1', nama: 'Helpdesk OSS' },
  { id: 'l2', nama: 'Perizinan Non-OSS' },
  { id: 'l3', nama: 'Konsultasi Investasi' },
];

describe('layananFaqBolehDikelola', () => {
  it('opsi Umum bernama "Umum (semua layanan)" dengan id null', () => {
    expect(OPSI_FAQ_UMUM).toEqual({ id: null, nama: 'Umum (semua layanan)' });
  });

  it('admin: opsi Umum di urutan pertama, lalu semua layanan sesuai urutan masukan', () => {
    const hasil = layananFaqBolehDikelola('admin', null, SEMUA);
    expect(hasil).toEqual([
      { id: null, nama: 'Umum (semua layanan)' },
      { id: 'l1', nama: 'Helpdesk OSS' },
      { id: 'l2', nama: 'Perizinan Non-OSS' },
      { id: 'l3', nama: 'Konsultasi Investasi' },
    ]);
  });

  it('admin: layananPetugasId diabaikan', () => {
    expect(layananFaqBolehDikelola('admin', 'l2', SEMUA)).toHaveLength(4);
  });

  it('admin tanpa layanan sama sekali: tetap ada opsi Umum', () => {
    expect(layananFaqBolehDikelola('admin', null, [])).toEqual([OPSI_FAQ_UMUM]);
  });

  it('petugas: hanya layanan miliknya, TANPA opsi Umum', () => {
    const hasil = layananFaqBolehDikelola('petugas', 'l2', SEMUA);
    expect(hasil).toEqual([{ id: 'l2', nama: 'Perizinan Non-OSS' }]);
    expect(hasil.some((o) => o.id === null)).toBe(false);
  });

  it('petugas tanpa layanan_id: daftar kosong (RLS: layanan_id = NULL tidak pernah cocok)', () => {
    expect(layananFaqBolehDikelola('petugas', null, SEMUA)).toEqual([]);
    expect(layananFaqBolehDikelola('petugas', undefined, SEMUA)).toEqual([]);
  });

  it('petugas dengan layanan_id yang tidak ada di daftar layanan: kosong', () => {
    expect(layananFaqBolehDikelola('petugas', 'l-gaib', SEMUA)).toEqual([]);
  });

  it('front_office: hanya Umum, tidak peduli layanan apa pun', () => {
    expect(layananFaqBolehDikelola('front_office', null, SEMUA)).toEqual([OPSI_FAQ_UMUM]);
    expect(layananFaqBolehDikelola('front_office', 'l1', SEMUA)).toEqual([OPSI_FAQ_UMUM]);
    expect(layananFaqBolehDikelola('front_office', null, [])).toEqual([OPSI_FAQ_UMUM]);
  });

  it('peran lain / tidak dikenal / null: daftar kosong', () => {
    for (const role of ['unknown', 'pengunjung', 'ADMIN', '', null, undefined]) {
      expect(layananFaqBolehDikelola(role, 'l1', SEMUA), String(role)).toEqual([]);
    }
  });

  it('tidak mengubah (mutasi) larik masukan dan mengembalikan objek baru', () => {
    const salinan = SEMUA.map((l) => ({ ...l }));
    const hasil = layananFaqBolehDikelola('admin', null, SEMUA);
    expect(SEMUA).toEqual(salinan);
    hasil[0].nama = 'diubah';
    expect(OPSI_FAQ_UMUM.nama).toBe('Umum (semua layanan)');
  });

  it('mengabaikan properti tambahan pada layanan (mis. chatbot_aktif) pada hasil', () => {
    const hasil = layananFaqBolehDikelola('petugas', 'l1', [{ id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true }]);
    expect(hasil).toEqual([{ id: 'l1', nama: 'Helpdesk OSS' }]);
  });
});
