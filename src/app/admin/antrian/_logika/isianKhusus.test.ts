import { describe, it, expect } from 'vitest';
import { layananPerluCekIsian } from './isianKhusus';
import { ADMIN, FO, PETUGAS, buatTiket } from '../_uji/tiketUji';

const tanpaForm = { nama: 'BPJS', form_pendataan: null };
const milik = (over = {}) => buatTiket({
  status: 'dilayani', dilayani_oleh: PETUGAS.id, layanan_id: 'l-b', layanan: tanpaForm, ...over,
});

describe('layananPerluCekIsian', () => {
  it('hanya Layanan tiket milik pengguna yang sedang dilayani dan tanpa formulir tetap', () => {
    expect(layananPerluCekIsian([[milik()]], PETUGAS)).toEqual(['l-b']);
  });

  it('tiket layanan berformulir tetap (OSS) tidak dicek: punya wizard formulir sendiri', () => {
    expect(layananPerluCekIsian([[buatTiket({ status: 'dilayani', dilayani_oleh: PETUGAS.id })]], PETUGAS)).toEqual([]);
  });

  it('tiket orang lain, menunggu, dan selesai diabaikan; FO tanpa tiket milik tidak memicu apa pun', () => {
    const daftar = [milik({ dilayani_oleh: 'p-lain' }), milik({ id: 't-2', status: 'menunggu', dilayani_oleh: null }),
      milik({ id: 't-3', status: 'selesai' })];
    expect(layananPerluCekIsian([daftar], PETUGAS)).toEqual([]);
    expect(layananPerluCekIsian([[milik()]], FO)).toEqual([]);
    expect(layananPerluCekIsian([[milik()]], null)).toEqual([]);
  });

  it('digabung dari beberapa sumber, unik dan terurut; Admin pemilik tiket ikut', () => {
    const a = milik({ id: 't-a', layanan_id: 'l-z', dilayani_oleh: ADMIN.id });
    const b = milik({ id: 't-b', layanan_id: 'l-a', dilayani_oleh: ADMIN.id });
    const c = milik({ id: 't-c', layanan_id: 'l-a', dilayani_oleh: ADMIN.id });
    expect(layananPerluCekIsian([[a, b], [c]], ADMIN)).toEqual(['l-a', 'l-z']);
  });
});
