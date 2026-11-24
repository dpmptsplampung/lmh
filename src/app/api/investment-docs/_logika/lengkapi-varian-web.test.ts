// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bacaOpsiBackfill, lengkapiVarianWeb } from '../../../../../scripts/lengkapi-varian-web-investasi';
import { ID } from './uji-fixture';
import { pdfTautan } from './uji-pdf-tautan';

const folder = `pages/${ID}/${ID}`;
const prefix = `investment-docs/${folder}`;
const links = `${prefix}/links.json`;
const web1 = `${prefix}/web-1.webp`;
const web2 = `${prefix}/web-2.webp`;
let direktori: string;
let pdf: string;

beforeEach(async () => {
  direktori = await mkdtemp(join(tmpdir(), 'lmh-uji-web-'));
  pdf = join(direktori, 'tautan.pdf');
  await writeFile(pdf, pdfTautan());
});
afterEach(async () => { await rm(direktori, { recursive: true }); });

async function penyimpanan(jumlah = 2) {
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'blue' } }).png().toBuffer();
  const path = Array.from({ length: jumlah }, (_, i) => `${folder}/page-${i + 1}.png`);
  const isi = new Map<string, Buffer>(path.map(kunci => [`investment-docs/${kunci}`, png]));
  const layanan = {
    bacaDokumen: vi.fn(async () => ({ jumlah_halaman: jumlah, halaman_gambar: path })),
    adaObjek: vi.fn(async (key: string) => isi.has(key)),
    bacaObjek: vi.fn(async (key: string) => isi.get(key) ?? null),
    simpanObjek: vi.fn(async (key: string, data: Buffer, _tipe: string, paksa: boolean) => {
      if (!paksa && isi.has(key)) return 'dilewati' as const;
      isi.set(key, data);
      return 'ditulis' as const;
    }),
  };
  return { layanan, isi };
}

describe('backfill varian penampil investasi', () => {
  it('memilih dry-run jika --terapkan absen dan menolak mode yang bertentangan', () => {
    const dasar = ['--doc-id', ID, '--pdf', pdf];
    expect(bacaOpsiBackfill(dasar)).toMatchObject({ id: ID, pdf, terapkan: false, paksa: false });
    expect(bacaOpsiBackfill([...dasar, '--terapkan', '--paksa'])).toMatchObject({ terapkan: true, paksa: true });
    expect(() => bacaOpsiBackfill([...dasar, '--terapkan', '--dry-run'])).toThrow();
  });

  it('dry-run melaporkan aset baru dan aset yang dilewati tanpa mengambil PNG atau menulis R2', async () => {
    const { layanan, isi } = await penyimpanan();
    isi.set(web1, Buffer.from('varian lama'));
    const hasil = await lengkapiVarianWeb(bacaOpsiBackfill(['--doc-id', ID, '--pdf', pdf]), layanan);
    expect(hasil).toMatchObject({ mode: 'dry-run', halaman: { rencana: 1, ditulis: 0, dilewati: 1 }, tautan: { status: 'rencana', jumlah: 3 } });
    expect(layanan.bacaObjek).not.toHaveBeenCalled();
    expect(layanan.simpanObjek).not.toHaveBeenCalled();
  });

  it('membuat aset dari PNG dan PDF lokal, melewati yang sudah ada, serta menimpanya hanya dengan --paksa', async () => {
    const { layanan, isi } = await penyimpanan();
    const opsi = { id: ID, pdf, terapkan: true, paksa: false };
    expect(await lengkapiVarianWeb(opsi, layanan)).toMatchObject({
      halaman: { ditulis: 2, dilewati: 0, gagal: [] }, tautan: { status: 'ditulis', jumlah: 3 },
    });
    expect(await sharp(isi.get(web1)!).metadata()).toMatchObject({ format: 'webp', width: 12, height: 8 });
    expect(await sharp(isi.get(web2)!).metadata()).toMatchObject({ format: 'webp', width: 12, height: 8 });
    expect(JSON.parse(isi.get(links)!.toString()).tautan).toHaveLength(3);
    expect(layanan.simpanObjek).toHaveBeenCalledWith(links, expect.any(Buffer), 'application/json', false);
    expect(layanan.bacaObjek.mock.calls.map(([key]) => key).sort()).toEqual([
      `${prefix}/page-1.png`, `${prefix}/page-2.png`,
    ]);

    layanan.bacaObjek.mockClear();
    layanan.simpanObjek.mockClear();
    expect(await lengkapiVarianWeb(opsi, layanan)).toMatchObject({
      halaman: { ditulis: 0, dilewati: 2 }, tautan: { status: 'dilewati' },
    });
    expect(layanan.bacaObjek).not.toHaveBeenCalled();
    expect(layanan.simpanObjek).not.toHaveBeenCalled();
    expect(await lengkapiVarianWeb({ ...opsi, paksa: true }, layanan)).toMatchObject({
      halaman: { ditulis: 2, dilewati: 0 }, tautan: { status: 'ditulis' },
    });
    expect(layanan.simpanObjek.mock.calls.every(([, , , paksa]) => paksa)).toBe(true);
  });

  it('mencatat halaman gagal dan menahan tautan sampai aset halaman selesai', async () => {
    const { layanan, isi } = await penyimpanan();
    isi.delete(`${prefix}/page-1.png`);
    const hasil = await lengkapiVarianWeb({ id: ID, pdf, terapkan: true, paksa: false }, layanan);
    expect(hasil).toMatchObject({ halaman: { ditulis: 1, gagal: [1] }, tautan: { status: 'tertunda' } });
    expect(isi.has(links)).toBe(false);
  });

  it('menolak PDF yang jumlah halamannya berbeda sebelum mengubah aset', async () => {
    const { layanan } = await penyimpanan(3);
    await expect(lengkapiVarianWeb({ id: ID, pdf, terapkan: true, paksa: false }, layanan)).rejects.toThrow(/jumlah halaman/i);
    expect(layanan.simpanObjek).not.toHaveBeenCalled();
  });

  it('membatasi pekerjaan bersamaan menjadi tiga halaman', async () => {
    const { layanan, isi } = await penyimpanan(7);
    isi.set(links, Buffer.from('{}'));
    const baca = layanan.bacaObjek.getMockImplementation()!;
    let aktif = 0;
    let puncak = 0;
    layanan.bacaObjek.mockImplementation(async key => {
      puncak = Math.max(puncak, ++aktif);
      await new Promise(resolve => setImmediate(resolve));
      aktif--;
      return baca(key);
    });
    const hasil = await lengkapiVarianWeb({ id: ID, pdf, terapkan: true, paksa: false }, layanan);
    expect(hasil.halaman.ditulis).toBe(7);
    expect(puncak).toBe(3);
  });
});
