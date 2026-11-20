import { expect, it } from 'vitest';
import { KAB_KOTA_IPRO, MATA_UANG, SEKTOR_IPRO, SKEMA_IPRO, STATUS_IPRO, STATUS_LAHAN, STATUS_MINAT, TAHAP_KAJIAN } from './konstanta';
it('menyediakan nilai yang sesuai CHECK P1 dan label dua bahasa', () => {
  expect(SEKTOR_IPRO.map(s => s.nilai)).toEqual(['pertanian', 'perikanan', 'pariwisata', 'industri', 'energi', 'infrastruktur', 'kawasan', 'jasa', 'lainnya']);
  expect(STATUS_IPRO).toEqual(['draf', 'terbit', 'arsip']);
  expect(STATUS_MINAT).toEqual(['baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai']);
  expect(MATA_UANG).toEqual(['IDR', 'USD']);
  expect(KAB_KOTA_IPRO).toContain('Lintas Kabupaten/Kota');
  for (const opsi of [...SEKTOR_IPRO, ...SKEMA_IPRO, ...STATUS_LAHAN, ...TAHAP_KAJIAN]) {
    expect(opsi.id.length).toBeGreaterThan(0); expect(opsi.en.length).toBeGreaterThan(0);
  }
});
