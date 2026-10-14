// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPhoneValid, profilLengkap, validasiProfil } from './profil-pengunjung';

const LENGKAP = {
  nama: 'Budi Santoso',
  no_hp: '081234567890',
  asal_instansi: 'Universitas Lampung',
  kategori: 'Umum',
  email: 'budi@example.com',
};

describe('validasiProfil: semua field wajib', () => {
  it('menerima profil lengkap dan memangkas spasi', () => {
    const h = validasiProfil({ ...LENGKAP, nama: '  Budi Santoso  ' });
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.data.nama).toBe('Budi Santoso');
  });

  it.each([
    ['nama', '  ', /Nama Lengkap/],
    ['nama', 'Bu', /Nama Lengkap/],
    ['no_hp', '', /Nomor HP/],
    ['no_hp', '12345', /Nomor HP/],
    ['asal_instansi', '   ', /Asal/],
    ['kategori', '', /Kategori/],
    ['kategori', 'akademisi', /Kategori/],
    ['email', '', /Email/],
    ['email', 'bukan-email', /email/i],
  ])('menolak %s = %j', (kolom, nilai, pesan) => {
    const h = validasiProfil({ ...LENGKAP, [kolom]: nilai });
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.pesan).toMatch(pesan);
  });

  it('menolak undefined/null pada field mana pun', () => {
    expect(validasiProfil({ ...LENGKAP, email: null }).ok).toBe(false);
    expect(validasiProfil({ ...LENGKAP, kategori: undefined }).ok).toBe(false);
  });
});

describe('profilLengkap', () => {
  it('true hanya bila seluruh field terisi benar', () => {
    expect(profilLengkap(LENGKAP)).toBe(true);
    expect(profilLengkap({ ...LENGKAP, email: null })).toBe(false);
    expect(profilLengkap({ ...LENGKAP, no_hp: '0217654321' })).toBe(false);
    expect(profilLengkap({ ...LENGKAP, asal_instansi: '' })).toBe(false);
    expect(profilLengkap(null)).toBe(false);
  });

  it('isPhoneValid tetap seperti sebelumnya', () => {
    expect(isPhoneValid('+6281234567890')).toBe(true);
    expect(isPhoneValid('081234567')).toBe(false);
  });
});
