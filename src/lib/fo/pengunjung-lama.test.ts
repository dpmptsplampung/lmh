import { describe, expect, it, vi } from 'vitest';
import { muatAsalSering } from './pengunjung-lama';

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
