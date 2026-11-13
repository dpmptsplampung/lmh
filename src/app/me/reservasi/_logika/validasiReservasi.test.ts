import { describe, expect, it } from 'vitest';
import { addDaysWIB, todayWIB } from '@/lib/time';
import {
  ISIAN_RESERVASI_KOSONG,
  MAKS_HARI_RESERVASI,
  PESAN_VALIDASI_RESERVASI as P,
  akhirPekan,
  batasTanggalReservasi,
  pesanLayananTutup,
  validasiAkhir,
  validasiAwal,
  type IsianReservasi,
} from './validasiReservasi';

const isian = (o: Partial<IsianReservasi> = {}): IsianReservasi => ({ ...ISIAN_RESERVASI_KOSONG, ...o });
const MAKS = '2026-11-20';

describe('batasTanggalReservasi', () => {
  it('min = hari ini WIB, maks = H+7 WIB', () => {
    expect(MAKS_HARI_RESERVASI).toBe(7);
    expect(batasTanggalReservasi()).toEqual({ minDate: todayWIB(), maxDate: addDaysWIB(7) });
  });
});

describe('validasiAwal', () => {
  it('tanpa tujuan: minta tujuan', () => {
    expect(validasiAwal(isian(), MAKS)).toBe(P.tujuan);
  });

  it('loket tanpa layanan: minta layanan', () => {
    expect(validasiAwal(isian({ tujuan: 'loket', tanggal_rencana: '2026-11-18' }), MAKS)).toBe(P.layanan);
  });

  it('bertemu tanpa nama (atau nama hanya spasi): minta nama', () => {
    expect(validasiAwal(isian({ tujuan: 'bertemu_seseorang' }), MAKS)).toBe(P.nama);
    expect(validasiAwal(isian({ tujuan: 'bertemu_seseorang', nama_yang_ditemui: '   ' }), MAKS)).toBe(P.nama);
  });

  it('tanpa tanggal: minta tanggal', () => {
    expect(validasiAwal(isian({ tujuan: 'loket', layanan_id: 'l-1' }), MAKS)).toBe(P.tanggal);
  });

  it('tanggal melewati batas maksimal ditolak, tepat di batas diterima', () => {
    const dasar = { tujuan: 'loket', layanan_id: 'l-1' } as const;
    expect(validasiAwal(isian({ ...dasar, tanggal_rencana: '2026-11-21' }), MAKS)).toBe(P.tanggalMaks);
    expect(validasiAwal(isian({ ...dasar, tanggal_rencana: MAKS }), MAKS)).toBeNull();
  });

  it('urutan: tujuan lebih dulu daripada layanan/nama, layanan/nama lebih dulu daripada tanggal', () => {
    expect(validasiAwal(isian({ tanggal_rencana: '2026-11-30' }), MAKS)).toBe(P.tujuan);
    expect(validasiAwal(isian({ tujuan: 'loket', tanggal_rencana: '2026-11-30' }), MAKS)).toBe(P.layanan);
  });

  it('isian lengkap lolos untuk kedua tujuan', () => {
    expect(validasiAwal(isian({ tujuan: 'loket', layanan_id: 'l-1', tanggal_rencana: '2026-11-18' }), MAKS)).toBeNull();
    expect(
      validasiAwal(isian({ tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'Kepala Bidang', tanggal_rencana: '2026-11-18' }), MAKS),
    ).toBeNull();
  });

  it('layanan terisi tidak dituntut untuk tujuan bertemu; nama tidak dituntut untuk loket', () => {
    expect(
      validasiAwal(isian({ tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'A', layanan_id: '', tanggal_rencana: '2026-11-18' }), MAKS),
    ).toBeNull();
    expect(
      validasiAwal(isian({ tujuan: 'loket', layanan_id: 'l-1', nama_yang_ditemui: '', tanggal_rencana: '2026-11-18' }), MAKS),
    ).toBeNull();
  });
});

describe('akhirPekan', () => {
  it('Sabtu dan Minggu true; Senin–Jumat false (2026-11-13 = Jumat)', () => {
    expect(akhirPekan('2026-11-13')).toBe(false);
    expect(akhirPekan('2026-11-14')).toBe(true);
    expect(akhirPekan('2026-11-15')).toBe(true);
    expect(akhirPekan('2026-11-16')).toBe(false);
  });
});

describe('pesanLayananTutup', () => {
  it('menyebut jadwal terdekat bila diketahui', () => {
    const pesan = pesanLayananTutup('Helpdesk OSS', '2099-01-05');
    expect(pesan).toMatch(/^Helpdesk OSS di kantor DPMPTSP tidak beroperasi pada tanggal itu\. Jadwal terdekat: .+ 5 Januari/);
    expect(pesan).toMatch(/tanya lewat live chat sekarang\?$/);
  });

  it('tanpa jadwal terdekat: arahkan ke live chat', () => {
    expect(pesanLayananTutup('Layanan ini', null)).toBe(
      'Layanan ini tidak beroperasi pada tanggal itu. Silakan tanya lewat live chat untuk jadwal pasti.',
    );
  });
});

describe('validasiAkhir', () => {
  it('persetujuan diperiksa sebelum sesi', () => {
    expect(validasiAkhir(false, null)).toBe(P.persetujuan);
    expect(validasiAkhir(false, 'p-1')).toBe(P.persetujuan);
  });

  it('tanpa pengunjung: minta login ulang; lengkap = null', () => {
    expect(validasiAkhir(true, null)).toBe(P.tanpaSesi);
    expect(validasiAkhir(true, 'p-1')).toBeNull();
  });
});
