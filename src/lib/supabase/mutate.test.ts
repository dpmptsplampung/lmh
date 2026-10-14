// Uji helper mutasi Supabase yang selalu dicek (audit T2: toast sukses palsu).
// supabase-js tidak melempar; penolakan RLS pada UPDATE/DELETE = 0 baris tanpa error.
import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { MutasiError, mutasiBolehKosong, mutasiInsert, mutasiWajibBaris, pesanMutasi } from './mutate';

// Hasil query palsu berbentuk `{ data, error, status }` seperti builder supabase-js.
function hasil<T>(data: T, error: { message: string; code?: string } | null = null, status?: number) {
  return Promise.resolve({ data, error, status });
}

const ERR_JARINGAN = { message: 'TypeError: Failed to fetch', code: '' };
const ERR_RLS = {
  message: 'new row violates row-level security policy for table "faq_knowledge_base"',
  code: '42501',
};
const ERR_UMUM = { message: 'duplicate key value violates unique constraint', code: '23505' };

// Menangkap error yang dilempar helper agar kodenya bisa diperiksa.
async function tangkap(p: Promise<unknown>): Promise<MutasiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MutasiError);
    return e as MutasiError;
  }
  throw new Error('helper seharusnya melempar MutasiError');
}

describe('MutasiError', () => {
  it('turunan Error sekaligus MutasiError', () => {
    const e = new MutasiError('database');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(MutasiError);
    expect(e.name).toBe('MutasiError');
  });

  it('membawa kode, pesan Indonesia siap tampil, dan error asal', () => {
    const asal = { message: 'x', code: '42501' };
    const e = new MutasiError('ditolak', { asal });
    expect(e.kode).toBe('ditolak');
    expect(e.pesan).toMatch(/tidak berwenang/i);
    expect(e.message).toBe(e.pesan);
    expect(e.asal).toBe(asal);
  });

  it('setiap kode punya pesan default yang tidak kosong dan berbeda', () => {
    const kode = ['jaringan', 'ditolak', 'tidak_ada_baris', 'database'] as const;
    const pesan = kode.map((k) => new MutasiError(k).pesan);
    pesan.forEach((p) => expect(p.length).toBeGreaterThan(0));
    expect(new Set(pesan).size).toBe(kode.length);
  });

  it('pesan khusus menimpa pesan default', () => {
    expect(new MutasiError('database', { pesan: 'Gagal menyimpan FAQ' }).pesan).toBe('Gagal menyimpan FAQ');
  });
});

describe('mutasiWajibBaris (UPDATE/DELETE)', () => {
  it('mengembalikan array baris bila ada baris terdampak', async () => {
    await expect(mutasiWajibBaris(hasil([{ id: 'a' }, { id: 'b' }]))).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('menormalkan data objek tunggal (.single()/.maybeSingle()) menjadi array', async () => {
    await expect(mutasiWajibBaris(hasil({ id: 'a' }))).resolves.toEqual([{ id: 'a' }]);
  });

  it('0 baris tanpa error (RLS menolak diam-diam) -> tidak_ada_baris', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil([])));
    expect(e.kode).toBe('tidak_ada_baris');
    expect(e.pesan).toBe('Anda tidak berwenang mengubah data ini atau data sudah tidak ada');
  });

  it('data null tanpa error (mis. .maybeSingle() tanpa baris) -> tidak_ada_baris', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null)));
    expect(e.kode).toBe('tidak_ada_baris');
  });

  it('error jaringan -> jaringan, membawa error asal', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null, ERR_JARINGAN)));
    expect(e.kode).toBe('jaringan');
    expect(e.asal).toBe(ERR_JARINGAN);
  });

  it('status respons 0 (fetch gagal) -> jaringan walau pesan tidak dikenali', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null, { message: 'AbortError: aaa', code: '' }, 0)));
    expect(e.kode).toBe('jaringan');
  });

  it('pesan jaringan beragam diklasifikasikan jaringan', async () => {
    for (const message of ['NetworkError when attempting to fetch resource', 'fetch failed', 'Load failed', 'request timeout']) {
      const e = await tangkap(mutasiWajibBaris(hasil(null, { message })));
      expect(e.kode, message).toBe('jaringan');
    }
  });

  it('kode 42501 -> ditolak', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null, ERR_RLS)));
    expect(e.kode).toBe('ditolak');
    expect(e.asal).toBe(ERR_RLS);
  });

  it('pesan "permission denied" tanpa kode -> ditolak', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null, { message: 'permission denied for table layanan' })));
    expect(e.kode).toBe('ditolak');
  });

  it('error umum -> database', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil(null, ERR_UMUM)));
    expect(e.kode).toBe('database');
    expect(e.asal).toBe(ERR_UMUM);
  });

  it('statement timeout dari Postgres (ada kode) -> database, bukan jaringan', async () => {
    const e = await tangkap(
      mutasiWajibBaris(hasil(null, { message: 'canceling statement due to statement timeout', code: '57014' })),
    );
    expect(e.kode).toBe('database');
  });

  it('error didahulukan atas pemeriksaan baris (data kosong + error -> kode error, bukan tidak_ada_baris)', async () => {
    const e = await tangkap(mutasiWajibBaris(hasil([], ERR_RLS)));
    expect(e.kode).toBe('ditolak');
  });

  it('promise menolak (throw dari builder) -> jaringan, error asal terbawa', async () => {
    const alasan = new TypeError('Failed to fetch');
    const e = await tangkap(mutasiWajibBaris(Promise.reject(alasan)));
    expect(e.kode).toBe('jaringan');
    expect(e.asal).toBe(alasan);
  });

  it('promise menolak dengan error umum tanpa kode -> tetap jaringan', async () => {
    const e = await tangkap(mutasiWajibBaris(Promise.reject(new Error('boom'))));
    expect(e.kode).toBe('jaringan');
  });

  it('penolakan berkode (mis. PostgrestError dari .throwOnError()) diklasifikasikan menurut kodenya', async () => {
    const e = await tangkap(mutasiWajibBaris(Promise.reject(Object.assign(new Error('rls'), { code: '42501' }))));
    expect(e.kode).toBe('ditolak');
  });

  it('errno Node 5 huruf (EPIPE/EPERM/EBUSY/EBADF/EXDEV) pada penolakan -> jaringan, BUKAN database', async () => {
    for (const code of ['EPIPE', 'EPERM', 'EBUSY', 'EBADF', 'EXDEV']) {
      const e = await tangkap(mutasiWajibBaris(Promise.reject(Object.assign(new Error('socket'), { code }))));
      expect(e.kode, code).toBe('jaringan');
    }
  });

  it('SQLSTATE sah tetap dikenali sebagai kode server walau diawali huruf (XX000, P0001, HV00J, 0A000, 22P02)', async () => {
    for (const code of ['XX000', 'P0001', 'HV00J', '0A000', '22P02', '57014']) {
      const e = await tangkap(mutasiWajibBaris(Promise.reject(Object.assign(new Error('pg'), { code }))));
      expect(e.kode, code).toBe('database');
    }
  });

  it('MutasiError yang sudah ada diteruskan apa adanya', async () => {
    const asli = new MutasiError('ditolak');
    await expect(mutasiWajibBaris(Promise.reject(asli))).rejects.toBe(asli);
  });
});

describe('mutasiInsert (INSERT/UPSERT)', () => {
  it('error RLS 42501 pada insert -> ditolak', async () => {
    const e = await tangkap(mutasiInsert(hasil(null, ERR_RLS)));
    expect(e.kode).toBe('ditolak');
    expect(e.asal).toBe(ERR_RLS);
  });

  it('error jaringan -> jaringan', async () => {
    const e = await tangkap(mutasiInsert(hasil(null, ERR_JARINGAN)));
    expect(e.kode).toBe('jaringan');
  });

  it('error umum -> database', async () => {
    const e = await tangkap(mutasiInsert(hasil(null, ERR_UMUM)));
    expect(e.kode).toBe('database');
  });

  it('tanpa baris dan tanpa error (query tanpa .select()) -> tidak melempar, mengembalikan []', async () => {
    await expect(mutasiInsert(hasil(null))).resolves.toEqual([]);
    await expect(mutasiInsert(hasil([]))).resolves.toEqual([]);
  });

  it('mengembalikan baris bila diminta .select()', async () => {
    await expect(mutasiInsert(hasil([{ id: 'n1' }]))).resolves.toEqual([{ id: 'n1' }]);
  });

  it('menormalkan data objek tunggal menjadi array', async () => {
    await expect(mutasiInsert(hasil({ id: 'n1' }))).resolves.toEqual([{ id: 'n1' }]);
  });

  it('promise menolak -> jaringan', async () => {
    const e = await tangkap(mutasiInsert(Promise.reject(new TypeError('Failed to fetch'))));
    expect(e.kode).toBe('jaringan');
  });
});

describe('pesanMutasi (untuk toast)', () => {
  it('MutasiError -> pesannya', () => {
    expect(pesanMutasi(new MutasiError('tidak_ada_baris'))).toBe(new MutasiError('tidak_ada_baris').pesan);
    expect(pesanMutasi(new MutasiError('database', { pesan: 'Gagal menyimpan FAQ' }))).toBe('Gagal menyimpan FAQ');
  });

  it('MutasiError mengabaikan fallback (pesan spesifik lebih berguna)', () => {
    expect(pesanMutasi(new MutasiError('ditolak'), 'Gagal')).toBe(new MutasiError('ditolak').pesan);
  });

  it('error biasa / unknown -> pesan umum Indonesia, tanpa membocorkan pesan teknis', () => {
    for (const e of [new Error('relation "x" does not exist'), 'string', null, undefined, 42, { message: 'secret' }]) {
      const p = pesanMutasi(e);
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/relation|secret/);
    }
  });

  it('error biasa memakai fallback bila diberikan', () => {
    expect(pesanMutasi(new Error('x'), 'Gagal menghapus dokumen')).toBe('Gagal menghapus dokumen');
    expect(pesanMutasi(undefined, 'Gagal menghapus dokumen')).toBe('Gagal menghapus dokumen');
  });
});

describe('kompatibilitas dengan builder supabase-js asli', () => {
  // Tipe: builder asli (thenable) harus bisa diteruskan ke helper tanpa error tsc.
  // Closure ini sengaja TIDAK dipanggil -> tidak ada permintaan jaringan.
  it('builder update/delete/insert/upsert/single memenuhi tipe helper (diperiksa tsc)', () => {
    const supabase = createClient('http://localhost', 'x');
    const tipe = () => [
      mutasiWajibBaris(supabase.from('x').update({}).eq('id', '1').select('id')),
      mutasiWajibBaris(supabase.from('x').delete().eq('id', '1').select('id')),
      mutasiWajibBaris(supabase.from('x').update({}).eq('id', '1').select('id').single()),
      mutasiWajibBaris(supabase.from('x').update({}).eq('id', '1').select('id').maybeSingle()),
      mutasiInsert(supabase.from('x').insert({})),
      mutasiInsert(supabase.from('x').upsert({}, { onConflict: 'id' }).select('id')),
    ];
    expect(typeof tipe).toBe('function');
  });

  it('inferensi tipe baris: array dan objek tunggal sama-sama menjadi T[]', () => {
    type Baris = { id: string };
    const daftar = null as unknown as PromiseLike<{ data: Baris[]; error: null }>;
    const tunggal = null as unknown as PromiseLike<{ data: Baris | null; error: { message: string; code: string } | null }>;
    const tipe = async () => {
      expectTypeOf(await mutasiWajibBaris(daftar)).toEqualTypeOf<Baris[]>();
      expectTypeOf(await mutasiWajibBaris(tunggal)).toEqualTypeOf<Baris[]>();
      expectTypeOf(await mutasiInsert(daftar)).toEqualTypeOf<Baris[]>();
    };
    expect(typeof tipe).toBe('function');
  });

  // Runtime: builder asli + fetch palsu (tanpa jaringan sungguhan).
  function klien(fetchPalsu: typeof fetch) {
    return createClient('http://localhost', 'x', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchPalsu },
    });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('UPDATE yang mengenai baris -> mengembalikan baris', async () => {
    const supabase = klien(vi.fn(async () => json([{ id: '1' }])) as unknown as typeof fetch);
    await expect(
      mutasiWajibBaris(supabase.from('x').update({ a: 1 }).eq('id', '1').select('id')),
    ).resolves.toEqual([{ id: '1' }]);
  });

  it('UPDATE yang ditolak RLS (200 + []) -> tidak_ada_baris', async () => {
    const supabase = klien(vi.fn(async () => json([])) as unknown as typeof fetch);
    const e = await tangkap(mutasiWajibBaris(supabase.from('x').update({ a: 1 }).eq('id', '1').select('id')));
    expect(e.kode).toBe('tidak_ada_baris');
  });

  it('INSERT yang melanggar WITH CHECK (403 + 42501) -> ditolak', async () => {
    const supabase = klien(
      vi.fn(async () => json({ code: '42501', details: null, hint: null, message: ERR_RLS.message }, 403)) as unknown as typeof fetch,
    );
    const e = await tangkap(mutasiInsert(supabase.from('x').insert({ a: 1 })));
    expect(e.kode).toBe('ditolak');
  });

  it('fetch gagal (supabase-js mengembalikan status 0) -> jaringan', async () => {
    const supabase = klien(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    );
    const e = await tangkap(mutasiWajibBaris(supabase.from('x').update({ a: 1 }).eq('id', '1').select('id')));
    expect(e.kode).toBe('jaringan');
  });
});

describe('mutasiBolehKosong', () => {
  it('menerima 0 baris tanpa melempar (idempoten)', async () => {
    const hasil = await mutasiBolehKosong(Promise.resolve({ data: [], error: null }));
    expect(hasil).toEqual([]);
  });

  it('mengembalikan baris yang terdampak bila ada', async () => {
    const hasil = await mutasiBolehKosong(Promise.resolve({ data: [{ id: '1' }], error: null }));
    expect(hasil).toEqual([{ id: '1' }]);
  });

  it('tetap melempar MutasiError bila error ada', async () => {
    await expect(
      mutasiBolehKosong(Promise.resolve({ data: null, error: { message: 'boom', code: '42501' } })),
    ).rejects.toMatchObject({ name: 'MutasiError', kode: 'ditolak' });
  });

  it('membungkus penolakan promise sebagai jaringan', async () => {
    await expect(mutasiBolehKosong(Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({
      kode: 'jaringan',
    });
  });
});
