// Plugin ESLint lokal `lmh`, aturan `lmh/mutasi-tercek` (audit T2 "notifikasi sukses palsu").
// Rancangan: docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.4.
//
// supabase-js TIDAK melempar: kegagalan kembali sebagai `{ error }`, dan penolakan RLS pada
// UPDATE/DELETE = 0 baris terdampak tanpa error. Aturan ini memblokir dua bentuk kode yang
// melaporkan sukses palsu:
//
//  1. `.update(...)` / `.delete(...)` pada rantai yang berakar di `.from(...)` WAJIB menjadi argumen
//     langsung `mutasiWajibBaris(...)` / `mutasiBolehKosong(...)` (src/lib/supabase/mutate.ts).
//     Rantai yang lebih dulu ditaruh di variabel dianggap sah bila variabel itu diteruskan ke
//     salah satu helper tersebut.
//  2. `.insert(...)` / `.upsert(...)` (berakar `.from`) dan `.rpc(...)`: hasilnya WAJIB dikonsumsi:
//     dibungkus helper, di-`await` ke variabel yang memuat `error`, ditugaskan ke identifier utuh,
//     di-return, atau di-`.then(`-kan. Dilarang: dibuang (statement tanpa menangkap hasil, `void`),
//     atau destructuring tanpa `error`.
//
// Batas statis (tidak terdeteksi): akses lewat alias/fungsi pembungkus buatan sendiri, query builder
// yang dilewatkan antarfungsi, `supabase.from(...)` yang diberikan lewat parameter fungsi lalu
// di-update di fungsi lain, dan "error dibaca tapi diabaikan". Rantai non-Supabase (Map/Set.delete,
// crypto hash.update, IndexedDB, Storage Supabase) sengaja TIDAK ditandai.
//
// Pengecualian: `// eslint-disable-next-line lmh/mutasi-tercek -- alasan` (alasan WAJIB; disable tanpa
// alasan dilaporkan oleh aturan ini sendiri).

const NAMA_RULE = 'lmh/mutasi-tercek';

const HELPER_UPDATE_DELETE = new Set(['mutasiWajibBaris', 'mutasiBolehKosong']);
const HELPER_SEMUA = new Set(['mutasiWajibBaris', 'mutasiBolehKosong', 'mutasiInsert']);
const MUTASI_UPDATE_DELETE = new Set(['update', 'delete']);
const MUTASI_INSERT = new Set(['insert', 'upsert']);
// `Array.from(...)`/`Buffer.from(...)`/dst. bukan akar query Supabase.
const BUKAN_AKAR_FROM = new Set(['Array', 'Buffer', 'Object', 'Uint8Array', 'Set', 'Map', 'Promise']);
const BATAS_ALIAS = 5;

const TIPE_PEMBUNGKUS_TS = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

function bukaPembungkus(node) {
  let n = node;
  while (n && TIPE_PEMBUNGKUS_TS.has(n.type)) n = n.expression;
  return n;
}

function namaProperti(member) {
  if (!member || member.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') {
    return member.property.value;
  }
  return null;
}

function namaCallee(call) {
  const callee = bukaPembungkus(call.callee);
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') return namaProperti(callee);
  return null;
}

function cariVariabel(scope, nama) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(nama);
    if (v) return v;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const mutasiTercek = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Mutasi Supabase harus dicek: UPDATE/DELETE lewat mutasiWajibBaris/mutasiBolehKosong; INSERT/UPSERT/RPC hasilnya dikonsumsi.',
    },
    schema: [],
    messages: {
      updateDeleteTanpaHelper:
        'UPDATE/DELETE Supabase harus dibungkus mutasiWajibBaris/mutasiBolehKosong agar penolakan RLS (0 baris) tidak jadi sukses palsu — lihat src/lib/supabase/mutate.ts.',
      mutasiDibuang:
        'Hasil INSERT/UPSERT/RPC Supabase dibuang sehingga error tak terlihat. Bungkus dengan mutasiInsert(...) atau tangkap `const { error } = await ...` lalu tangani — lihat src/lib/supabase/mutate.ts. Fire-and-forget yang disengaja: // eslint-disable-next-line lmh/mutasi-tercek -- best-effort: <alasan>.',
      errorTakDibaca:
        'Destructuring hasil INSERT/UPSERT/RPC Supabase tidak memuat `error`, sehingga kegagalan lolos diam-diam. Tambahkan `error` dan tangani, atau bungkus dengan mutasiInsert(...) — lihat src/lib/supabase/mutate.ts.',
      disableTanpaAlasan:
        'Pengecualian lmh/mutasi-tercek wajib menyertakan alasan: // eslint-disable-next-line lmh/mutasi-tercek -- <alasan>.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // ---- Apakah rantai berakar di `.from(...)` Supabase (bukan storage / Array.from)? ----
    function berakarFrom(node, scope, kedalaman = 0) {
      let n = bukaPembungkus(node);
      while (n) {
        n = bukaPembungkus(n);
        if (n.type === 'AwaitExpression') {
          n = n.argument;
          continue;
        }
        if (n.type === 'CallExpression') {
          const callee = bukaPembungkus(n.callee);
          if (callee.type !== 'MemberExpression') return false;
          if (namaProperti(callee) === 'from') {
            const induk = bukaPembungkus(callee.object);
            if (induk.type === 'MemberExpression' && namaProperti(induk) === 'storage') return false;
            if (induk.type === 'Identifier' && BUKAN_AKAR_FROM.has(induk.name)) return false;
            return true;
          }
          n = callee.object;
          continue;
        }
        if (n.type === 'MemberExpression') {
          n = n.object;
          continue;
        }
        if (n.type === 'Identifier') {
          // Alias: `const tabel = supabase.from('x'); tabel.update(...)`.
          if (kedalaman >= BATAS_ALIAS) return false;
          const v = cariVariabel(scope, n.name);
          if (!v || v.defs.length !== 1) return false;
          const def = v.defs[0];
          if (def.type !== 'Variable' || !def.node.init || def.node.id.type !== 'Identifier') return false;
          return berakarFrom(def.node.init, v.scope, kedalaman + 1);
        }
        return false;
      }
      return false;
    }

    // ---- Naik ke puncak rantai pemanggilan (.update(...).eq(...).select(...)) ----
    // Mengembalikan { atas, adaThen }: `adaThen` bila rantai berlanjut ke `.then(`.
    function puncakRantai(node) {
      let atas = node;
      let adaThen = false;
      for (;;) {
        let p = atas.parent;
        let anak = atas;
        while (p && TIPE_PEMBUNGKUS_TS.has(p.type)) {
          anak = p;
          p = p.parent;
        }
        if (
          p &&
          p.type === 'MemberExpression' &&
          p.object === anak &&
          p.parent &&
          p.parent.type === 'CallExpression' &&
          bukaPembungkus(p.parent.callee) === p
        ) {
          if (namaProperti(p) === 'then') adaThen = true;
          atas = p.parent;
          continue;
        }
        return { atas, adaThen };
      }
    }

    // Konteks pembungkus (await/as/!) di atas ekspresi; kembalikan { anak, induk } terluar.
    function konteks(node) {
      let anak = node;
      let induk = node.parent;
      while (induk && (induk.type === 'AwaitExpression' || TIPE_PEMBUNGKUS_TS.has(induk.type))) {
        anak = induk;
        induk = induk.parent;
      }
      return { anak, induk };
    }

    function dalamHelper(node, daftar) {
      const { anak, induk } = konteksTanpaAwait(node);
      return (
        induk &&
        induk.type === 'CallExpression' &&
        induk.arguments.includes(anak) &&
        daftar.has(namaCallee(induk))
      );
    }

    // Pembungkus TS saja (tanpa await): helper menerima query, bukan hasil await.
    function konteksTanpaAwait(node) {
      let anak = node;
      let induk = node.parent;
      while (induk && TIPE_PEMBUNGKUS_TS.has(induk.type)) {
        anak = induk;
        induk = induk.parent;
      }
      return { anak, induk };
    }

    function polaMemuatError(pola) {
      if (pola.type === 'ObjectPattern') {
        return pola.properties.some((prop) => {
          if (prop.type === 'RestElement') return true; // error ikut di `...sisa`
          if (prop.type === 'Property' && !prop.computed) {
            const kunci = prop.key;
            return (
              (kunci.type === 'Identifier' && kunci.name === 'error') ||
              (kunci.type === 'Literal' && kunci.value === 'error')
            );
          }
          return prop.type === 'Property' && prop.computed; // kunci dinamis: tidak bisa dipastikan
        });
      }
      return true; // Identifier / ArrayPattern / dst.: dianggap dikonsumsi utuh
    }

    // Apakah nilai ekspresi `node` (hasil mutasi) dikonsumsi? -> 'ok' | 'dibuang' | 'tanpaError'
    function statusKonsumsi(node, kedalaman = 0) {
      const { anak, induk } = konteks(node);
      if (!induk) return 'ok';
      switch (induk.type) {
        case 'ExpressionStatement':
          return 'dibuang';
        case 'UnaryExpression':
          if (induk.operator === 'void') {
            return induk.parent && induk.parent.type === 'ExpressionStatement' ? 'dibuang' : 'ok';
          }
          return 'ok';
        case 'VariableDeclarator':
          if (induk.init === anak) return polaMemuatError(induk.id) ? 'ok' : 'tanpaError';
          return 'ok';
        case 'AssignmentExpression':
          if (induk.right === anak) {
            return induk.left.type === 'ObjectPattern' && !polaMemuatError(induk.left) ? 'tanpaError' : 'ok';
          }
          return 'ok';
        case 'ArrayExpression': {
          // Promise.all([...insert...]): nilai ditentukan oleh cara hasil Promise.all dikonsumsi.
          const panggilan = induk.parent;
          if (
            kedalaman < 3 &&
            panggilan &&
            panggilan.type === 'CallExpression' &&
            panggilan.arguments[0] === induk &&
            ['all', 'allSettled'].includes(namaCallee(panggilan))
          ) {
            return statusKonsumsi(panggilan, kedalaman + 1);
          }
          return 'ok';
        }
        default:
          // return, arrow ekspresi, argumen fungsi lain, kondisional, akses properti, dst.
          return 'ok';
      }
    }

    function periksaUpdateDelete(node, atas) {
      if (dalamHelper(atas, HELPER_UPDATE_DELETE)) return;

      // Rantai ditaruh di variabel lalu variabel itu diteruskan ke helper di tempat lain.
      const { anak, induk } = konteksTanpaAwait(atas);
      if (induk && induk.type === 'VariableDeclarator' && induk.init === anak && induk.id.type === 'Identifier') {
        const v = cariVariabel(sourceCode.getScope(induk), induk.id.name);
        if (v) {
          // Referensi bisa langsung argumen helper, atau pangkal rantai yang menjadi argumen (`q.select('id')`).
          const diteruskan = v.references.some((ref) =>
            dalamHelper(puncakRantai(ref.identifier).atas, HELPER_UPDATE_DELETE),
          );
          if (diteruskan) return;
        }
      }
      context.report({ node: node.callee.property ?? node, messageId: 'updateDeleteTanpaHelper' });
    }

    function periksaInsertRpc(node, atas, adaThen) {
      if (dalamHelper(atas, HELPER_SEMUA)) return;
      if (adaThen) return;
      const status = statusKonsumsi(atas);
      if (status === 'dibuang') context.report({ node: node.callee.property ?? node, messageId: 'mutasiDibuang' });
      else if (status === 'tanpaError') {
        context.report({ node: node.callee.property ?? node, messageId: 'errorTakDibaca' });
      }
    }

    return {
      Program() {
        // Disable-directive untuk aturan ini wajib beralasan (`-- alasan`).
        for (const komentar of sourceCode.getAllComments()) {
          const teks = komentar.value.trim();
          const cocok = /^eslint-disable(?:-next-line|-line)?(?=\s|$)([\s\S]*)$/.exec(teks);
          if (!cocok) continue;
          const [daftar, ...sisa] = cocok[1].split(/\s--(?=\s|$)/);
          const alasan = sisa.join(' -- ').trim();
          const aturan = daftar.split(',').map((s) => s.trim()).filter(Boolean);
          if (!aturan.includes(NAMA_RULE)) continue;
          if (!alasan) context.report({ loc: komentar.loc, messageId: 'disableTanpaAlasan' });
        }
      },
      CallExpression(node) {
        const callee = bukaPembungkus(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const nama = namaProperti(callee);
        if (!nama) return;

        const mutasiRantai = MUTASI_UPDATE_DELETE.has(nama) || MUTASI_INSERT.has(nama);
        if (mutasiRantai) {
          if (!berakarFrom(callee.object, sourceCode.getScope(node))) return;
          const { atas, adaThen } = puncakRantai(node);
          if (MUTASI_UPDATE_DELETE.has(nama)) periksaUpdateDelete(node, atas);
          else periksaInsertRpc(node, atas, adaThen);
          return;
        }
        if (nama === 'rpc') {
          const { atas, adaThen } = puncakRantai(node);
          periksaInsertRpc(node, atas, adaThen);
        }
      },
    };
  },
};

/** @type {import('eslint').ESLint.Plugin} */
export const plugin = {
  meta: { name: 'eslint-plugin-lmh', version: '1.0.0' },
  rules: { 'mutasi-tercek': mutasiTercek },
};

export default plugin;
