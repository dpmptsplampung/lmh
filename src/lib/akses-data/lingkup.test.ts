import { describe, expect, it, vi } from 'vitest';
import {
  bolehKoordinatorAmbilAlihFo,
  bolehKoordinatorAmbilAlihTiket,
  labelLingkup,
  lingkupLuas,
  muatKoordinator,
  type LingkupData,
} from './lingkup';

const dasar: LingkupData = { petugas_id: 'p1', role: 'petugas', koordinator: false, layanan_id: 'L1', layanan_nama: 'Helpdesk OSS' };

describe('labelLingkup / lingkupLuas', () => {
  it('membedakan admin, koordinator FO, koordinator layanan, dan akun biasa', () => {
    expect(labelLingkup({ ...dasar, role: 'admin', layanan_id: null })).toMatch(/semua data semua Layanan/i);
    expect(labelLingkup({ ...dasar, role: 'front_office', koordinator: true, layanan_id: null })).toMatch(/Koordinator Front Office/);
    expect(labelLingkup({ ...dasar, koordinator: true })).toBe('Semua data Layanan Helpdesk OSS (Koordinator).');
    expect(labelLingkup(dasar)).toBe('Hanya data yang Anda tangani sendiri.');
    expect(labelLingkup({ ...dasar, role: 'front_office', layanan_id: null })).toBe('Hanya data yang Anda tangani sendiri.');
    expect(lingkupLuas(dasar)).toBe(false);
    expect(lingkupLuas({ ...dasar, koordinator: true })).toBe(true);
  });
});

describe('bolehKoordinatorAmbilAlihTiket', () => {
  const koord = { id: 'k1', role: 'petugas', layanan_id: 'L1', koordinator: true };
  const tiket = { status: 'dilayani', dilayani_oleh: 'p2', layanan_id: 'L1' };
  it('hanya koordinator petugas, layanan sama, tiket dilayani orang lain', () => {
    expect(bolehKoordinatorAmbilAlihTiket(koord, tiket)).toBe(true);
    expect(bolehKoordinatorAmbilAlihTiket({ ...koord, koordinator: false }, tiket)).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket({ ...koord, role: 'front_office' }, tiket)).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket(koord, { ...tiket, layanan_id: 'L2' })).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket(koord, { ...tiket, dilayani_oleh: 'k1' })).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket(koord, { ...tiket, dilayani_oleh: null })).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket(koord, { ...tiket, status: 'selesai' })).toBe(false);
    expect(bolehKoordinatorAmbilAlihTiket(null, tiket)).toBe(false);
  });
});

describe('bolehKoordinatorAmbilAlihFo', () => {
  const koord = { id: 'f1', role: 'front_office', koordinator: true };
  const tahap = { status: 'berjalan', penangan_id: 'f2', saluran: 'walk_in' };
  it('hanya koordinator FO, tahap berjalan milik FO lain, bukan chat', () => {
    expect(bolehKoordinatorAmbilAlihFo(koord, tahap)).toBe(true);
    expect(bolehKoordinatorAmbilAlihFo({ ...koord, koordinator: false }, tahap)).toBe(false);
    expect(bolehKoordinatorAmbilAlihFo(koord, { ...tahap, saluran: 'chat' })).toBe(false);
    expect(bolehKoordinatorAmbilAlihFo(koord, { ...tahap, penangan_id: 'f1' })).toBe(false);
    expect(bolehKoordinatorAmbilAlihFo(koord, { ...tahap, status: 'selesai' })).toBe(false);
  });
});

describe('muatKoordinator', () => {
  function klien(hasil: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(hasil);
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return { from: vi.fn(() => ({ select })), select, eq };
  }
  it('membaca kolom koordinator milik petugas', async () => {
    const k = klien({ data: { koordinator: true }, error: null });
    expect(await muatKoordinator(k as never, 'p1')).toBe(true);
    expect(k.select).toHaveBeenCalledWith('koordinator');
    expect(k.eq).toHaveBeenCalledWith('id', 'p1');
  });
  it('kolom belum ada (migrasi belum diterapkan) atau galat lain = false', async () => {
    expect(await muatKoordinator(klien({ data: null, error: { code: '42703' } }) as never, 'p1')).toBe(false);
    expect(await muatKoordinator(klien({ data: null, error: null }) as never, 'p1')).toBe(false);
  });
});
