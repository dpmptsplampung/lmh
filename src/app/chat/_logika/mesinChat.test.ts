// Transisi mesin keadaan percakapan pengunjung (tugas 6.1), diturunkan dari perilaku page.tsx sebelum refaktor:
// bot -> eskalasi -> petugas -> selesai, luar jam, sesi baru dari percakapan selesai, penjaga R4, coba lagi persetujuan.
import { describe, expect, it } from 'vitest';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import {
  KEADAAN_AWAL_CHAT,
  kurangiChat,
  modeBot,
  modePercakapan,
  type AksiChat,
  type KeadaanChat,
} from './mesinChat';

const L = '11111111-1111-4111-8111-111111111111';
const percakapan = (over: Partial<PercakapanRingkas> = {}): PercakapanRingkas => ({
  layananId: L, layananNama: 'Bank Lampung', layananAktif: true, punyaChat: true, chatbotAktif: true, jumlahSesi: 1,
  sesiTerakhirId: 'sesi-1', sesiTerbukaId: 'sesi-1', statusTerakhir: 'bot', lastPesan: null, lastPesanAt: null,
  lastPengirim: null, ...over,
});
const jalankan = (aksi: AksiChat[], awal: KeadaanChat = KEADAAN_AWAL_CHAT) => aksi.reduce(kurangiChat, awal);
const mode = (k: KeadaanChat, tutup = false, hanyaBaca = false) => modePercakapan(k, { tutup, hanyaBaca });

describe('mesinChat: alur status sesi', () => {
  it('bot -> eskalasi -> petugas (aktif) -> selesai', () => {
    let k = jalankan([{ jenis: 'buka', percakapan: percakapan() }]);
    expect(k).toMatchObject({ tampilan: 'percakapan', sesiId: 'sesi-1', status: 'bot', layananId: L, sesiLayananId: L });
    expect(mode(k)).toBe('bot');

    k = kurangiChat(k, { jenis: 'status', status: 'eskalasi' });
    expect(mode(k)).toBe('menunggu');
    k = kurangiChat(k, { jenis: 'status', status: 'aktif', sesiId: 'sesi-1' });
    expect(mode(k)).toBe('petugas');
    k = kurangiChat(k, { jenis: 'status', status: 'selesai' });
    expect(mode(k)).toBe('selesai');
    expect(k.sesiId).toBe('sesi-1'); // sesi tetap; pesan berikutnya membuat sesi baru (pastikanSesi)
  });

  it('percakapan tanpa sesi terbuka dibuka sebagai selesai; sesi baru (bukan dari formulir) tidak mengubah tampilan', () => {
    let k = jalankan([{ jenis: 'buka', percakapan: percakapan({ sesiTerbukaId: null, statusTerakhir: 'selesai' }) }]);
    expect(k).toMatchObject({ sesiId: null, status: 'selesai' });
    expect(mode(k)).toBe('selesai');
    k = kurangiChat(k, { jenis: 'sesiDibuat', sesi: { id: 'sesi-baru', status: 'bot' }, layananId: L, buka: false });
    expect(k).toMatchObject({ sesiId: 'sesi-baru', status: 'bot', tampilan: 'percakapan' });
    expect(mode(k)).toBe('bot');
  });

  it('statusTerakhir dipakai hanya bila ada sesi terbuka', () => {
    expect(jalankan([{ jenis: 'buka', percakapan: percakapan({ statusTerakhir: 'aktif' }) }]).status).toBe('aktif');
    expect(jalankan([{ jenis: 'buka', percakapan: percakapan({ sesiTerbukaId: null, statusTerakhir: 'aktif' }) }]).status).toBe('selesai');
  });

  it('hanya-baca mengalahkan semua status', () => {
    const k = jalankan([{ jenis: 'buka', percakapan: percakapan() }]);
    expect(mode(k, false, true)).toBe('hanyaBaca');
    expect(mode(kurangiChat(k, { jenis: 'status', status: 'aktif' }), true, true)).toBe('hanyaBaca');
  });
});

describe('mesinChat: luar jam', () => {
  it('eskalasi di luar jam = menunggu jam kerja, bot tetap menjawab bila aktif', () => {
    const k = jalankan([{ jenis: 'buka', percakapan: percakapan({ statusTerakhir: 'eskalasi' }) }]);
    expect(mode(k, true)).toBe('menungguLuarJam');
    expect(modeBot('eskalasi', true, true)).toBe(true);
    expect(modeBot('eskalasi', true, false)).toBe(false); // Layanan tanpa bot: pengunjung meninggalkan pesan
    expect(modeBot('eskalasi', false, true)).toBe(false); // jam kerja: petugas yang menjawab
  });

  it('bot tidak pernah menjawab sesi aktif/selesai, dan tidak menjawab bila chatbot Layanan nonaktif', () => {
    expect(modeBot('bot', false, true)).toBe(true);
    expect(modeBot('bot', true, true)).toBe(true);
    expect(modeBot('bot', false, false)).toBe(false);
    expect(modeBot('aktif', true, true)).toBe(false);
    expect(modeBot('selesai', true, true)).toBe(false);
  });
});

describe('mesinChat: penjaga percakapan lama (R4) dan generasi', () => {
  it('status dari sesi lain dibuang; status tanpa sesi diterapkan', () => {
    const k = jalankan([{ jenis: 'buka', percakapan: percakapan() }]);
    expect(kurangiChat(k, { jenis: 'status', status: 'eskalasi', sesiId: 'sesi-lama' })).toBe(k);
    expect(kurangiChat(k, { jenis: 'status', status: 'eskalasi' }).status).toBe('eskalasi');
  });

  it('membuka dan meninggalkan percakapan menaikkan generasi', () => {
    const k = jalankan([
      { jenis: 'buka', percakapan: percakapan() },
      { jenis: 'kembali' },
      { jenis: 'buka', percakapan: percakapan({ layananId: 'lain', sesiTerbukaId: 'sesi-B' }) },
    ]);
    expect(k.generasi).toBe(3);
    expect(k).toMatchObject({ tampilan: 'percakapan', sesiId: 'sesi-B', layananId: 'lain' });
  });

  it('meninggalkan percakapan tidak menghapus sesi (respons lama tetap dikenali lewat generasi)', () => {
    const k = jalankan([{ jenis: 'buka', percakapan: percakapan() }, { jenis: 'kembali' }]);
    expect(k).toMatchObject({ tampilan: 'daftar', sesiId: 'sesi-1' });
  });
});

describe('mesinChat: mulai sesi baru, galat, coba lagi', () => {
  it('mulai membersihkan kedua galat; galat persetujuan lalu Coba lagi berhasil membuka percakapan', () => {
    let k = jalankan([
      { jenis: 'pilihLayanan', layananId: L },
      { jenis: 'galatSetup', pesan: 'offline' },
      { jenis: 'mulai' },
    ]);
    expect(k).toMatchObject({ memulai: true, galat: { setup: '', consent: '' } });
    k = jalankan([{ jenis: 'galatConsent', pesan: 'Persetujuan gagal' }, { jenis: 'selesaiMulai' }], k);
    expect(k).toMatchObject({ memulai: false, tampilan: 'awal', galat: { consent: 'Persetujuan gagal' } });

    k = jalankan(
      [
        { jenis: 'mulai' },
        { jenis: 'sesiDibuat', sesi: { id: 'sesi-1', status: 'bot' }, layananId: L, buka: true },
        { jenis: 'selesaiMulai' },
      ],
      k,
    );
    expect(k).toMatchObject({ tampilan: 'percakapan', sesiId: 'sesi-1', sesiLayananId: L, memulai: false, galat: { consent: '' } });
  });

  it('chatbot nonaktif: sesi baru langsung eskalasi', () => {
    const k = jalankan([{ jenis: 'sesiDibuat', sesi: { id: 's', status: 'eskalasi' }, layananId: L, buka: true }]);
    expect(mode(k)).toBe('menunggu');
  });

  it('centang diubah menghapus galat persetujuan; tanpa galat keadaan tidak berubah', () => {
    const k = kurangiChat(KEADAAN_AWAL_CHAT, { jenis: 'galatConsent', pesan: 'x' });
    expect(kurangiChat(k, { jenis: 'hapusGalatConsent' }).galat.consent).toBe('');
    expect(kurangiChat(KEADAAN_AWAL_CHAT, { jenis: 'hapusGalatConsent' })).toBe(KEADAAN_AWAL_CHAT);
  });

  it('buka percakapan menghapus galat formulir; "percakapan baru" juga, "daftar percakapan" tidak', () => {
    const bergalat = kurangiChat(KEADAAN_AWAL_CHAT, { jenis: 'galatSetup', pesan: 'gagal' });
    expect(kurangiChat(bergalat, { jenis: 'buka', percakapan: percakapan() }).galat.setup).toBe('');
    expect(kurangiChat(bergalat, { jenis: 'tampilkan', tampilan: 'baru', bersihkanGalat: true }).galat.setup).toBe('');
    expect(kurangiChat(bergalat, { jenis: 'tampilkan', tampilan: 'daftar' }).galat.setup).toBe('gagal');
  });
});

describe('mesinChat: indikator mengetik', () => {
  it('kiriman beruntun tidak saling mematikan; tidak pernah negatif', () => {
    let k = jalankan([
      { jenis: 'mengetik', tambah: 1 },
      { jenis: 'mengetik', tambah: 1 },
      { jenis: 'mengetik', tambah: -1 },
    ]);
    expect(k.mengetik).toBe(1);
    k = jalankan([{ jenis: 'mengetik', tambah: -1 }, { jenis: 'mengetik', tambah: -1 }], k);
    expect(k.mengetik).toBe(0);
  });
});
