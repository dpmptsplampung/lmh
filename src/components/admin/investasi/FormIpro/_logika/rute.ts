import type { SumberIpro } from './nilai-form';

// admin = /admin/ipro, petugas = /petugas/investasi/ipro (padanan di admin-nav.ts).
export const HREF_DAFTAR_IPRO = { admin: '/admin/ipro', petugas: '/petugas/investasi/ipro' } as const;
export type BasisIpro = keyof typeof HREF_DAFTAR_IPRO;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const idIproSah = (id: string) => UUID.test(id);

// `?sumber=` pada /baru: hanya foila yang mengubah bawaan ptsp; nilai lain (termasuk larik) diabaikan.
export function sumberDariParam(nilai: string | string[] | undefined): SumberIpro {
  return nilai === 'foila' ? 'foila' : 'ptsp';
}
