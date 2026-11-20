import type { SupabaseClient } from '@supabase/supabase-js';
export const ID = '11111111-1111-4111-8111-111111111111';
export const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const kunci = `investment-docs/raw/${UID}/${ID}.pdf`;
export const request = (body: unknown) => new Request('https://local.test/api/investment-docs', { method: 'POST', body: JSON.stringify(body) });
export const context = { params: Promise.resolve({ id: ID }) };
type Baris = Record<string, unknown>;
export function tiruan() {
  const state = {
    user: { id: UID } as { id: string } | null, boleh: true, rpcError: null as object | null,
    rows: [{ id: ID, file_path: `src/${ID}.pdf`, status: 'diproses', halaman_gambar: [],
      jumlah_halaman: 10, halaman_selesai: 0, diproses_pada: null }] as Baris[],
    claims: [] as Baris[], updates: [] as Baris[],
    insertError: null as object | null, updateError: null as object | null,
    nol: false,
  };
  const sb = {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.boleh, error: state.rpcError }),
    from: (table: string) => {
      const rows = table === 'investment_pdf_claims' ? state.claims : state.rows;
      let operasi = 'select', payload: Baris = {};
      const filter: [string, unknown][] = [];
      const q = {
        select: () => q, eq: (k: string, v: unknown) => { filter.push([k, v]); return q; },
        is: (k: string, v: unknown) => { filter.push([k, v]); return q; },
        insert: (v: Baris) => { operasi = 'insert'; payload = v; return q; },
        update: (v: Baris) => { operasi = 'update'; payload = v; return q; },
        single: () => run(), maybeSingle: () => run(),
      };
      const run = async () => {
        if (operasi === 'insert') {
          if (table !== 'investment_pdf_claims' && state.insertError) return { data: null, error: state.insertError };
          if (table === 'investment_pdf_claims' && rows.some(r => r.kunci === payload.kunci)) return { data: null, error: { code: '23505' } };
          if (table === 'investment_documents') payload.diproses_pada ??= null;
          rows.push(payload); return { data: payload, error: null };
        }
        const row = rows.find(r => filter.every(([k, v]) => r[k] === v));
        if (operasi === 'update') {
          state.updates.push(payload);
          if (state.updateError) { const error = state.updateError; state.updateError = null; return { data: null, error }; }
          if (state.nol) return { data: null, error: null };
          if (row) Object.assign(row, payload);
        }
        return { data: row ? structuredClone(row) : null, error: null };
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, state };
}
