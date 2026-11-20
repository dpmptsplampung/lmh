import { KAB_KOTA_IPRO, SEKTOR_IPRO, TAHAP_KAJIAN } from '@/lib/investasi/konstanta';
import type { KartuPublik } from '@/lib/data/publik-server';

export type Saringan = { sektor: string; kab: string; tahap: string };
export const SARINGAN_KOSONG: Saringan = { sektor: '', kab: '', tahap: '' };

const SEKTOR_SAH = new Set<string>(SEKTOR_IPRO.map(s => s.nilai));
const TAHAP_SAH = new Set<string>(TAHAP_KAJIAN.map(t => t.nilai));
const KAB_SAH = new Set<string>(KAB_KOTA_IPRO);

/** Urai hash URL (`#sektor=energi&kab=Pesawaran`); nilai yang tidak dikenal dibuang. Hash lain (mis. `#peta-potensi`) = tanpa saringan. */
export function uraiHash(hash: string): Saringan {
  const teks = hash.replace(/^#/, '');
  if (!teks.includes('=')) return SARINGAN_KOSONG;
  const parameter = new URLSearchParams(teks);
  const ambil = (kunci: string, sah: Set<string>) => {
    const nilai = parameter.get(kunci) ?? '';
    return sah.has(nilai) ? nilai : '';
  };
  return { sektor: ambil('sektor', SEKTOR_SAH), kab: ambil('kab', KAB_SAH), tahap: ambil('tahap', TAHAP_SAH) };
}

/** Kebalikan `uraiHash`; saringan kosong menghasilkan string kosong (tanpa hash). */
export function susunHash(saringan: Saringan): string {
  const parameter = new URLSearchParams();
  if (saringan.sektor) parameter.set('sektor', saringan.sektor);
  if (saringan.kab) parameter.set('kab', saringan.kab);
  if (saringan.tahap) parameter.set('tahap', saringan.tahap);
  const teks = parameter.toString();
  return teks ? `#${teks}` : '';
}

export function terapkanSaringan(daftar: KartuPublik[], saringan: Saringan): KartuPublik[] {
  return daftar.filter(k =>
    (!saringan.sektor || k.sektor === saringan.sektor)
    && (!saringan.kab || k.kab_kota === saringan.kab)
    && (!saringan.tahap || k.tahap_kajian === saringan.tahap));
}

export const adaSaringan = (s: Saringan) => !!(s.sektor || s.kab || s.tahap);

/** Pilihan yang benar-benar ada di data (urutan mengikuti konstanta), agar pilihan tidak berujung hasil kosong. */
export function pilihanDari(daftar: KartuPublik[]) {
  const sektor = new Set(daftar.map(k => k.sektor));
  const kab = new Set(daftar.map(k => k.kab_kota));
  const tahap = new Set(daftar.map(k => k.tahap_kajian).filter((t): t is string => !!t));
  return {
    sektor: SEKTOR_IPRO.filter(s => sektor.has(s.nilai)).map(s => ({ nilai: s.nilai, label: s.id })),
    kab: KAB_KOTA_IPRO.filter(k => kab.has(k)).map(k => ({ nilai: k, label: k })),
    tahap: TAHAP_KAJIAN.filter(t => tahap.has(t.nilai)).map(t => ({ nilai: t.nilai, label: t.id })),
  };
}

export type RingkasPeta = {
  sektor: { nilai: string; label: string; jumlah: number; kab: string[] }[];
  kab: { nilai: string; jumlah: number }[];
};

/** Kisi Peta Potensi: jumlah proyek per sektor dan per kabupaten/kota dari data sebaran. */
export function ringkasPeta(sebaran: { sektor: string; kab_kota: string; jumlah: number }[]): RingkasPeta {
  const perSektor = new Map<string, { jumlah: number; kab: Set<string> }>();
  const perKab = new Map<string, number>();
  for (const s of sebaran) {
    const g = perSektor.get(s.sektor) ?? { jumlah: 0, kab: new Set<string>() };
    g.jumlah += s.jumlah; g.kab.add(s.kab_kota); perSektor.set(s.sektor, g);
    perKab.set(s.kab_kota, (perKab.get(s.kab_kota) ?? 0) + s.jumlah);
  }
  return {
    sektor: SEKTOR_IPRO.map(s => ({
      nilai: s.nilai, label: s.id, jumlah: perSektor.get(s.nilai)?.jumlah ?? 0, kab: [...(perSektor.get(s.nilai)?.kab ?? [])].sort(),
    })),
    kab: KAB_KOTA_IPRO.filter(k => perKab.has(k)).map(k => ({ nilai: k, jumlah: perKab.get(k) ?? 0 })),
  };
}
