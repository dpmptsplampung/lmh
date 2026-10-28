import { describe, expect, it } from 'vitest';
import {
  DEFINISI_BLOK,
  JENIS_BLOK,
  blokTampil,
  gabungkanBlok,
  judulLayanan,
  linkAman,
  type BarisBlok,
} from './blok';

const baris = (jenis: string, aktif: boolean, urutan: number, teks: Record<string, unknown> = {}): BarisBlok => ({
  jenis, aktif, urutan, teks,
});

describe('gabungkanBlok', () => {
  it('tanpa baris (migrasi belum diterapkan) memakai bawaan: semua nyala kecuali papan_kinerja', () => {
    const blok = gabungkanBlok(null);
    expect(blok.map((b) => b.jenis)).toEqual([
      'hero', 'jalur_cepat', 'status_hari_ini', 'layanan', 'papan_kinerja', 'ajakan', 'footer',
    ]);
    expect(blok.find((b) => b.jenis === 'papan_kinerja')?.aktif).toBe(false);
    expect(blokTampil(blok).map((b) => b.jenis)).not.toContain('papan_kinerja');
    expect(blokTampil(blok)).toHaveLength(6);
  });

  it('blok yang dimatikan tidak muncul di blokTampil dan tidak jatuh ke teks cadangan', () => {
    const blok = gabungkanBlok([baris('hero', false, 10, { description: 'Teks hero kustom' })]);
    const tampil = blokTampil(blok);
    expect(tampil.map((b) => b.jenis)).not.toContain('hero');
    expect(tampil.some((b) => Object.values(b.teks).includes(DEFINISI_BLOK.hero.bawaan.description))).toBe(false);
  });

  it('baris untuk jenis yang hilang memakai bawaan jenis itu', () => {
    const blok = gabungkanBlok([baris('hero', true, 10)]);
    expect(blok).toHaveLength(JENIS_BLOK.length);
    expect(blok.find((b) => b.jenis === 'ajakan')?.aktif).toBe(true);
  });

  it('menghormati urutan kustom; footer selalu terakhir', () => {
    const blok = gabungkanBlok([
      baris('footer', true, 1),
      baris('layanan', true, 5),
      baris('hero', true, 90),
    ]);
    const urut = blok.map((b) => b.jenis);
    expect(urut.indexOf('layanan')).toBeLessThan(urut.indexOf('hero'));
    expect(urut[urut.length - 1]).toBe('footer');
  });

  it('teks kosong atau spasi memakai bawaan; teks kustom dipakai (dipangkas)', () => {
    const blok = gabungkanBlok([baris('ajakan', true, 60, { title: '  Datang ya  ', description: '   ', button_text: null })]);
    const ajakan = blok.find((b) => b.jenis === 'ajakan')!;
    expect(ajakan.teks.title).toBe('Datang ya');
    expect(ajakan.teks.description).toBe(DEFINISI_BLOK.ajakan.bawaan.description);
    expect(ajakan.teks.button_text).toBe(DEFINISI_BLOK.ajakan.bawaan.button_text);
  });

  it('teks non-string diabaikan; tautan berbahaya diganti bawaan', () => {
    const blok = gabungkanBlok([
      baris('ajakan', true, 60, { title: 42, button_link: 'javascript:alert(1)' }),
      baris('hero', true, 10, { cta_secondary_link: 'wa', cta_primary_link: 'https://contoh.go.id/x' }),
    ]);
    const ajakan = blok.find((b) => b.jenis === 'ajakan')!;
    expect(ajakan.teks.title).toBe(DEFINISI_BLOK.ajakan.bawaan.title);
    expect(ajakan.teks.button_link).toBe(DEFINISI_BLOK.ajakan.bawaan.button_link);
    const hero = blok.find((b) => b.jenis === 'hero')!;
    expect(hero.teks.cta_secondary_link).toBe('wa');
    expect(hero.teks.cta_primary_link).toBe('https://contoh.go.id/x');
  });

  it('jenis tak dikenal diabaikan; papan_kinerja punya teks bawaan kosong', () => {
    const blok = gabungkanBlok([baris('rahasia', true, 1)]);
    expect(blok.map((b) => b.jenis)).not.toContain('rahasia' as never);
    expect(DEFINISI_BLOK.papan_kinerja.bawaan).toEqual({ title: '', description: '' });
    expect(DEFINISI_BLOK.papan_kinerja.aktifBawaan).toBe(false);
  });
});

describe('judulLayanan', () => {
  it('mengganti {jumlah} dengan jumlah kartu', () => {
    expect(judulLayanan('{jumlah} Layanan dalam Satu Atap', 9)).toBe('9 Layanan dalam Satu Atap');
  });
  it('tanpa penampung tetap apa adanya (admin sengaja tanpa angka)', () => {
    expect(judulLayanan('Layanan Kami', 9)).toBe('Layanan Kami');
  });
  it('mengganti semua kemunculan', () => {
    expect(judulLayanan('{jumlah} dari {jumlah}', 3)).toBe('3 dari 3');
  });
});

describe('linkAman', () => {
  it('menerima path internal dan https', () => {
    expect(linkAman('/me/reservasi', '/x')).toBe('/me/reservasi');
    expect(linkAman('https://oss.go.id', '/x')).toBe('https://oss.go.id');
  });
  it('menolak skema lain, protokol-relatif, dan spasi', () => {
    for (const buruk of ['javascript:alert(1)', 'http://x.id', '//evil.com', 'mailto:a@b.c', '/a b', '', '  ', '/\\evil.com', '/a\\b', 'https://a.id\\x', '\\\\evil.com']) {
      expect(linkAman(buruk, '/x')).toBe('/x');
    }
  });
  it('"wa" hanya bila diizinkan', () => {
    expect(linkAman('wa', '/x')).toBe('/x');
    expect(linkAman('wa', '/x', { izinkanWa: true })).toBe('wa');
  });
});
