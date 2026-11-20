import { z } from 'zod';
import type { GambarIpro, IproAdmin } from '@/lib/data/investasi';
import { iproFoilaSchema, iproPtspSchema } from '@/lib/investasi/skema';
import { KAB_KOTA_IPRO, SEKTOR_IPRO } from '@/lib/investasi/konstanta';
import { validasiUrlFoila } from '@/lib/investasi/foila';

export function idSah(id: string) { return z.uuid().safeParse(id).success; }
export function kekuranganTerbit(proyek: IproAdmin, gambar: GambarIpro[]): string[] {
  const kurang: string[] = [];
  if (!KAB_KOTA_IPRO.includes(proyek.kab_kota)) kurang.push('kab_kota');
  if (!SEKTOR_IPRO.some(s => s.nilai === proyek.sektor)) kurang.push('sektor');
  if (proyek.sumber === 'foila') {
    if (!proyek.sumber_url || !validasiUrlFoila(proyek.sumber_url)) kurang.push('sumber_url');
    if (gambar.length !== 1) kurang.push('gambar');
  } else {
    if (!proyek.deskripsi?.trim()) kurang.push('deskripsi');
    if (!gambar.some(g => g.utama)) kurang.push('gambar_utama');
  }
  return kurang;
}
export function perubahanSah(proyek: IproAdmin, perubahan: Record<string, unknown>): boolean {
  const schema = proyek.sumber === 'foila' ? iproFoilaSchema : iproPtspSchema;
  if (!schema.partial().safeParse(perubahan).success) return false;
  const gabungan = { ...proyek, ...perubahan };
  const isian = Object.fromEntries(Object.keys(schema.shape).map(key => [key, gabungan[key as keyof typeof gabungan]]));
  if (!schema.safeParse(isian).success) return false;
  return proyek.sumber === 'foila' || (gabungan.lat == null) === (gabungan.lng == null);
}
