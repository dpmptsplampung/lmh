// Data uji bersama untuk test komponen _bagian (bukan kode produksi; tidak diimpor halaman).
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';

export function buatTiket(over: Partial<TiketBaris> = {}): TiketBaris {
  return {
    id: 't-1',
    kunjungan_id: 'k-1',
    legacy_visit_id: '',
    layanan_id: 'l-oss',
    dilayani_oleh: null,
    pelayan: null,
    nomor: 1,
    nomor_display: 'OS-001',
    status: 'menunggu',
    waktu_terbit: '2026-11-11T01:00:00Z',
    waktu_mulai_layan: null,
    waktu_selesai: null,
    layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' },
    kunjungan: { nama: 'Rina', asal: 'walk_in', waktu_masuk: '2026-11-11T01:00:00Z' },
    ...over,
  };
}

export const ADMIN: ProfilPetugasAntrean = { id: 'p-admin', role: 'admin', layanan_id: '' };
export const FO: ProfilPetugasAntrean = { id: 'p-fo', role: 'front_office', layanan_id: '' };
export const PETUGAS: ProfilPetugasAntrean = { id: 'p-1', role: 'petugas', layanan_id: 'l-oss' };
export const KOORDINATOR: ProfilPetugasAntrean = { ...PETUGAS, id: 'p-koord', koordinator: true };
