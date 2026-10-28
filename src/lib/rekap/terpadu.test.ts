import { describe, expect, it } from 'vitest';
import {
  KOLOM_OSS,
  KOLOM_PENDATAAN_UMUM,
  KOLOM_PERIZINAN,
  kolomDataPelayanan,
  namaUnit,
  petaBarisHarian,
  petaBarisKinerja,
  petaBarisPelayanan,
  rekapTerpaduExportSchema,
  rekapTerpaduQuerySchema,
  petaRingkasanHarian,
  type KolomData,
} from './terpadu';

const mentah = {
  pelayanan_id: 'p1', sumber: 'penanganan', tanggal: '2026-10-20', kunjungan_id: 'k1', tiket_id: 't1',
  nomor_tiket: 'OS-001', unit: 'layanan', layanan_id: 'L1', layanan_nama: 'Helpdesk OSS', kanal: 'tatap_muka',
  penangan_id: 'g1', penangan_nama: 'Budi', fo_nama: 'Sari', hasil: 'selesai', topik: null, catatan: 'Tindak lanjut: x',
  mulai_at: '2026-10-20T02:00:00Z', selesai_at: '2026-10-20T02:30:00Z', pengunjung_nama: 'Andi', pengunjung_hp: '0812',
  pengunjung_email: 'a@b.id', pengunjung_instansi: 'CV A', pengunjung_kategori: 'UMKM', keperluan: 'NIB',
  form_type: 'oss', pendataan: { nama_usaha: 'Toko A', tindak_lanjut: 'Selesai' },
};

describe('rekapTerpaduQuerySchema', () => {
  it('bagian wajib; rentang bawaan 7 hari; page_size maksimal 200', () => {
    expect(rekapTerpaduQuerySchema.safeParse({}).success).toBe(false);
    const ok = rekapTerpaduQuerySchema.parse({ bagian: 'harian' });
    expect(ok.dari <= ok.sampai).toBe(true);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', page_size: '500' }).success).toBe(false);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', page: '10000' }).success).toBe(true);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', page: '10001' }).success).toBe(false);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', page: '99999999999' }).success).toBe(false);
  });
  it('menolak rentang terbalik / lebih dari 366 hari / unit tak dikenal / kunci asing', () => {
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', dari: '2026-10-02', sampai: '2026-10-01' }).success).toBe(false);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', dari: '2025-01-01', sampai: '2026-10-01' }).success).toBe(false);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', unit: 'admin' }).success).toBe(false);
    expect(rekapTerpaduQuerySchema.safeParse({ bagian: 'data', petugas_id: 'x' }).success).toBe(false);
    expect(rekapTerpaduExportSchema.safeParse({ bagian: 'data' }).success).toBe(false);
  });
});

describe('peta baris', () => {
  it('pelayanan: normalisasi tipe dan pendataan', () => {
    const b = petaBarisPelayanan(mentah);
    expect(b.unit).toBe('layanan');
    expect(b.form_type).toBe('oss');
    expect(b.pendataan).toEqual({ nama_usaha: 'Toko A', tindak_lanjut: 'Selesai' });
    expect(petaBarisPelayanan({ ...mentah, form_type: 'lain', pendataan: null, kanal: 'live_chat' })).toMatchObject({
      form_type: null, pendataan: null, kanal: 'live_chat',
    });
  });
  it('harian dan kinerja: bigint/numeric berupa string menjadi angka', () => {
    expect(petaBarisHarian({ tanggal: '2026-10-20', unit: 'fo', tatap_muka: '3', live_chat: 1, jumlah: '4' })).toMatchObject({
      tatap_muka: 3, live_chat: 1, jumlah: 4,
    });
    expect(petaBarisKinerja({ penangan_id: 'g1', unit: 'layanan', jumlah: '2', live_chat: '0', rata_durasi_menit: '12.5' }))
      .toMatchObject({ jumlah: 2, rata_durasi_menit: 12.5 });
    expect(petaBarisKinerja({ penangan_id: 'g1', unit: 'fo', rata_durasi_menit: null }).rata_durasi_menit).toBeNull();
  });
});

describe('namaUnit / ringkasHarian', () => {
  it('Front Office untuk unit fo; nama layanan untuk unit layanan', () => {
    expect(namaUnit({ unit: 'fo', layanan_nama: null })).toBe('Front Office');
    expect(namaUnit({ unit: 'layanan', layanan_nama: 'BPJS' })).toBe('BPJS');
  });
  it('ringkasan dari DB dinormalisasi (numeric/bigint sebagai string)', () => {
    expect(petaRingkasanHarian({ jumlah: '11', tatap_muka: 5, live_chat: '6', per_unit: [{ nama: 'Front Office', jumlah: '6' }] }))
      .toEqual({ jumlah: 11, tatap_muka: 5, live_chat: 6, per_unit: [{ nama: 'Front Office', jumlah: 6 }] });
    expect(petaRingkasanHarian(null)).toEqual({ jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] });
  });
});

describe('kolom Email formulir pendataan (Helpdesk OSS dan Non OSS)', () => {
  const oss = { ...mentah, pendataan: { nama_usaha: 'Toko A', email: 'pemohon@oss.id' } };
  const perizinan = {
    ...mentah, form_type: 'perizinan', layanan_nama: 'Layanan Non OSS',
    pendataan: { nama_perusahaan: 'PT B', email: 'pemohon@nonoss.id' },
  };
  const nilaiDari = (formType: 'oss' | 'perizinan', mentahan: Record<string, unknown>) =>
    Object.fromEntries(kolomDataPelayanan(formType).map((k) => [k.judul, k.ambil(petaBarisPelayanan(mentahan))]));

  it('OSS: kolom "[OSS] Email" terisi dari email formulir, terpisah dari "Email" identitas kunjungan', () => {
    expect(KOLOM_OSS.map((k) => k.judul)).toContain('[OSS] Email');
    const n = nilaiDari('oss', oss);
    expect(n['[OSS] Email']).toBe('pemohon@oss.id');
    expect(n['Email']).toBe('a@b.id');
  });
  it('Non OSS: kolom "[Non OSS] Email" terisi dari email formulir', () => {
    expect(KOLOM_PERIZINAN.map((k) => k.judul)).toContain('[Non OSS] Email');
    expect(nilaiDari('perizinan', perizinan)['[Non OSS] Email']).toBe('pemohon@nonoss.id');
  });
  it('email formulir kosong -> sel kosong (null), bukan "undefined"', () => {
    expect(nilaiDari('oss', { ...oss, pendataan: { nama_usaha: 'Toko A' } })['[OSS] Email']).toBeNull();
  });
});

describe('kolomDataPelayanan', () => {
  it('Pendataan Umum selalu; formulir hanya bila layanan ber-formulir dipilih; tambahan Fase 4 di akhir', () => {
    expect(kolomDataPelayanan(null)).toEqual(KOLOM_PENDATAAN_UMUM);
    expect(kolomDataPelayanan('oss')).toEqual([...KOLOM_PENDATAAN_UMUM, ...KOLOM_OSS]);
    expect(kolomDataPelayanan('perizinan')).toEqual([...KOLOM_PENDATAAN_UMUM, ...KOLOM_PERIZINAN]);
    const ekstra: KolomData = { kunci: 'x', judul: 'X', ambil: () => 'x' };
    expect(kolomDataPelayanan('oss', [ekstra]).at(-1)).toBe(ekstra);
  });
  it('Pendataan Umum memuat identitas, topik, catatan; topik kosong = (tidak tercatat)', () => {
    const judul = KOLOM_PENDATAAN_UMUM.map((k) => k.judul);
    for (const j of ['Nama Pengunjung', 'No HP', 'Email', 'Asal Instansi', 'Kategori', 'Keperluan', 'Topik', 'Catatan Petugas', 'Kanal']) {
      expect(judul).toContain(j);
    }
    const b = petaBarisPelayanan(mentah);
    const nilai = Object.fromEntries(kolomDataPelayanan('oss').map((k) => [k.kunci, k.ambil(b)]));
    expect(nilai.topik).toBe('(tidak tercatat)');
    expect(nilai.tanggal).toBe('20/10/2026');
    expect(nilai.durasi).toBe(30);
    expect(nilai.oss_nama_usaha).toBe('Toko A');
    expect(nilai.oss_kbli).toBeNull();
    expect(nilai.hasil).toBe('Selesai');
  });
});
