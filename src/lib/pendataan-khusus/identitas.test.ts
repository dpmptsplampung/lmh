import { describe, expect, it } from 'vitest';
import { identitasBerubah, validasiIdentitas, validasiIdentitasBerubah, type IdentitasForm } from './identitas';

const kosong: IdentitasForm = { nama: '', kontak_hp: '', email: '', asal_instansi: '', kategori: '', keperluan: '' };

describe('validasiIdentitas (sama dengan pendataan_identitas_validasi DB)', () => {
  it('kosong semua = sah (tidak ada yang diubah)', () => {
    expect(validasiIdentitas(kosong)).toEqual({});
  });
  it('nama: 3-100, huruf/spasi/titik/koma/apostrof/hubung, tanpa angka', () => {
    expect(validasiIdentitas({ ...kosong, nama: "Siti N. O'Neil-Sari" })).toEqual({});
    expect(validasiIdentitas({ ...kosong, nama: 'Bu' }).nama).toBeDefined();
    expect(validasiIdentitas({ ...kosong, nama: 'Budi 123' }).nama).toBeDefined();
  });
  it('HP: 08xxxxxxxxxx (10-13 digit), +62/62 diterima', () => {
    expect(validasiIdentitas({ ...kosong, kontak_hp: '0812 3456 7890' })).toEqual({});
    expect(validasiIdentitas({ ...kosong, kontak_hp: '+62 812 3456 7890' })).toEqual({});
    expect(validasiIdentitas({ ...kosong, kontak_hp: '12345' }).kontak_hp).toBeDefined();
  });
  it('email, instansi, kategori, keperluan', () => {
    expect(validasiIdentitas({ ...kosong, email: 'a@b.id' })).toEqual({});
    expect(validasiIdentitas({ ...kosong, email: 'salah' }).email).toBeDefined();
    expect(validasiIdentitas({ ...kosong, asal_instansi: 'PT' }).asal_instansi).toBeDefined();
    expect(validasiIdentitas({ ...kosong, kategori: 'Lain' }).kategori).toBeDefined();
    expect(validasiIdentitas({ ...kosong, kategori: 'UMKM' })).toEqual({});
    expect(validasiIdentitas({ ...kosong, keperluan: 'singkat' }).keperluan).toBeDefined();
    expect(validasiIdentitas({ ...kosong, keperluan: 'Mengurus NIB untuk usaha baru' })).toEqual({});
  });
});

describe('identitasBerubah', () => {
  it('hanya nilai terisi yang berbeda dari awal (di-trim); kosong tidak mengubah', () => {
    const awal = { ...kosong, nama: 'Budi Santoso', email: 'lama@x.id' };
    expect(identitasBerubah(awal, { ...awal, email: ' baru@x.id ', asal_instansi: 'CV Maju', nama: '' })).toEqual({
      email: 'baru@x.id', asal_instansi: 'CV Maju',
    });
    expect(identitasBerubah(awal, awal)).toEqual({});
  });
});

describe('validasiIdentitasBerubah (hanya kolom yang diubah petugas)', () => {
  const profil: IdentitasForm = {
    nama: 'Budi 😀 Santoso 2', kontak_hp: '12345', email: 'lama', asal_instansi: 'X', kategori: 'Lain-lain', keperluan: 'singkat',
  };
  it('data profil lama yang tidak valid TIDAK memblokir bila tidak diubah', () => {
    expect(validasiIdentitasBerubah(profil, { ...profil })).toEqual({});
    expect(validasiIdentitasBerubah(profil, { ...profil, email: 'baru@x.id' })).toEqual({});
  });
  it('kolom yang diubah tetap divalidasi (keperluan lama pendek lalu diganti pendek lagi = galat)', () => {
    expect(validasiIdentitasBerubah(profil, { ...profil, keperluan: 'pendek' }).keperluan).toBeDefined();
    expect(validasiIdentitasBerubah(profil, { ...profil, keperluan: 'Mengurus NIB untuk usaha baru' })).toEqual({});
    expect(validasiIdentitasBerubah(profil, { ...profil, email: 'salah' }).email).toBeDefined();
  });
});
