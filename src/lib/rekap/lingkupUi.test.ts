import { describe, expect, it } from 'vitest';
import { labelLingkupRekap, lingkupEfektif, lingkupSemuaLayanan, perluPilihanLayanan, type InfoRekap } from './lingkupUi';

const L1 = { id: 'l1', nama: 'Helpdesk OSS', form_pendataan: 'oss' };
const L2 = { id: 'l2', nama: 'BPJS', form_pendataan: null };
const info = (over: Partial<InfoRekap> = {}): InfoRekap => ({
  label: 'Hanya data yang Anda tangani sendiri.', opsi_layanan: [], unit_opsi: ['fo'], ...over,
});

describe('labelLingkupRekap', () => {
  it('Petugas: seluruh Layanannya, tanpa menyebut Koordinator atau "data sendiri"', () => {
    for (const koordinator of [true, false]) {
      const t = labelLingkupRekap(info({ lingkup: { role: 'petugas', layanan_nama: 'Balmon', ...{ koordinator } } as never }));
      expect(t).toBe('Anda melihat seluruh data Layanan Balmon (semua petugas di Layanan ini).');
      expect(t).not.toMatch(/Koordinator|sendiri/);
    }
  });
  it('Front Office semua Layanan (hanya baca), Admin semua Layanan; peran tak dikenal memakai label server', () => {
    expect(labelLingkupRekap(info({ lingkup: { role: 'front_office' } }))).toMatch(/semua Layanan \(Front Office, hanya baca\)/);
    expect(labelLingkupRekap(info({ lingkup: { role: 'admin' } }))).toMatch(/semua Layanan \(Admin\)/);
    expect(labelLingkupRekap(info({ label: 'Label server.' }))).toBe('Label server.');
  });
});

describe('lingkupEfektif', () => {
  it('Front Office tanpa daftar dari server: unit fo+layanan dan Layanan dari referensi', () => {
    const e = lingkupEfektif(info({ lingkup: { role: 'front_office' } }), [L1, L2]);
    expect(e.unit_opsi).toEqual(['fo', 'layanan']);
    expect(e.opsi_layanan).toEqual([L1, L2]);
  });
  it('Front Office: daftar dari server dipertahankan; referensi belum tersedia = tetap unit fo saja', () => {
    expect(lingkupEfektif(info({ lingkup: { role: 'front_office' }, opsi_layanan: [L1], unit_opsi: ['fo', 'layanan'] }), [L1, L2]).opsi_layanan).toEqual([L1]);
    const belum = lingkupEfektif(info({ lingkup: { role: 'front_office' } }), null);
    expect(belum.unit_opsi).toEqual(['fo']);
    expect(belum.opsi_layanan).toEqual([]);
  });
  it('Petugas dan Admin tidak diubah', () => {
    const p = info({ lingkup: { role: 'petugas' }, opsi_layanan: [L1], unit_opsi: ['layanan'] });
    expect(lingkupEfektif(p, [L1, L2])).toBe(p);
    const a = info({ lingkup: { role: 'admin' }, opsi_layanan: [L1, L2], unit_opsi: ['fo', 'layanan'] });
    expect(lingkupEfektif(a, [L1])).toBe(a);
  });
});

describe('pilihan', () => {
  it('perluPilihanLayanan: hanya bila lebih dari satu', () => {
    expect(perluPilihanLayanan([])).toBe(false);
    expect(perluPilihanLayanan([L1])).toBe(false);
    expect(perluPilihanLayanan([L1, L2])).toBe(true);
  });
  it('lingkupSemuaLayanan: Admin dan Front Office', () => {
    expect(lingkupSemuaLayanan('admin')).toBe(true);
    expect(lingkupSemuaLayanan('front_office')).toBe(true);
    expect(lingkupSemuaLayanan('petugas')).toBe(false);
    expect(lingkupSemuaLayanan(undefined)).toBe(false);
  });
});
