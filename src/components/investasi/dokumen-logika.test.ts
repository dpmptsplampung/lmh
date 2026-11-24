import { describe, expect, it } from 'vitest';
import { kelompokkanTautan, tetanggaPrefetch, uraiBerkasTautan } from './dokumen-logika';

const kotak = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

describe('uraiBerkasTautan', () => {
  it('berkas valid diambil daftarnya; bentuk salah atau versi lain = kosong', () => {
    expect(uraiBerkasTautan({ versi: 1, tautan: [{ hal: 1, ...kotak, ke: 2 }] })).toHaveLength(1);
    expect(uraiBerkasTautan({ versi: 2, tautan: [] })).toEqual([]);
    expect(uraiBerkasTautan({ versi: 1, tautan: [{ hal: 0, ...kotak }] })).toEqual([]);
    expect(uraiBerkasTautan(null)).toEqual([]);
    expect(uraiBerkasTautan('x')).toEqual([]);
  });
});

describe('kelompokkanTautan', () => {
  it('mengelompokkan per halaman, internal vs luar, host dari URL', () => {
    const peta = kelompokkanTautan(
      [
        { hal: 1, ...kotak, ke: 5 },
        { hal: 1, ...kotak, url: 'https://contoh.go.id/a?b=1' },
        { hal: 3, ...kotak, ke: 1 },
      ],
      10,
    );
    expect(peta.get(1)?.map(t => t.jenis)).toEqual(['internal', 'luar']);
    expect(peta.get(1)?.[1]).toMatchObject({ jenis: 'luar', host: 'contoh.go.id' });
    expect(peta.get(3)).toHaveLength(1);
    expect(peta.get(2)).toBeUndefined();
  });

  it('membuang skema berbahaya, tujuan di luar rentang, tautan ke slide sendiri, halaman di luar rentang, dan tautan kosong', () => {
    const peta = kelompokkanTautan(
      [
        { hal: 1, ...kotak, url: 'javascript:alert(1)' },
        { hal: 1, ...kotak, url: 'data:text/html,hai' },
        { hal: 1, ...kotak, ke: 99 },
        { hal: 1, ...kotak, ke: 1 },
        { hal: 1, ...kotak },
        { hal: 11, ...kotak, ke: 2 },
      ],
      10,
    );
    expect(peta.size).toBe(0);
  });

  it('kotak dijepit agar tidak keluar dari gambar; ke menang atas url', () => {
    const peta = kelompokkanTautan([{ hal: 1, x: 0.9, y: 0.95, w: 0.5, h: 0.5, ke: 2, url: 'https://contoh.go.id' }], 3);
    const t = peta.get(1)?.[0];
    expect(t?.jenis).toBe('internal');
    expect(t?.w).toBeCloseTo(0.1);
    expect(t?.h).toBeCloseTo(0.05);
  });
});

describe('tetanggaPrefetch', () => {
  it('hanya satu ke depan lalu satu ke belakang, dijepit ke rentang', () => {
    expect(tetanggaPrefetch(5, 10)).toEqual([6, 4]);
    expect(tetanggaPrefetch(1, 10)).toEqual([2]);
    expect(tetanggaPrefetch(10, 10)).toEqual([9]);
    expect(tetanggaPrefetch(1, 1)).toEqual([]);
  });
});
