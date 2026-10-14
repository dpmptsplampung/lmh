import { describe, expect, it, vi } from 'vitest';
import { cariPengunjungLama, muatAsalSering, varianHp } from './pengunjung-lama';

/** Rantai query supabase-js tiruan; `hasil` dikembalikan di akhir rantai (await). */
type Kendali = ReturnType<typeof buatRantai>;

function klien(hasil: unknown | ((tabel: string, rantai: Kendali) => unknown)) {
  const panggilan: Kendali[] = [];
  const from = vi.fn((tabel: string) => {
    const r = buatRantai();
    panggilan.push(r);
    r.hasil = typeof hasil === 'function' ? () => (hasil as (t: string, k: Kendali) => unknown)(tabel, r) : () => hasil;
    return r.rantai;
  });
  return { from, panggilan };
}

function buatRantai() {
  const kendali = {
    hasil: (() => ({ data: [], error: null })) as () => unknown,
    dipanggil: [] as Array<[string, unknown[]]>,
    rantai: {} as Record<string, unknown>,
  };
  const metode = ['select', 'in', 'eq', 'not', 'order', 'limit'];
  for (const m of metode) {
    kendali.rantai[m] = (...args: unknown[]) => {
      kendali.dipanggil.push([m, args]);
      return kendali.rantai;
    };
  }
  kendali.rantai.then = (ok: (v: unknown) => unknown, tolak: (e: unknown) => unknown) => {
    try {
      return Promise.resolve(kendali.hasil()).then(ok, tolak);
    } catch (e) {
      return Promise.reject(e).then(ok, tolak);
    }
  };
  return kendali;
}

const baris = {
  nama: 'Budi Santoso',
  asal_instansi: 'PT Maju',
  kategori: 'UMKM',
  email: 'budi@gmail.com',
  kontak_hp: '081234567890',
  tanggal: '2026-10-01',
};

describe('varianHp', () => {
  it('mencakup 08, 62, dan +62', () => {
    expect(varianHp('081234567890')).toEqual(['081234567890', '6281234567890', '+6281234567890']);
  });
});

describe('cariPengunjungLama', () => {
  it('mencari kunjungan terakhir lewat HP (semua varian) dan memetakan hasil', async () => {
    const c = klien({ data: [baris], error: null });
    const h = await cariPengunjungLama(c as never, { hp: '081234567890', email: null });
    expect(h).toEqual(baris);
    expect(c.from).toHaveBeenCalledWith('kunjungan');
    const dipanggil = c.panggilan[0].dipanggil;
    expect(dipanggil).toContainEqual(['in', ['kontak_hp', ['081234567890', '6281234567890', '+6281234567890']]]);
    expect(dipanggil).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(dipanggil).toContainEqual(['limit', [1]]);
    // kolom minimal, tanpa kolom sensitif lain
    expect(dipanggil[0]).toEqual(['select', ['nama, asal_instansi, kategori, email, kontak_hp, tanggal']]);
  });

  it('HP tak ketemu -> mencoba email', async () => {
    const c = klien((_t: string, r: Kendali) => {
      const memakaiEmail = r.dipanggil.some(([m]) => m === 'eq');
      return memakaiEmail ? { data: [baris], error: null } : { data: [], error: null };
    });
    const h = await cariPengunjungLama(c as never, { hp: '081234567890', email: 'budi@gmail.com' });
    expect(h?.nama).toBe('Budi Santoso');
    expect(c.from).toHaveBeenCalledTimes(2);
    expect(c.panggilan[1].dipanggil).toContainEqual(['eq', ['email', 'budi@gmail.com']]);
  });

  it('kategori tak dikenal dikosongkan; baris tanpa nama/asal diabaikan', async () => {
    const c1 = klien({ data: [{ ...baris, kategori: 'Aneh' }], error: null });
    expect((await cariPengunjungLama(c1 as never, { hp: '081234567890' }))?.kategori).toBe('');
    const c2 = klien({ data: [{ ...baris, asal_instansi: null }], error: null });
    expect(await cariPengunjungLama(c2 as never, { hp: '081234567890' })).toBeNull();
  });

  it('galat query atau exception -> null tanpa melempar', async () => {
    const c1 = klien({ data: null, error: { message: 'x' } });
    expect(await cariPengunjungLama(c1 as never, { hp: '081234567890' })).toBeNull();
    const c2 = klien(() => {
      throw new Error('jaringan');
    });
    expect(await cariPengunjungLama(c2 as never, { hp: '081234567890', email: 'a@b.id' })).toBeNull();
  });

  it('tanpa HP dan email -> tidak query', async () => {
    const c = klien({ data: [baris], error: null });
    expect(await cariPengunjungLama(c as never, {})).toBeNull();
    expect(c.from).not.toHaveBeenCalled();
  });
});

describe('muatAsalSering', () => {
  it('unik tanpa membedakan huruf besar/kecil, urutan terbaru dulu, dibatasi', async () => {
    const data = [
      { asal_instansi: 'PT Maju' },
      { asal_instansi: 'pt maju' },
      { asal_instansi: ' Dinas Kominfo ' },
      { asal_instansi: 'ab' },
      { asal_instansi: null },
      { asal_instansi: 'CV Sentosa' },
    ];
    const c = klien({ data, error: null });
    expect(await muatAsalSering(c as never, 50)).toEqual(['PT Maju', 'Dinas Kominfo', 'CV Sentosa']);
    expect(await muatAsalSering(klien({ data, error: null }) as never, 2)).toEqual(['PT Maju', 'Dinas Kominfo']);
  });

  it('galat -> daftar kosong', async () => {
    expect(await muatAsalSering(klien({ data: null, error: { message: 'x' } }) as never)).toEqual([]);
    expect(
      await muatAsalSering(
        klien(() => {
          throw new Error('x');
        }) as never,
      ),
    ).toEqual([]);
  });
});
