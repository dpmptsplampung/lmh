import { revalidateTag } from 'next/cache';
import { iproKelolaById, simpanGambar } from '@/lib/data/investasi';
import { layaniKelola, type IdContext } from '@/lib/investasi/akses-server';
import { hapusObjekGambar, kunciMentahSah, olahGambarIpro } from '@/lib/investasi/gambar-server';
import { bacaJson, galat, kodeRpc, sukses } from '@/lib/investasi/http';
import { gambarSchema } from '@/lib/investasi/skema';
import { MAKS_GAMBAR_PTSP } from '@/lib/investasi/konstanta';
import { logServerEvent } from '@/lib/observability/logger';
import { idSah } from '../../server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export async function POST(request: Request, context: IdContext) {
  return layaniKelola(async (sb, requestId) => {
    const { id } = await context.params;
    const parsed = gambarSchema.safeParse(await bacaJson(request));
    if (!idSah(id) || !parsed.success || !kunciMentahSah(parsed.data.kunci_mentah, id)) return galat('INPUT_TIDAK_VALID', requestId);
    const proyek = await iproKelolaById(sb, id);
    if (proyek.error) return galat(kodeRpc(proyek.error), requestId);
    if (!proyek.data) return galat('TIDAK_DITEMUKAN', requestId);
    const batas = proyek.data.sumber === 'foila' ? 1 : MAKS_GAMBAR_PTSP;
    // Ini hanya penolakan dini; RPC menghitung ulang batas dan utama di bawah lock.
    if (proyek.data.gambar.length >= batas) return galat('KONFLIK_STATUS', requestId);
    const olahan = await olahGambarIpro(id, parsed.data.kunci_mentah);
    const { kunci_mentah: _mentah, ...isian } = parsed.data;
    const hasil = await simpanGambar(sb, id, { ...olahan, ...isian, alt_en: isian.alt_en ?? null,
      keterangan: isian.keterangan ?? null, keterangan_en: isian.keterangan_en ?? null,
      utama: isian.utama ?? false });
    if (hasil.error) {
      const kunci = [olahan.kunci, olahan.kunci_mini];
      // Galat SQL memastikan rollback; jaringan putus bisa terjadi sesudah commit.
      if (hasil.error.code && /^(22|23|40|42|55|P0)/.test(hasil.error.code)) await hapusObjekGambar(kunci);
      else logServerEvent('warn', { operation: 'investasi.gambar.commit_tidak_pasti', requestId, kunci });
      return galat(kodeRpc(hasil.error), requestId);
    }
    revalidateTag('publik-investasi', { expire: 0 });
    return sukses(hasil.data, 201);
  });
}
