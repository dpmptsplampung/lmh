// Pembacaan galat RPC kontrak FO/Eskalasi (docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §0.2).
//
// Server menaruh KODE galat di AWAL pesan ("SUDAH_DIAMBIL: ..."). supabase-js tidak melempar: galat
// kembali sebagai `{ error }`. Modul ini MURNI (tanpa supabase/logger) agar aman di klien dan di test.
import { MutasiError, mutasiInsert, type HasilQuery } from '@/lib/supabase/mutate';

/** Kode dari awal pesan, mis. "LAYANAN_TUTUP: Layanan ..." -> "LAYANAN_TUTUP"; null bila tidak berpola kode. */
export function kodeDariPesan(message: string | null | undefined): string | null {
  const cocok = /^([A-Z][A-Z0-9_]{2,})(?::|\s|$)/.exec(message ?? '');
  return cocok ? cocok[1] : null;
}

export class GalatRpc extends Error {
  /** Kode kontrak (mis. LAYANAN_TUTUP) atau null bila tidak dikenali. */
  readonly kode: string | null;
  /** true = kegagalan transport (koneksi): hasil di server TIDAK diketahui, aman diulang bila idempoten. */
  readonly jaringan: boolean;
  readonly asal?: unknown;

  constructor(kode: string | null, opsi: { jaringan?: boolean; pesan?: string; asal?: unknown } = {}) {
    super(opsi.pesan ?? kode ?? 'Galat RPC');
    this.name = 'GalatRpc';
    this.kode = kode;
    this.jaringan = opsi.jaringan ?? false;
    this.asal = opsi.asal;
  }
}

/**
 * Menjalankan satu panggilan `supabase.rpc(...)` dan MELEMPAR `GalatRpc` bila gagal (galat server,
 * kegagalan jaringan, atau balasan tanpa `ok: true`). Mengembalikan objek jsonb balasan.
 * Dibungkus `mutasiInsert` agar klasifikasi jaringan/penolakan memakai satu sumber kebenaran.
 */
export async function jalankanRpc(query: PromiseLike<HasilQuery<unknown>>): Promise<Record<string, unknown>> {
  let baris: unknown[];
  try {
    baris = await mutasiInsert(query);
  } catch (e) {
    if (e instanceof MutasiError) {
      const asal = e.asal as { message?: string } | undefined;
      throw new GalatRpc(kodeDariPesan(asal?.message), {
        jaringan: e.kode === 'jaringan',
        pesan: asal?.message,
        asal: e.asal,
      });
    }
    throw new GalatRpc(null, { asal: e });
  }
  const hasil = baris[0];
  if (
    typeof hasil !== 'object' ||
    hasil === null ||
    (hasil as { ok?: unknown }).ok !== true
  ) {
    throw new GalatRpc('RESPON_TIDAK_VALID', { asal: hasil });
  }
  return hasil as Record<string, unknown>;
}
