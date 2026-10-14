// @vitest-environment node
// Kontrak aturan ESLint `lmh/mutasi-tercek` (eslint-rules/mutasi-tercek.mjs).
// Rancangan: docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.4.
//
// Aturan ini memblokir dua kelas bug "sukses palsu" pada mutasi Supabase:
//  - UPDATE/DELETE yang ditolak RLS = 0 baris tanpa error  -> wajib lewat helper
//    mutasiWajibBaris / mutasiBolehKosong;
//  - INSERT/UPSERT/RPC yang hasilnya dibuang atau error-nya tak dibaca.
import { describe, it, vi } from 'vitest';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import plugin from '../../eslint-rules/mutasi-tercek.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const rule = plugin.rules!['mutasi-tercek'];

tester.run('lmh/mutasi-tercek', rule, {
  valid: [
    // --- UPDATE/DELETE dibungkus helper ---
    {
      name: 'update dalam mutasiWajibBaris',
      code: `async function f() {
        await mutasiWajibBaris(supabase.from('x').update({ a: 1 }).eq('id', 1).select('id'));
      }`,
    },
    {
      name: 'delete dalam mutasiBolehKosong',
      code: `async function f() {
        await mutasiBolehKosong(supabase.from('x').delete().eq('id', 1).select('id'));
      }`,
    },
    {
      name: 'update dibungkus helper dengan rantai multi-baris',
      code: `async function f() {
        const baris = await mutasiWajibBaris(
          supabase
            .from('x')
            .update({ a: 1 })
            .eq('id', 1)
            .select('id'),
        );
        return baris;
      }`,
    },
    {
      name: 'update lewat variabel perantara yang diteruskan ke helper',
      code: `async function f(id: string) {
        let q = supabase.from('x').update({ a: 1 }).eq('id', id);
        if (id) q = q.eq('b', 2);
        await mutasiWajibBaris(q.select('id'));
      }`,
    },
    {
      name: 'variabel perantara langsung diteruskan ke helper',
      code: `async function f(id: string) {
        const q = supabase.from('x').delete().eq('id', id).select('id');
        await mutasiBolehKosong(q);
      }`,
    },
    {
      name: 'update dengan as/non-null di antara rantai dan helper',
      code: `async function f() {
        await mutasiWajibBaris(supabase.from('x').update({ a: 1 }).eq('id', 1).select('id') as never);
      }`,
    },
    {
      name: 'update lewat tabel yang disimpan di variabel (from di variabel)',
      code: `async function f() {
        const tabel = supabase.from('x');
        await mutasiWajibBaris(tabel.update({ a: 1 }).eq('id', 1).select('id'));
      }`,
    },
    // --- INSERT/UPSERT ---
    {
      name: 'insert dibungkus mutasiInsert',
      code: `async function f() { await mutasiInsert(supabase.from('x').insert({ a: 1 })); }`,
    },
    {
      name: 'upsert dibungkus mutasiInsert',
      code: `async function f() { await mutasiInsert(supabase.from('x').upsert({ a: 1 }, { onConflict: 'id' })); }`,
    },
    {
      name: 'insert dengan const { error } = await',
      code: `async function f() { const { error } = await supabase.from('x').insert({ a: 1 }); if (error) throw error; }`,
    },
    {
      name: 'insert dengan { data, error } dan select',
      code: `async function f() { const { data, error } = await supabase.from('x').insert({ a: 1 }).select('id').single(); return [data, error]; }`,
    },
    {
      name: 'insert dengan error di-rename',
      code: `async function f() { const { error: e } = await supabase.from('x').insert({ a: 1 }); return e; }`,
    },
    {
      name: 'insert ditugaskan ke identifier utuh',
      code: `async function f() { const res = await supabase.from('x').insert({ a: 1 }); return res.error; }`,
    },
    {
      name: 'insert dengan rest destructuring (error ikut di rest)',
      code: `async function f() { const { data, ...sisa } = await supabase.from('x').insert({ a: 1 }).select(); return [data, sisa]; }`,
    },
    {
      name: 'insert diberi ke assignment destructuring dengan error',
      code: `async function f() { let error; ({ error } = await supabase.from('x').insert({ a: 1 })); return error; }`,
    },
    {
      name: 'insert langsung di-return',
      code: `function f() { return supabase.from('x').insert({ a: 1 }); }`,
    },
    {
      name: 'insert di-return dari arrow ekspresi',
      code: `const f = () => supabase.from('x').insert({ a: 1 });`,
    },
    {
      name: 'insert di-return setelah await',
      code: `async function f() { return await supabase.from('x').insert({ a: 1 }); }`,
    },
    {
      name: 'insert di-then-kan',
      code: `function f() { supabase.from('x').insert({ a: 1 }).then(({ error }) => { if (error) console.error(error); }); }`,
    },
    {
      name: 'insert di dalam Promise.all yang hasilnya ditugaskan',
      code: `async function f() { const hasil = await Promise.all([supabase.from('x').insert({ a: 1 }), supabase.from('y').insert({ b: 1 })]); return hasil; }`,
    },
    // --- RPC ---
    {
      name: 'rpc dengan const { error } =',
      code: `async function f() { const { error } = await supabase.rpc('fn', { a: 1 }); if (error) throw error; }`,
    },
    {
      name: 'rpc dengan { data, error }',
      code: `async function f() { const { data, error } = await supabase.rpc('fn'); return [data, error]; }`,
    },
    {
      name: 'rpc langsung di-return',
      code: `function f() { return supabase.rpc('fn', {}); }`,
    },
    {
      name: 'rpc dibungkus mutasiInsert',
      code: `async function f() { await mutasiInsert(supabase.rpc('fn')); }`,
    },
    // --- Bukan rantai Supabase: tidak boleh ditandai ---
    { name: 'Map.delete', code: `function f(map: Map<string, number>, k: string) { map.delete(k); }` },
    { name: 'Set.delete', code: `function f(set: Set<string>, k: string) { set.delete(k); }` },
    { name: 'hash.update (crypto)', code: `function f(hash: { update(x: string): unknown }) { hash.update('x'); }` },
    {
      name: 'createHash().update().digest()',
      code: `function f() { return createHash('sha256').update('x').update('y').digest('hex'); }`,
    },
    { name: 'URLSearchParams.delete', code: `function f(p: URLSearchParams) { p.delete('x'); }` },
    { name: 'indexedDB store.delete / put', code: `function f(store: IDBObjectStore) { store.delete('k'); }` },
    {
      name: 'Array.from(...).delete (bukan Supabase)',
      code: `function f(x: Iterable<string>) { Array.from(x).delete(1); }`,
    },
    {
      name: 'Storage Supabase .from().update (storage, bukan tabel)',
      code: `async function f() { await supabase.storage.from('bucket').update('path', file); }`,
    },
    {
      name: 'select biasa tidak ditandai',
      code: `async function f() { const { data } = await supabase.from('x').select('*'); return data; }`,
    },
  ],
  invalid: [
    // --- UPDATE/DELETE tanpa helper ---
    {
      name: 'update tanpa helper',
      code: `async function f() { await supabase.from('x').update({ a: 1 }).eq('id', 1); }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update tanpa helper walau error dibaca',
      code: `async function f() { const { error } = await supabase.from('x').update({ a: 1 }).eq('id', 1); if (error) throw error; }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'delete tanpa helper',
      code: `async function f() { await supabase.from('x').delete().eq('id', 1); }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update multi-baris tanpa helper',
      code: `async function f() {
        await supabase
          .from('x')
          .update({ a: 1 })
          .eq('id', 1)
          .select('id');
      }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper', line: 4 }],
    },
    {
      name: 'update lewat variabel yang tidak pernah diteruskan ke helper',
      code: `async function f() {
        const q = supabase.from('x').update({ a: 1 }).eq('id', 1);
        await q;
      }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update lewat tabel di variabel tanpa helper',
      code: `async function f() { const t = supabase.from('x'); await t.update({ a: 1 }).eq('id', 1); }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update dibungkus mutasiInsert tidak cukup (khusus insert/upsert)',
      code: `async function f() { await mutasiInsert(supabase.from('x').update({ a: 1 }).eq('id', 1)); }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update di-return tanpa helper',
      code: `function f() { return supabase.from('x').update({ a: 1 }).eq('id', 1); }`,
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    {
      name: 'update lewat klien yang di-cast (as) tetap terdeteksi',
      code: "async function f() { await (supabase as never as Db).from('x').update({ a: 1 }).eq('id', 1); }",
      errors: [{ messageId: 'updateDeleteTanpaHelper' }],
    },
    // --- INSERT/UPSERT hasil dibuang / error tak dibaca ---
    {
      name: 'insert dibuang',
      code: `async function f() { await supabase.from('x').insert({}); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'upsert dibuang',
      code: `async function f() { await supabase.from('x').upsert({ a: 1 }, { onConflict: 'a' }); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'insert dibuang rantai multi-baris',
      code: `async function f() {
        await supabase
          .from('x')
          .insert({ a: 1 })
          .select('id');
      }`,
      errors: [{ messageId: 'mutasiDibuang', line: 4 }],
    },
    {
      name: 'insert tanpa await dibuang (fire-and-forget)',
      code: `function f() { supabase.from('x').insert({ a: 1 }); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'void insert dibuang',
      code: `function f() { void supabase.from('x').insert({ a: 1 }); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'insert destructuring tanpa error',
      code: `async function f() { const { data } = await supabase.from('x').insert({}).select(); return data; }`,
      errors: [{ messageId: 'errorTakDibaca' }],
    },
    {
      name: 'upsert destructuring tanpa error',
      code: `async function f() { const { data } = await supabase.from('x').upsert({}).select(); return data; }`,
      errors: [{ messageId: 'errorTakDibaca' }],
    },
    {
      name: 'insert dalam Promise.all yang dibuang',
      code: `async function f() { await Promise.all([supabase.from('x').insert({ a: 1 }), supabase.from('y').insert({ b: 1 })]); }`,
      errors: [{ messageId: 'mutasiDibuang' }, { messageId: 'mutasiDibuang' }],
    },
    // --- RPC ---
    {
      name: 'rpc dibuang',
      code: `async function f() { await supabase.rpc('fn'); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'rpc dibuang dengan argumen',
      code: `async function f() { await supabase.rpc('fn', { a: 1 }); }`,
      errors: [{ messageId: 'mutasiDibuang' }],
    },
    {
      name: 'rpc destructuring tanpa error',
      code: `async function f() { const { data } = await supabase.rpc('fn'); return data; }`,
      errors: [{ messageId: 'errorTakDibaca' }],
    },
  ],
});

// Bukti ujung-ke-ujung memakai config ASLI proyek (eslint.config.mjs): berkas aplikasi diblokir,
// berkas test dan mutate.ts dikecualikan. `lintText` tidak menulis berkas apa pun ke repo.
describe('eslint.config.mjs memasang aturan sebagai error', () => {
  const kode = `export async function f() { await supabase.from('x').update({ a: 1 }).eq('id', 1); }\n`;

  async function lint(filePath: string) {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [hasil] = await eslint.lintText(kode, { filePath });
    return hasil.messages.filter((m) => m.ruleId === 'lmh/mutasi-tercek');
  }

  it('memblokir (severity 2) di src/**/*.tsx', async () => {
    const pesan = await lint('src/app/x/page.tsx');
    expect(pesan).toHaveLength(1);
    expect(pesan[0].severity).toBe(2);
    expect(pesan[0].message).toMatch(/mutasiWajibBaris/);
  });

  it('memblokir di route handler src/**/*.ts', async () => {
    expect(await lint('src/app/api/x/route.ts')).toHaveLength(1);
  });

  it('mengecualikan berkas test dan src/test/**', async () => {
    expect(await lint('src/app/x/page.test.tsx')).toHaveLength(0);
    expect(await lint('src/test/x.ts')).toHaveLength(0);
  });

  it('mengecualikan helper src/lib/supabase/mutate.ts', async () => {
    expect(await lint('src/lib/supabase/mutate.ts')).toHaveLength(0);
  });
});

// Direktif disable diuji lewat API ESLint (RuleTester menamai aturan "rule-to-test/...", sehingga
// komentar `lmh/mutasi-tercek` tidak akan cocok di sana).
describe('pengecualian lmh/mutasi-tercek wajib beralasan', () => {
  async function lintKode(kode: string) {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
          plugins: { lmh: plugin },
          rules: { 'lmh/mutasi-tercek': 'error' },
        },
      ],
    });
    const [hasil] = await eslint.lintText(kode, { filePath: 'src/x.ts' });
    return hasil.messages;
  }

  const sisip = "await supabase.from('x').insert({ a: 1 });";

  it('disable dengan alasan menekan pelanggaran dan tidak melapor apa pun', async () => {
    const pesan = await lintKode(`async function f() {
  // eslint-disable-next-line lmh/mutasi-tercek -- best-effort: log tidak boleh menggagalkan respons
  ${sisip}
}`);
    expect(pesan).toEqual([]);
  });

  it('disable tanpa alasan dilaporkan (di baris komentar)', async () => {
    const pesan = await lintKode(`async function f() {
  // eslint-disable-next-line lmh/mutasi-tercek
  ${sisip}
}`);
    expect(pesan.map((m) => [m.messageId, m.line])).toEqual([['disableTanpaAlasan', 2]]);
  });

  it('disable dengan alasan kosong tetap memblokir (direktif tidak berlaku)', async () => {
    const pesan = await lintKode(`async function f() {
  // eslint-disable-next-line lmh/mutasi-tercek --
  ${sisip}
}`);
    // ESLint sendiri menolak direktif ber-"--" kosong, jadi pelanggaran asli tetap muncul.
    expect(pesan.some((m) => m.messageId === 'mutasiDibuang' && m.severity === 2)).toBe(true);
  });

  it('disable aturan lain tanpa alasan tidak dipermasalahkan oleh aturan ini', async () => {
    const pesan = await lintKode(`async function f() {
  // eslint-disable-next-line no-console
  console.log(1);
}`);
    expect(pesan.filter((m) => m.ruleId === 'lmh/mutasi-tercek')).toEqual([]);
  });
});
