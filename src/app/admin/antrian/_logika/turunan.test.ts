import { describe, expect, it } from 'vitest';
import type { ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import {
  NADA_STATUS,
  bolehLihatSemuaLayanan,
  durasiTeks,
  idKunjunganSelesai,
  idTahapAsal,
  judulHalaman,
  kunjunganDari,
  labelAsal,
  labelStatus,
  namaLayananDari,
  namaLayananProfil,
  namaPelayanDari,
  panelBerlaku,
  punyaPendataan,
  tanggalPanjang,
  turunkanPanel,
} from './turunan';

const tiket = (over: Partial<TiketBaris> = {}): TiketBaris => ({
  id: 't-1',
  kunjungan_id: 'k-1',
  legacy_visit_id: '',
  layanan_id: 'l-1',
  dilayani_oleh: null,
  penanganan_asal_id: null,
  pelayan: null,
  nomor: 1,
  nomor_display: 'A-001',
  status: 'menunggu',
  waktu_terbit: '2026-11-04T01:00:00.000Z',
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' },
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: '2026-11-04T01:05:00.000Z' },
  ...over,
});
const profil = (over: Partial<ProfilPetugasAntrean> = {}): ProfilPetugasAntrean => ({
  id: 'p-saya', role: 'admin', layanan_id: 'l-1', layanan: { nama: 'Helpdesk OSS' }, ...over,
});

describe('embed tiket', () => {
  it('kunjunganDari: objek, larik (elemen pertama), kosong -> null', () => {
    const k = { nama: 'Budi', asal: 'walk_in' as const, waktu_masuk: null };
    expect(kunjunganDari(tiket({ kunjungan: k }))).toBe(k);
    expect(kunjunganDari(tiket({ kunjungan: [k] }))).toBe(k);
    expect(kunjunganDari(tiket({ kunjungan: [] }))).toBeNull();
    expect(kunjunganDari(tiket({ kunjungan: null }))).toBeNull();
  });

  it('namaPelayanDari: objek, larik, kosong -> null', () => {
    expect(namaPelayanDari(tiket({ pelayan: { nama: 'Dewi' } }))).toBe('Dewi');
    expect(namaPelayanDari(tiket({ pelayan: [{ nama: 'Rina' }] }))).toBe('Rina');
    expect(namaPelayanDari(tiket({ pelayan: [] }))).toBeNull();
    expect(namaPelayanDari(tiket({ pelayan: null }))).toBeNull();
  });

  it('namaLayananDari: objek, larik, tanpa layanan atau tanpa nama -> tanda hubung panjang', () => {
    expect(namaLayananDari(tiket({ layanan: { nama: 'BPJS' } }))).toBe('BPJS');
    expect(namaLayananDari(tiket({ layanan: [{ nama: 'Perizinan' }] }))).toBe('Perizinan');
    expect(namaLayananDari(tiket({ layanan: [] }))).toBe('—');
    expect(namaLayananDari(tiket({ layanan: null }))).toBe('—');
    expect(namaLayananDari(tiket({ layanan: { nama: undefined as unknown as string } }))).toBe('—');
  });

  it('punyaPendataan: kolom form_pendataan menang; tanpa kolom jatuh ke deteksi nama', () => {
    expect(punyaPendataan(tiket({ layanan: { nama: 'BPJS Kesehatan', form_pendataan: 'perizinan' } }))).toBe(true);
    expect(punyaPendataan(tiket({ layanan: { nama: 'Helpdesk OSS', form_pendataan: null } }))).toBe(false);
    expect(punyaPendataan(tiket({ layanan: { nama: 'Helpdesk OSS' } }))).toBe(true);
    expect(punyaPendataan(tiket({ layanan: { nama: 'BPJS Kesehatan' } }))).toBe(false);
    expect(punyaPendataan(tiket({ layanan: [{ nama: 'BPJS', form_pendataan: 'oss' }] }))).toBe(true);
    expect(punyaPendataan(tiket({ layanan: null }))).toBe(false);
  });
});

describe('profil dan kepala halaman', () => {
  it('namaLayananProfil: objek, larik, atau tidak ada', () => {
    expect(namaLayananProfil(null)).toBeNull();
    expect(namaLayananProfil(profil({ layanan: undefined }))).toBeNull();
    expect(namaLayananProfil(profil({ layanan: { nama: 'Helpdesk OSS' } }))).toBe('Helpdesk OSS');
    expect(namaLayananProfil(profil({ layanan: [{ nama: 'BPJS' }] }))).toBe('BPJS');
    expect(namaLayananProfil(profil({ layanan: [] }))).toBeUndefined();
  });

  it('judulHalaman: hanya Petugas dengan nama Layanan yang mendapat judul Layanannya', () => {
    expect(judulHalaman(profil({ role: 'petugas' }), 'Helpdesk OSS')).toBe('Antrean Helpdesk OSS');
    expect(judulHalaman(profil({ role: 'petugas' }), null)).toBe('Antrean Semua Layanan');
    expect(judulHalaman(profil({ role: 'petugas' }), undefined)).toBe('Antrean Semua Layanan');
    expect(judulHalaman(profil({ role: 'admin' }), 'Helpdesk OSS')).toBe('Antrean Semua Layanan');
    expect(judulHalaman(profil({ role: 'front_office' }), 'Helpdesk OSS')).toBe('Antrean Semua Layanan');
    expect(judulHalaman(null, null)).toBe('Antrean Semua Layanan');
  });

  it('bolehLihatSemuaLayanan: Admin dan Front Office', () => {
    expect(bolehLihatSemuaLayanan(profil({ role: 'admin' }))).toBe(true);
    expect(bolehLihatSemuaLayanan(profil({ role: 'front_office' }))).toBe(true);
    expect(bolehLihatSemuaLayanan(profil({ role: 'petugas' }))).toBe(false);
    expect(bolehLihatSemuaLayanan(null)).toBe(false);
  });
});

describe('label', () => {
  it.each([
    ['menunggu', 'Menunggu'],
    ['dilayani', 'Dilayani'],
    ['selesai', 'Selesai'],
    ['tidak_terlayani', 'Tidak terlayani (petugas tidak hadir)'],
    ['no_show', 'Tidak datang (warga)'],
    ['batal', 'Batal'],
    ['dikembalikan', 'Dikembalikan ke FO'],
    ['dialihkan', 'Dialihkan'],
    ['status_baru', 'status_baru'],
  ])('labelStatus(%s)', (status, label) => {
    expect(labelStatus(status)).toBe(label);
  });

  it('labelAsal dan nada lencana per status', () => {
    expect(labelAsal('reservasi')).toBe('Reservasi');
    expect(labelAsal('walk_in')).toBe('Walk-in');
    expect(labelAsal('lain')).toBe('Walk-in');
    expect(NADA_STATUS).toEqual({
      menunggu: 'peringatan', dilayani: 'info', selesai: 'sukses', tidak_terlayani: 'bahaya',
      no_show: 'netral', batal: 'netral', dikembalikan: 'peringatan', dialihkan: 'info',
    });
  });

  it('tanggalPanjang: tanggal kalender WIB tanpa geseran hari', () => {
    expect(tanggalPanjang('2026-11-04')).toBe('4 November 2026');
    expect(tanggalPanjang('2026-01-01')).toBe('1 Januari 2026');
  });
});

describe('durasiTeks', () => {
  it('tanda hubung bila belum selesai; dihitung dari mulai layan; tanpa mulai dari waktu masuk lalu waktu terbit', () => {
    expect(durasiTeks(tiket())).toBe('—');
    expect(durasiTeks(tiket({ status: 'dilayani', waktu_mulai_layan: '2026-11-04T02:00:00.000Z' }))).toBe('—');
    expect(durasiTeks(tiket({
      status: 'selesai', waktu_mulai_layan: '2026-11-04T02:00:00.000Z', waktu_selesai: '2026-11-04T02:25:00.000Z',
    }))).toBe('25 menit');
    expect(durasiTeks(tiket({
      status: 'selesai', waktu_mulai_layan: null, waktu_selesai: '2026-11-04T01:35:00.000Z',
      kunjungan: { nama: 'x', asal: 'reservasi', waktu_masuk: '2026-11-04T01:05:00.000Z' },
    }))).toBe('30 menit');
    expect(durasiTeks(tiket({
      status: 'selesai', waktu_mulai_layan: null, waktu_selesai: '2026-11-04T01:30:00.000Z',
      waktu_terbit: '2026-11-04T01:00:00.000Z', kunjungan: null,
    }))).toBe('30 menit');
  });
});

describe('id untuk kueri lanjutan', () => {
  it('idTahapAsal: unik, tanpa null/kosong', () => {
    const baris = [
      tiket({ penanganan_asal_id: 'pn-1' }),
      tiket({ id: 't-2', penanganan_asal_id: 'pn-1' }),
      tiket({ id: 't-3', penanganan_asal_id: 'pn-2' }),
      tiket({ id: 't-4', penanganan_asal_id: null }),
      tiket({ id: 't-5', penanganan_asal_id: '' }),
      tiket({ id: 't-6', penanganan_asal_id: undefined }),
    ];
    expect(idTahapAsal(baris)).toEqual(['pn-1', 'pn-2']);
    expect(idTahapAsal([])).toEqual([]);
  });

  it('idKunjunganSelesai: hanya tiket selesai yang punya kunjungan_id (urutan baris dipertahankan)', () => {
    const baris = [
      tiket({ status: 'selesai', kunjungan_id: 'k-1' }),
      tiket({ id: 't-2', status: 'menunggu', kunjungan_id: 'k-2' }),
      tiket({ id: 't-3', status: 'selesai', kunjungan_id: '' }),
      tiket({ id: 't-4', status: 'selesai', kunjungan_id: 'k-4' }),
    ];
    expect(idKunjunganSelesai(baris)).toEqual(['k-1', 'k-4']);
  });
});

describe('panelBerlaku', () => {
  it('hanya hari ini dan bukan tab Selesai', () => {
    expect(panelBerlaku('2026-11-04', 'aktif', '2026-11-04')).toBe(true);
    expect(panelBerlaku('2026-11-04', 'semua', '2026-11-04')).toBe(true);
    expect(panelBerlaku('2026-11-04', 'selesai', '2026-11-04')).toBe(false);
    expect(panelBerlaku('2026-11-03', 'aktif', '2026-11-04')).toBe(false);
  });
});

describe('turunkanPanel', () => {
  const saya = profil({ id: 'p-saya', role: 'petugas', layanan_id: 'l-1' });

  it('berikutnya = nomor menunggu terkecil di Layanan aktif; sedang dilayani = tiket saya; bentuk TiketPanel', () => {
    const baris = [
      tiket({ id: 't-3', nomor: 3, nomor_display: 'A-003', kunjungan: { nama: 'Cici', asal: 'walk_in', waktu_masuk: null }, waktu_terbit: '2026-11-04T03:00:00.000Z' }),
      tiket({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan: { nama: 'Dewi', asal: 'walk_in', waktu_masuk: '2026-11-04T02:00:00.000Z' } }),
      tiket({
        id: 't-0', nomor: 0, nomor_display: 'A-000', status: 'dilayani', dilayani_oleh: 'p-saya',
        waktu_mulai_layan: '2026-11-04T04:00:00.000Z', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null },
      }),
    ];
    const hasil = turunkanPanel(baris, saya, null);
    expect(hasil.berikutnya).toEqual({
      id: 't-2', nomor_display: 'A-002', layananNama: 'Helpdesk OSS', namaPengunjung: 'Dewi',
      waktu: '2026-11-04T02:00:00.000Z', bolehMulai: true, bolehSelesai: false,
    });
    expect(hasil.sedangDilayani).toEqual({
      id: 't-0', nomor_display: 'A-000', layananNama: 'Helpdesk OSS', namaPengunjung: 'Sari',
      waktu: '2026-11-04T04:00:00.000Z', bolehMulai: false, bolehSelesai: true,
    });
    expect(hasil.layananAktif).toBe('l-1');
    // input tidak diubah urutannya
    expect(baris.map((b) => b.id)).toEqual(['t-3', 't-2', 't-0']);
  });

  it('waktu tiket berikutnya: waktu masuk kunjungan, jatuh ke waktu terbit; nama kosong -> tanda hubung', () => {
    const tanpaMasuk = turunkanPanel([tiket({ kunjungan: { nama: 'x', asal: 'walk_in', waktu_masuk: null }, waktu_terbit: '2026-11-04T03:00:00.000Z' })], saya, null);
    expect(tanpaMasuk.berikutnya?.waktu).toBe('2026-11-04T03:00:00.000Z');
    const tanpaKunjungan = turunkanPanel([tiket({ kunjungan: null })], saya, null);
    expect(tanpaKunjungan.berikutnya?.namaPengunjung).toBe('—');
  });

  it('pilihan Layanan: hanya yang punya tiket menunggu, urut nama (lokal id), bebas duplikat; tiket dilayani tidak membuat pilihan', () => {
    const baris = [
      tiket({ id: 't-1', layanan_id: 'l-1', layanan: { nama: 'Helpdesk OSS' } }),
      tiket({ id: 't-2', nomor: 2, layanan_id: 'l-1', layanan: { nama: 'Helpdesk OSS' } }),
      tiket({ id: 't-5', nomor: 5, layanan_id: 'l-2', layanan: { nama: 'BPJS Kesehatan' } }),
      tiket({ id: 't-7', nomor: 7, layanan_id: 'l-3', status: 'dilayani', dilayani_oleh: 'p-lain', layanan: { nama: 'Perizinan' } }),
    ];
    const hasil = turunkanPanel(baris, profil({ role: 'admin' }), null);
    expect(hasil.opsiLayanan).toEqual([{ id: 'l-2', nama: 'BPJS Kesehatan' }, { id: 'l-1', nama: 'Helpdesk OSS' }]);
    expect(hasil.layananAktif).toBe('l-2');
    expect(hasil.berikutnya?.id).toBe('t-5');
  });

  it('pilihan yang masih punya tiket menunggu dipakai; yang tidak lagi ada jatuh ke pilihan pertama; tanpa pilihan -> null', () => {
    const baris = [
      tiket({ id: 't-1', layanan_id: 'l-1' }),
      tiket({ id: 't-5', nomor: 5, layanan_id: 'l-2', layanan: { nama: 'BPJS Kesehatan' } }),
    ];
    const admin = profil({ role: 'admin' });
    expect(turunkanPanel(baris, admin, 'l-1').layananAktif).toBe('l-1');
    expect(turunkanPanel(baris, admin, 'l-1').berikutnya?.id).toBe('t-1');
    expect(turunkanPanel(baris, admin, 'l-9').layananAktif).toBe('l-2');
    const kosong = turunkanPanel([], admin, 'l-1');
    expect(kosong).toEqual({ opsiLayanan: [], layananAktif: null, sedangDilayani: null, berikutnya: null });
  });

  it('hak tombol mengikuti peran: Admin boleh mulai di semua Layanan, Petugas hanya Layanannya, Front Office tidak', () => {
    const baris = [tiket({ id: 't-1', layanan_id: 'l-2', layanan: { nama: 'BPJS Kesehatan' } })];
    expect(turunkanPanel(baris, profil({ role: 'admin' }), null).berikutnya?.bolehMulai).toBe(true);
    expect(turunkanPanel(baris, profil({ role: 'petugas', layanan_id: 'l-2' }), null).berikutnya?.bolehMulai).toBe(true);
    expect(turunkanPanel(baris, profil({ role: 'petugas', layanan_id: 'l-1' }), null).berikutnya?.bolehMulai).toBe(false);
    expect(turunkanPanel(baris, profil({ role: 'front_office' }), null).berikutnya?.bolehMulai).toBe(false);
    expect(turunkanPanel(baris, null, null).berikutnya?.bolehMulai).toBe(false);
  });

  it('sedang dilayani: tiket dilayani orang lain tidak dihitung; Front Office tidak punya tiket sendiri', () => {
    const baris = [tiket({ id: 't-9', status: 'dilayani', dilayani_oleh: 'p-lain' })];
    expect(turunkanPanel(baris, saya, null).sedangDilayani).toBeNull();
    const milikFo = [tiket({ id: 't-9', status: 'dilayani', dilayani_oleh: 'p-fo' })];
    expect(turunkanPanel(milikFo, profil({ id: 'p-fo', role: 'front_office' }), null).sedangDilayani).toBeNull();
  });
});
