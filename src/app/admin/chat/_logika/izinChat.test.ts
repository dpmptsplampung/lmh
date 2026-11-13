import { describe, expect, it } from 'vitest';
import type { RingkasSesi, TahapChat } from '@/lib/data/chat-staf';
import type { StatusLayananChat } from '@/lib/chat/status-layanan';
import {
  adaBanyakSesi,
  alasanTanpaLayanan,
  belumDibaca,
  catatanBalas,
  hitungSesi,
  izinSesi,
  labelStatus,
  namaPemegang,
  peringatanTeruskan,
  tandaiTerbaca,
  urutkanSesi,
  type PenggunaChat,
} from './izinChat';

const sesi = (o: Partial<RingkasSesi> = {}): RingkasSesi => ({
  id: 's1', status: 'eskalasi', layanan_id: 'l1', pengunjung_id: null, ditangani_oleh: null,
  created_at: '2026-10-14T01:00:00Z', updated_at: '2026-10-14T01:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-10-14T01:00:01Z', last_pengirim: 'pengunjung', unread: true, ...o,
});
const tahap = (o: Partial<TahapChat> = {}): TahapChat => ({
  id: 'pn-1', chat_sesi_id: 's1', peran_tahap: 'fo', status: 'menunggu', layanan_id: null, penangan_id: null, ...o,
});
const fo: PenggunaChat = { petugasId: 'me', role: 'front_office' };
const admin: PenggunaChat = { petugasId: 'me', role: 'admin' };
const petugas: PenggunaChat = { petugasId: 'me', role: 'petugas' };

describe('izinSesi', () => {
  it('FO: chat menunggu boleh diambil; belum boleh membalas, meneruskan, atau ambil alih', () => {
    const i = izinSesi(sesi(), tahap(), fo);
    expect(i).toMatchObject({ bolehAmbil: true, bolehBalas: false, bolehTeruskan: false, bolehAmbilAlih: false, pemilik: false });
  });

  it('chat dengan bot juga boleh diambil; chat selesai tidak', () => {
    expect(izinSesi(sesi({ status: 'bot' }), null, fo).bolehAmbil).toBe(true);
    expect(izinSesi(sesi({ status: 'selesai' }), null, admin).bolehAmbil).toBe(false);
  });

  it('FO tidak boleh mengambil chat yang sudah diteruskan ke layanan; Admin dan Petugas boleh', () => {
    const diteruskan = tahap({ peran_tahap: 'layanan', layanan_id: 'l1' });
    expect(izinSesi(sesi(), diteruskan, fo).bolehAmbil).toBe(false);
    expect(izinSesi(sesi(), diteruskan, admin).bolehAmbil).toBe(true);
    expect(izinSesi(sesi(), diteruskan, petugas).bolehAmbil).toBe(true);
    expect(izinSesi(sesi(), diteruskan, fo).menungguLayanan).toBe(true);
  });

  it('tahap berjalan (sudah diambil) bukan menunggu layanan', () => {
    expect(izinSesi(sesi(), tahap({ peran_tahap: 'layanan', status: 'berjalan' }), fo).menungguLayanan).toBe(false);
  });

  it('pemilik tahap FO: balas, teruskan, tetapi tidak ambil/ambil alih', () => {
    const i = izinSesi(sesi({ status: 'aktif', ditangani_oleh: 'me' }), tahap({ status: 'berjalan' }), fo);
    expect(i).toMatchObject({ pemilik: true, bolehBalas: true, bolehTeruskan: true, bolehAmbil: false, bolehAmbilAlih: false, peranPemilik: 'fo' });
  });

  it('pemilik tahap layanan: balas tanpa teruskan', () => {
    const i = izinSesi(sesi({ status: 'aktif', ditangani_oleh: 'me' }), tahap({ peran_tahap: 'layanan', status: 'berjalan' }), petugas);
    expect(i).toMatchObject({ bolehBalas: true, bolehTeruskan: false, peranPemilik: 'layanan' });
  });

  it('tanpa tahap terbaca: peran tahap diturunkan dari peran akun', () => {
    const aktif = sesi({ status: 'aktif', ditangani_oleh: 'me' });
    expect(izinSesi(aktif, null, petugas).peranPemilik).toBe('layanan');
    expect(izinSesi(aktif, null, fo).peranPemilik).toBe('fo');
    expect(izinSesi(aktif, null, admin).peranPemilik).toBe('fo');
  });

  it('dipegang staf lain: hanya Admin yang boleh ambil alih; bukan pemilik', () => {
    const lain = sesi({ status: 'aktif', ditangani_oleh: 'rekan' });
    expect(izinSesi(lain, tahap({ status: 'berjalan' }), admin)).toMatchObject({ dipegangLain: true, bolehAmbilAlih: true, bolehBalas: false });
    expect(izinSesi(lain, tahap({ status: 'berjalan' }), fo)).toMatchObject({ dipegangLain: true, bolehAmbilAlih: false });
    expect(izinSesi(lain, null, petugas).bolehAmbilAlih).toBe(false);
  });

  it('profil belum termuat: tidak ada yang dianggap milik sendiri', () => {
    const belum: PenggunaChat = { petugasId: null, role: null };
    const i = izinSesi(sesi({ status: 'aktif', ditangani_oleh: 'me' }), null, belum);
    expect(i.pemilik).toBe(false);
    expect(i.dipegangLain).toBe(true);
    expect(i.bolehAmbilAlih).toBe(false);
  });
});

describe('label dan nama', () => {
  it('label status: eskalasi yang menunggu petugas layanan diberi label khusus', () => {
    expect(labelStatus(sesi(), null)).toBe('Menunggu Diambil');
    expect(labelStatus(sesi(), tahap({ peran_tahap: 'layanan' }))).toBe('Menunggu Petugas Layanan');
    expect(labelStatus(sesi({ status: 'aktif' }), tahap({ peran_tahap: 'layanan' }))).toBe('Aktif');
    expect(labelStatus(sesi({ status: 'bot' }), null)).toBe('Bot');
    expect(labelStatus(sesi({ status: 'selesai' }), null)).toBe('Selesai');
  });

  it('nama pemegang: null tanpa pemegang, "petugas lain" bila namanya tidak termuat', () => {
    expect(namaPemegang(sesi(), { rekan: 'Sari' })).toBeNull();
    expect(namaPemegang(sesi({ ditangani_oleh: 'rekan' }), { rekan: 'Sari' })).toBe('Sari');
    expect(namaPemegang(sesi({ ditangani_oleh: 'asing' }), { rekan: 'Sari' })).toBe('petugas lain');
  });
});

describe('daftar', () => {
  it('eskalasi di atas, sisanya urutan tetap; tidak mengubah masukan', () => {
    const masuk = [sesi({ id: 'a', status: 'bot' }), sesi({ id: 'b', status: 'aktif' }), sesi({ id: 'c', status: 'eskalasi' }), sesi({ id: 'd', status: 'eskalasi' })];
    expect(urutkanSesi(masuk).map((s) => s.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(masuk.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hitungan aktif (bukan selesai) dan menunggu diambil', () => {
    const masuk = [sesi({ status: 'bot' }), sesi({ status: 'selesai' }), sesi({ status: 'eskalasi' }), sesi({ status: 'aktif' })];
    expect(hitungSesi(masuk)).toEqual({ aktif: 3, menunggu: 1 });
    expect(hitungSesi([])).toEqual({ aktif: 0, menunggu: 0 });
  });

  it('belum dibaca: bukan sesi terpilih, unread, dan belum dibuka sejak pesan terakhir', () => {
    const s = sesi();
    expect(belumDibaca(s, null, {})).toBe(true);
    expect(belumDibaca(s, 's1', {})).toBe(false);
    expect(belumDibaca(sesi({ unread: false }), null, {})).toBe(false);
    expect(belumDibaca(s, null, { s1: s.last_pesan_at })).toBe(false);
    expect(belumDibaca(s, null, { s1: '2026-10-14T00:00:00Z' })).toBe(true);
  });

  it('tandai terbaca mencatat waktu pesan terakhir tanpa mengubah catatan lain', () => {
    const lama = { x: 'a' };
    const baru = tandaiTerbaca(lama, sesi());
    expect(baru).toEqual({ x: 'a', s1: '2026-10-14T01:00:01Z' });
    expect(lama).toEqual({ x: 'a' });
  });

  it('pembatas sesi hanya bila pesan berasal dari lebih dari satu sesi', () => {
    expect(adaBanyakSesi([])).toBe(false);
    expect(adaBanyakSesi([{ sesi_id: 'a' }, { sesi_id: 'a' }, {}])).toBe(false);
    expect(adaBanyakSesi([{ sesi_id: 'a' }, { sesi_id: 'b' }])).toBe(true);
  });
});

describe('alasan hari tanpa layanan dan catatan balasan', () => {
  const status = (o: Partial<StatusLayananChat> = {}): StatusLayananChat => ({
    buka: false, tanggal: '2026-10-17', liburKeterangan: null, hariTanpaLayanan: true, bukaBerikutnya: null, sumber: 'jadwal', ...o,
  });

  it('null saat beroperasi atau status belum diketahui', () => {
    expect(alasanTanpaLayanan(null, 'Helpdesk OSS')).toBeNull();
    expect(alasanTanpaLayanan(status({ hariTanpaLayanan: false }), 'Helpdesk OSS')).toBeNull();
  });

  it('menyebut nama layanan dan keterangan libur atau "di luar jadwal"', () => {
    expect(alasanTanpaLayanan(status({ liburKeterangan: 'HUT RI' }), 'Helpdesk OSS')).toContain(
      'karena Helpdesk OSS tidak beroperasi hari ini (hari libur: HUT RI).',
    );
    expect(alasanTanpaLayanan(status(), undefined)).toContain('karena layanan ini tidak beroperasi hari ini (di luar jadwal).');
  });

  const izin = (s: RingkasSesi, t: TahapChat | null, p: PenggunaChat) => izinSesi(s, t, p);

  it('urutan prioritas catatan balasan', () => {
    const lain = sesi({ status: 'aktif', ditangani_oleh: 'rekan' });
    expect(catatanBalas(izin(lain, null, admin), 'Sari', null)).toBe(
      'Chat ini sedang ditangani Sari. Tekan "Ambil Alih Chat" (alasan wajib) untuk membalas.',
    );
    expect(catatanBalas(izin(lain, null, fo), null, null)).toBe('Chat ini sedang ditangani petugas lain.');
    expect(catatanBalas(izin(lain, null, fo), 'Sari', 'LIBUR')).toBe('Chat ini sedang ditangani Sari. LIBUR');
    expect(catatanBalas(izin(sesi(), null, fo), null, 'LIBUR')).toBe('LIBUR');
    expect(catatanBalas(izin(sesi(), tahap({ peran_tahap: 'layanan' }), fo), null, null)).toBe(
      'Chat ini sudah diteruskan ke petugas layanan. Petugas layanan yang akan mengambilnya.',
    );
    expect(catatanBalas(izin(sesi(), null, fo), null, null)).toBe('Tekan "Ambil Chat" untuk mulai membalas pengunjung.');
  });
});

describe('peringatanTeruskan', () => {
  it('belum ada petugas hadir -> peringatan; notifikasi nol -> peringatan lain; lengkap -> null', () => {
    expect(peringatanTeruskan({ layanan_nama: 'Bank', petugas_hadir: false, notifikasi_diantrekan: 3 })).toContain('belum ada petugas layanan itu yang hadir hari ini');
    expect(peringatanTeruskan({ layanan_nama: 'Bank', petugas_hadir: true, notifikasi_diantrekan: 0 })).toContain('tidak ada notifikasi yang terkirim');
    expect(peringatanTeruskan({ layanan_nama: 'Bank', petugas_hadir: true, notifikasi_diantrekan: 2 })).toBeNull();
  });
});
