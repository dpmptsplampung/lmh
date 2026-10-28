import { describe, expect, it } from 'vitest';
import { kolomKhusus, lampirkanKhusus } from './khusus';
import { kolomDataPelayanan, KOLOM_PENDATAAN_UMUM, type BarisPelayanan } from './terpadu';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';

const f = (o: Partial<FieldKhusus> & Pick<FieldKhusus, 'id' | 'jenis' | 'label'>): FieldKhusus => ({
  layanan_id: 'l', wajib: false, opsi: [], urut: 0, tersembunyi: false, pernah_diisi: false, ...o,
});
const baris = (o: Partial<BarisPelayanan> = {}): BarisPelayanan => ({
  pelayanan_id: 'p1', sumber: 'penanganan', tanggal: '2026-10-20', kunjungan_id: null, tiket_id: null, nomor_tiket: null,
  unit: 'layanan', layanan_id: 'l', layanan_nama: 'BPJS', kanal: 'live_chat', penangan_id: null, penangan_nama: null,
  fo_nama: null, hasil: 'selesai', topik: null, catatan: null, mulai_at: null, selesai_at: null, pengunjung_nama: null,
  pengunjung_hp: null, pengunjung_email: null, pengunjung_instansi: null, pengunjung_kategori: null, keperluan: null,
  form_type: null, pendataan: null, ...o,
});

describe('kolomKhusus', () => {
  it('isian tersembunyi hanya bila pernah diisi; isian tampil selalu; urut menurut urut', () => {
    const kolom = kolomKhusus([
      f({ id: 'c', jenis: 'angka', label: 'C', urut: 2 }),
      f({ id: 'a', jenis: 'angka', label: 'A', urut: 0 }),
      f({ id: 'h1', jenis: 'angka', label: 'Hidden kosong', tersembunyi: true, pernah_diisi: false, urut: 1 }),
      f({ id: 'h2', jenis: 'angka', label: 'Hidden terisi', tersembunyi: true, pernah_diisi: true, urut: 1 }),
    ]);
    expect(kolom.map((k) => k.judul)).toEqual(['[Khusus] A', '[Khusus] Hidden terisi', '[Khusus] C']);
    expect(kolom.map((k) => k.kunci)).toEqual(['khusus_a', 'khusus_h2', 'khusus_c']);
  });

  it('sel memformat per jenis dari baris.khusus; kosong bila tak ada jawaban', () => {
    const fields = [
      f({ id: 'y', jenis: 'ya_tidak', label: 'Puas' }),
      f({ id: 'g', jenis: 'pilihan_ganda', label: 'Dok', opsi: ['A', 'B'] }),
      f({ id: 't', jenis: 'tanggal', label: 'Tgl' }),
    ];
    const [ky, kg, kt] = kolomKhusus(fields);
    const r = baris({ khusus: { y: false, g: ['A', 'B'], t: '2026-10-30' } });
    expect(ky.ambil(r)).toBe('Tidak');
    expect(kg.ambil(r)).toBe('A; B');
    expect(kt.ambil(r)).toBe('30/10/2026');
    expect(ky.ambil(baris())).toBeNull();
  });

  it('ditempel di akhir lewat kolomDataPelayanan(formType, tambahan)', () => {
    const tambahan = kolomKhusus([f({ id: 'a', jenis: 'angka', label: 'A' })]);
    const kolom = kolomDataPelayanan(null, tambahan);
    expect(kolom).toHaveLength(KOLOM_PENDATAAN_UMUM.length + 1);
    expect(kolom[kolom.length - 1].kunci).toBe('khusus_a');
  });
});

describe('lampirkanKhusus', () => {
  it('menempelkan jawaban per pelayanan_id dan tidak mengubah baris tanpa jawaban', () => {
    const rows = [baris({ pelayanan_id: 'p1' }), baris({ pelayanan_id: 'p2' })];
    const hasil = lampirkanKhusus(rows, new Map([['p1', { a: 5 }]]));
    expect(hasil[0].khusus).toEqual({ a: 5 });
    expect(hasil[1]).toBe(rows[1]);
  });
});
