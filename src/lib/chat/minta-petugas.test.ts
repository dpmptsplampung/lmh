import { describe, expect, it } from 'vitest';
import { mintaPetugas } from './minta-petugas';

describe('mintaPetugas', () => {
  it.each([
    'Saya ingin berbicara dengan petugas loket.',
    'hubungkan ke petugas',
    'mau chat sama petugas',
    'bisa bicara dengan operator?',
    'minta cs',
    'petugas',
    'Tolong hubungkan saya ke customer service',
    'saya tidak mau bot, mau bicara dengan manusia',
    'mau tanya langsung ke petugas',
  ])('benar untuk %j', (t) => expect(mintaPetugas(t)).toBe(true));

  it.each([
    'syarat menjadi petugas kebersihan',
    'mau jadi petugas kebersihan',
    'petugas loket buka jam berapa',
    'apa tugas petugas',
    'terima kasih petugas',
    'bagaimana cara mengurus NIB?',
    '',
    '   ',
  ])('salah untuk %j', (t) => expect(mintaPetugas(t)).toBe(false));

  it('mengabaikan teks panjang (bukan permintaan singkat)', () => {
    expect(mintaPetugas(`mau bicara dengan petugas ${'x '.repeat(200)}`)).toBe(false);
  });
});
