// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { idDokumenOffline, kunciDokumenOffline, barisDokumenOffline } from './terbit-offline';
import { jumlahHalamanSiapBaca } from '@/lib/investasi/dokumen';

const id = idDokumenOffline(Buffer.from('%PDF-1.7'));
const metadata = { judul: 'Slideshow', kategori: 'Peta Potensi' as const, deskripsi: '', urutan_tampil: 0 };

describe('dokumen PDF offline', () => {
  it('memakai UUID stabil dari isi PDF dan kunci privat seformat render batch', () => {
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(idDokumenOffline(Buffer.from('%PDF-1.7'))).toBe(id);
    expect(idDokumenOffline(Buffer.from('%PDF-1.8'))).not.toBe(id);
    expect(kunciDokumenOffline(id, 164)).toEqual({
      sumber: { path: `src/${id}.pdf`, kunci: `investment-docs/src/${id}.pdf` },
      halaman: Array.from({ length: 164 }, (_, i) => {
        const path = `pages/${id}/${id}/page-${i + 1}.png`;
        return { path, kunci: `investment-docs/${path}` };
      }),
    });
  });

  it.each([0, 1.5, 201])('menolak rencana dengan %s halaman', (jumlah) => {
    expect(() => kunciDokumenOffline(id, jumlah)).toThrow();
  });

  it('menyiapkan 164 halaman lengkap dengan status nonaktif', () => {
    const rencana = kunciDokumenOffline(id, 164);
    const baris = barisDokumenOffline(id, metadata, rencana, rencana.halaman.map(x => x.path));
    expect(baris).toMatchObject({ ...metadata, id, file_path: rencana.sumber.path,
      status: 'nonaktif', halaman_selesai: 164, jumlah_halaman: 164 });
    expect(jumlahHalamanSiapBaca(baris)).toBe(164);
  });

  it('menolak halaman yang hilang, berlebih, duplikat, atau terbalik', () => {
    const rencana = kunciDokumenOffline(id, 2);
    const [a, b] = rencana.halaman.map(x => x.path);
    const berlubang = [a, b];
    delete berlubang[0];
    for (const selesai of [[], [a], [a, b, a], [a, a], [b, a], berlubang]) {
      expect(() => barisDokumenOffline(id, metadata, rencana, selesai)).toThrow(/kelengkapan/i);
    }
  });

  it('menghitung paling banyak 200 halaman berurutan siap baca', () => {
    const halaman_gambar = Array.from({ length: 201 }, (_, i) => `page-${i + 1}.png`);
    expect(jumlahHalamanSiapBaca({ jumlah_halaman: 201, halaman_gambar })).toBe(200);
    halaman_gambar[163] = '';
    expect(jumlahHalamanSiapBaca({ jumlah_halaman: 201, halaman_gambar })).toBe(163);
  });
});
