import type { SupabaseClient } from '@supabase/supabase-js';
import type { GambarIpro, IproAdmin } from '@/lib/data/investasi';
import { kekuranganTerbit } from './server';

export const ID = '11111111-1111-4111-8111-111111111111';
export const GAMBAR_ID = '22222222-2222-4222-8222-222222222222';
export const LAIN_ID = '33333333-3333-4333-8333-333333333333';
export const isianProyek = { sumber: 'ptsp', judul: 'Energi Lampung', ringkasan: 'Ringkasan proyek', sektor: 'energi', kab_kota: 'Kota Bandar Lampung' } as const;
export const konteks = (id = ID) => ({ params: Promise.resolve({ id }) });
export const konteksGambar = (id = ID, gambarId = GAMBAR_ID) => ({ params: Promise.resolve({ id, gambarId }) });
export const request = (method: string, body?: unknown, path = '') => new Request(`https://local.test/api/admin/ipro${path}`, {
  method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
export function proyek(ubah: Partial<IproAdmin> = {}): IproAdmin {
  return { ...isianProyek, sumber: 'ptsp', id: ID, slug: 'energi-lampung', status: 'draf', versi: 1,
    judul_en: null, ringkasan_en: null, deskripsi: 'Deskripsi proyek lengkap', deskripsi_en: null,
    lokasi_teks: null, lat: null, lng: null, pemilik: null, nilai_investasi: null, mata_uang: 'IDR', nilai_teks: null,
    irr_persen: null, npv_nilai: null, payback_bulan: null, skema: null, status_lahan: null, luas_ha: null, tahap_kajian: null,
    perizinan: null, dokumen_id: null, kontak_instansi: null, kontak_email: null, kontak_telepon: null,
    sumber_url: null, sumber_slug: null, urutan: 0, diterbitkan_pada: null, dibuat_pada: '2026-11-19T00:00:00Z', diubah_pada: '2026-11-19T00:00:00Z', ...ubah };
}
export function gambar(ubah: Partial<GambarIpro> = {}): GambarIpro {
  return { id: GAMBAR_ID, proyek_id: ID, kunci: `ipro-gambar/${ID}/${GAMBAR_ID}.webp`, kunci_mini: `ipro-gambar/${ID}/${GAMBAR_ID}-640.webp`,
    lebar: 1600, tinggi: 900, alt: 'Lokasi proyek energi', alt_en: null, keterangan: null, keterangan_en: null, utama: true, urutan: 0, ...ubah };
}
type Baris = Record<string, unknown>;
export function buatSupabaseTiruan() {
  const state = {
    user: { id: LAIN_ID } as { id: string } | null, authError: null as { message: string } | null,
    boleh: true, rpcError: null as { message: string; code?: string } | null,
    tabel: { ipro_proyek: [proyek()], ipro_gambar: [gambar()], investasi_lead: [], investment_documents: [] } as Record<string, Baris[]>,
    galat: [] as { tabel: string; operasi: string; setelah?: number; error: { message: string; code?: string } }[],
    catatan: [] as { tabel: string; operasi: string; langkah: [string, ...unknown[]][] }[],
    rpc: [] as { nama: string; args: unknown }[],
  };
  const galatOperasi = (tabel: string, operasi: string) => {
    const i = state.galat.findIndex(g => g.tabel === tabel && g.operasi === operasi);
    if (i < 0) return null;
    const g = state.galat[i];
    if (g.setelah) { g.setelah--; return null; }
    return state.galat.splice(i, 1)[0].error;
  };
  const sb = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.authError }) },
    rpc: async (nama: string, args?: unknown) => {
      state.rpc.push({ nama, args });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (nama === 'boleh_kelola_investasi') return { data: state.boleh, error: null };
      if (nama === 'investasi_ubah_status_minat') return { data: { id: ID, status: 'dihubungi', versi: 2 }, error: null };
      const p = args as { p_proyek_id: string; p_gambar_id?: string; p_data?: Baris; p_status?: string; p_versi?: number };
      const proyek = state.tabel.ipro_proyek.find(b => b.id === p.p_proyek_id);
      const gagal = (message: string, code: string, details?: string) => { throw { message, code, details }; };
      // Model transaksi di batas SDK; rollback mesin PostgreSQL dibuktikan terpisah lewat PGlite.
      const sebelum = structuredClone(state.tabel.ipro_gambar);
      try {
        if (!proyek) gagal('TIDAK_DITEMUKAN', 'P0002');
        const g = state.tabel.ipro_gambar.filter(b => b.proyek_id === p.p_proyek_id);
        if (nama === 'ipro_ubah_status') {
          if (proyek!.versi !== p.p_versi) gagal('KONFLIK_VERSI', '40001');
          const kurang = kekuranganTerbit(proyek as unknown as IproAdmin, g as unknown as GambarIpro[]);
          if (p.p_status === 'terbit' && kurang.length) gagal('SYARAT_TERBIT', '23514', JSON.stringify(kurang));
          Object.assign(proyek!, { status: p.p_status, versi: Number(proyek!.versi) + 1 });
          return { data: { ...proyek }, error: null };
        }
        const data = p.p_data ?? {};
        const target = g.find(b => b.id === p.p_gambar_id);
        if (nama !== 'ipro_tambah_gambar' && !target) gagal('TIDAK_DITEMUKAN', 'P0002');
        if (nama === 'ipro_tambah_gambar' && g.length >= (proyek!.sumber === 'foila' ? 1 : 12)) gagal('KONFLIK_STATUS', '23514');
        if (proyek!.status === 'terbit' && ((nama === 'ipro_hapus_gambar' && (target!.utama || proyek!.sumber === 'foila')) ||
          (target?.utama && data.utama === false))) gagal('SYARAT_TERBIT', '23514', '["gambar_utama"]');
        if (data.utama || (nama === 'ipro_tambah_gambar' && !g.length)) {
          const error = galatOperasi('ipro_gambar', 'update'); if (error) throw error;
          g.forEach(b => { b.utama = false; });
        }
        const operasi = nama === 'ipro_tambah_gambar' ? 'insert' : nama === 'ipro_hapus_gambar' ? 'delete' : 'update';
        const error = galatOperasi('ipro_gambar', operasi); if (error) throw error;
        if (nama === 'ipro_tambah_gambar') {
          const baru = { id: LAIN_ID, proyek_id: p.p_proyek_id, ...data, utama: !g.length || !!data.utama, urutan: data.urutan ?? g.length };
          state.tabel.ipro_gambar.push(baru);
          return { data: { ...baru }, error: null };
        }
        if (nama === 'ipro_hapus_gambar') state.tabel.ipro_gambar = state.tabel.ipro_gambar.filter(b => b !== target);
        else Object.assign(target!, data);
        return { data: { ...target }, error: null };
      } catch (error) {
        state.tabel.ipro_gambar = sebelum;
        return { data: null, error };
      }
    },
    from: (tabel: string) => {
      const catatan = { tabel, operasi: 'select', langkah: [] as [string, ...unknown[]][] };
      state.catatan.push(catatan);
      let nilai: Baris = {}, tunggal = false, batas = Infinity, mulai = 0;
      const filter: ((b: Baris) => boolean)[] = [];
      const q: Record<string, unknown> = {};
      for (const nama of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'range', 'maybeSingle', 'single']) {
        q[nama] = (...args: unknown[]) => {
          catatan.langkah.push([nama, ...args]);
          if (['insert', 'update', 'delete'].includes(nama)) { catatan.operasi = nama; nilai = (args[0] ?? {}) as Baris; }
          if (nama === 'eq') filter.push(b => b[String(args[0])] === args[1]);
          if (nama === 'neq') filter.push(b => b[String(args[0])] !== args[1]);
          if (nama === 'in') filter.push(b => (args[1] as unknown[]).includes(b[String(args[0])]));
          if (nama === 'maybeSingle' || nama === 'single') tunggal = true;
          if (nama === 'limit') batas = Number(args[0]);
          if (nama === 'range') { mulai = Number(args[0]); batas = Number(args[1]) - mulai + 1; }
          return q;
        };
      }
      q.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const run = () => {
          const error = galatOperasi(tabel, catatan.operasi);
          if (error) return { data: null, error };
          const semua = state.tabel[tabel] ?? [];
          let baris = semua.filter(b => filter.every(f => f(b)));
          if (catatan.operasi === 'insert') {
            if (tabel === 'ipro_proyek' && semua.some(b => b.slug === nilai.slug)) return { data: null, error: { code: '23505', message: 'ipro_proyek_slug_key' } };
            const baru = { id: LAIN_ID, versi: 1, ...nilai }; semua.push(baru); state.tabel[tabel] = semua; baris = [baru];
          } else if (catatan.operasi === 'update') {
            baris.forEach(b => Object.assign(b, nilai, tabel === 'ipro_proyek' ? { versi: Number(b.versi) + 1 } : {}));
          } else if (catatan.operasi === 'delete') state.tabel[tabel] = semua.filter(b => !baris.includes(b));
          const jumlah = baris.length;
          baris = baris.slice(mulai, mulai + batas).map(b => ({ ...b }));
          return { data: tunggal ? baris[0] ?? null : baris, error: null, count: jumlah };
        };
        return Promise.resolve().then(run).then(resolve, reject);
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, state };
}
