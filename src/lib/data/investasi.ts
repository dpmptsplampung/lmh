import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { iproBuatSchema, iproUbahSchema } from '@/lib/investasi/skema';
import { MAKS_GAMBAR_PTSP } from '@/lib/investasi/konstanta';
import { buatSlug } from '@/lib/investasi/slug';
import { slugFoila, validasiUrlFoila } from '@/lib/investasi/foila';
import { MutasiError, mutasiBolehKosong } from '@/lib/supabase/mutate';

export const KOLOM_IPRO_KARTU = 'id, sumber, slug, judul, judul_en, ringkasan, ringkasan_en, sektor, kab_kota, nilai_investasi, mata_uang, nilai_teks, irr_persen, tahap_kajian, sumber_url, urutan, diterbitkan_pada';
export const KOLOM_IPRO_DETAIL = `${KOLOM_IPRO_KARTU}, deskripsi, deskripsi_en, lokasi_teks, lat, lng, pemilik, npv_nilai, payback_bulan, skema, status_lahan, luas_ha, perizinan, dokumen_id, kontak_instansi, kontak_email, kontak_telepon, diubah_pada`;
export const KOLOM_IPRO_ADMIN = `${KOLOM_IPRO_DETAIL}, status, sumber_slug, versi, dibuat_pada`;
export const KOLOM_GAMBAR = 'id, proyek_id, kunci, kunci_mini, lebar, tinggi, alt, alt_en, keterangan, keterangan_en, utama, urutan';
export const KOLOM_MINAT_DAFTAR = 'id, kanal, status, versi, nama, instansi, created_at, aktivitas_pada, petugas_id, ipro_id, doc_id, ipro_proyek(judul), investment_documents(judul)';
export const KOLOM_MINAT_DETAIL = `${KOLOM_MINAT_DAFTAR}, email, no_hp, catatan, minat`;
export const KOLOM_DOKUMEN = 'id, judul, kategori, deskripsi, nilai_investasi, jumlah_halaman, urutan_tampil';

export type IproKartu = {
  id: string; sumber: 'ptsp' | 'foila'; slug: string; judul: string; judul_en: string | null;
  ringkasan: string; ringkasan_en: string | null; sektor: string; kab_kota: string;
  nilai_investasi: number | null; mata_uang: 'IDR' | 'USD'; nilai_teks: string | null;
  irr_persen: number | null; tahap_kajian: string | null; sumber_url: string | null; urutan: number; diterbitkan_pada: string | null;
};
export type IproDetail = IproKartu & {
  deskripsi: string | null; deskripsi_en: string | null; lokasi_teks: string | null; lat: number | null; lng: number | null;
  pemilik: string | null; npv_nilai: number | null; payback_bulan: number | null; skema: string | null;
  status_lahan: string | null; luas_ha: number | null; perizinan: string | null; dokumen_id: string | null;
  kontak_instansi: string | null; kontak_email: string | null; kontak_telepon: string | null; diubah_pada: string;
};
export type IproAdmin = IproDetail & { status: 'draf' | 'terbit' | 'arsip'; sumber_slug: string | null; versi: number; dibuat_pada: string };
export type GambarIpro = { id: string; proyek_id: string; kunci: string; kunci_mini: string; lebar: number; tinggi: number;
  alt: string; alt_en: string | null; keterangan: string | null; keterangan_en: string | null; utama: boolean; urutan: number };
export type MinatRingkas = { id: string; kanal: 'ipro' | 'dokumen'; status: string; versi: number; nama: string;
  instansi: string | null; created_at: string; aktivitas_pada: string; petugas_id: string | null;
  ipro_id: string | null; doc_id: string | null; ipro_proyek: { judul: string } | null; investment_documents: { judul: string } | null };
export type MinatDetail = MinatRingkas & { email: string; no_hp: string | null; catatan: string | null; minat: string | null };
export type DokumenRingkas = { id: string; judul: string; kategori: string | null; deskripsi: string | null;
  nilai_investasi: string | null; jumlah_halaman: number | null; urutan_tampil: number };
export type GalatData = { code?: string; message: string; details?: string };
export type HasilInvestasi<T> = { data: T | null; error: GalatData | null; count?: number | null };
async function hasil<T>(query: PromiseLike<{ data: unknown; error: GalatData | null; count?: number | null }>): Promise<HasilInvestasi<T>> {
  try { const r = await query; return { data: r.data as T | null, error: r.error, ...(r.count !== undefined ? { count: r.count } : {}) }; }
  catch (error) {
    if (error instanceof MutasiError && error.asal && typeof error.asal === 'object' && 'message' in error.asal && typeof error.asal.message === 'string') {
      return { data: null, error: error.asal as GalatData };
    }
    return { data: null, error: { message: 'GAGAL_INTERNAL' } };
  }
}
// Nol baris pada mutasi proyek diperiksa pemanggil (404/409).
const hasilBaris = <T>(query: Promise<T[]>) => hasil<T>(query.then(baris => ({ data: baris[0] ?? null, error: null })));
const gagal = <T>(message: string): HasilInvestasi<T> => ({ data: null, error: { message } });
const rentangSah = (dari: number, sampai: number) => Number.isInteger(dari) && Number.isInteger(sampai) && dari >= 0 && sampai >= dari && sampai - dari < 100;

export function daftarIproTerbit(sb: SupabaseClient) {
  return hasil<IproKartu[]>(sb.from('ipro_proyek').select(KOLOM_IPRO_KARTU).eq('status', 'terbit')
    .order('urutan').order('diterbitkan_pada', { ascending: false }).limit(200));
}
export async function gambarUntukProyek(sb: SupabaseClient, ids: string[]) {
  if (!ids.length) return { data: [], error: null } as HasilInvestasi<GambarIpro[]>;
  if (ids.length > 200) return gagal<GambarIpro[]>('INPUT_TIDAK_VALID');
  return hasil<GambarIpro[]>(sb.from('ipro_gambar').select(KOLOM_GAMBAR).in('proyek_id', ids).order('urutan').limit(ids.length * MAKS_GAMBAR_PTSP));
}
export async function iproTerbitBySlug(sb: SupabaseClient, slug: string): Promise<HasilInvestasi<IproDetail & { gambar: GambarIpro[] }>> {
  const [proyek, gambar] = await Promise.all([
    hasil<IproDetail>(sb.from('ipro_proyek').select(KOLOM_IPRO_DETAIL).eq('slug', slug).eq('status', 'terbit').eq('sumber', 'ptsp').maybeSingle()),
    hasil<GambarIpro[]>(sb.from('ipro_gambar').select(`${KOLOM_GAMBAR}, ipro_proyek!inner(slug, status, sumber)`)
      .eq('ipro_proyek.slug', slug).eq('ipro_proyek.status', 'terbit').eq('ipro_proyek.sumber', 'ptsp').order('urutan').limit(MAKS_GAMBAR_PTSP)),
  ]);
  if (proyek.error || gambar.error) return { data: null, error: proyek.error ?? gambar.error };
  return { data: proyek.data ? { ...proyek.data, gambar: gambar.data ?? [] } : null, error: null };
}
export function daftarIproKelola(sb: SupabaseClient, opsi: { status?: string; sumber?: string; cari?: string; dari: number; sampai: number }) {
  if (!rentangSah(opsi.dari, opsi.sampai)) return Promise.resolve(gagal<IproAdmin[]>('INPUT_TIDAK_VALID'));
  let query = sb.from('ipro_proyek').select(KOLOM_IPRO_ADMIN, { count: 'exact' });
  if (opsi.status) query = query.eq('status', opsi.status);
  if (opsi.sumber) query = query.eq('sumber', opsi.sumber);
  if (opsi.cari) query = query.ilike('judul', `%${opsi.cari.replace(/[\\%_]/g, '\\$&')}%`);
  return hasil<IproAdmin[]>(query.order('urutan').order('dibuat_pada', { ascending: false }).range(opsi.dari, opsi.sampai));
}
export async function iproKelolaById(sb: SupabaseClient, id: string): Promise<HasilInvestasi<IproAdmin & { gambar: GambarIpro[] }>> {
  const [proyek, gambar] = await Promise.all([
    hasil<IproAdmin>(sb.from('ipro_proyek').select(KOLOM_IPRO_ADMIN).eq('id', id).maybeSingle()),
    hasil<GambarIpro[]>(sb.from('ipro_gambar').select(KOLOM_GAMBAR).eq('proyek_id', id).order('urutan').limit(MAKS_GAMBAR_PTSP + 1)),
  ]);
  if (proyek.error || gambar.error) return { data: null, error: proyek.error ?? gambar.error };
  return { data: proyek.data ? { ...proyek.data, gambar: gambar.data ?? [] } : null, error: null };
}
export function daftarMinat(sb: SupabaseClient, opsi: { kanal?: string; status?: string; dari: number; sampai: number }) {
  if (!rentangSah(opsi.dari, opsi.sampai)) return Promise.resolve(gagal<MinatRingkas[]>('INPUT_TIDAK_VALID'));
  let query = sb.from('investasi_lead').select(KOLOM_MINAT_DAFTAR, { count: 'exact' });
  if (opsi.kanal) query = query.eq('kanal', opsi.kanal);
  if (opsi.status) query = query.eq('status', opsi.status);
  return hasil<MinatRingkas[]>(query.order('created_at', { ascending: false }).range(opsi.dari, opsi.sampai));
}
export const minatById = (sb: SupabaseClient, id: string) => hasil<MinatDetail>(sb.from('investasi_lead').select(KOLOM_MINAT_DETAIL).eq('id', id).maybeSingle());
export const ubahStatusMinat = (sb: SupabaseClient, id: string, status: string, versi: number) =>
  hasil<{ id: string; status: string; versi: number }>(sb.rpc('investasi_ubah_status_minat', { p_id: id, p_status: status, p_versi: versi }));
export function daftarDokumenAktif(sb: SupabaseClient, batas = 12) {
  return hasil<DokumenRingkas[]>(sb.from('investment_documents').select(KOLOM_DOKUMEN).eq('status', 'aktif')
    .order('urutan_tampil').limit(Number.isFinite(batas) ? Math.max(1, Math.min(200, Math.floor(batas))) : 12));
}

function denganSumber(input: Record<string, unknown>): Record<string, unknown> {
  if (input.sumber !== 'foila' && !input.sumber_url) return input;
  const url = validasiUrlFoila(String(input.sumber_url));
  if (!url) throw new Error('INPUT_TIDAK_VALID');
  return { ...input, sumber_url: url.toString(), sumber_slug: slugFoila(url.toString()) };
}
export async function buatIpro(sb: SupabaseClient, input: z.output<typeof iproBuatSchema>) {
  let data: Record<string, unknown>;
  try { data = denganSumber(input); } catch { return gagal<IproAdmin>('INPUT_TIDAK_VALID'); }
  for (let nomor = 1; nomor <= 30; nomor++) {
    const slug = input.slug ?? buatSlug(input.judul, nomor);
    const r = await hasil<IproAdmin>(sb.from('ipro_proyek').insert({ ...data, slug, status: 'draf' }).select(KOLOM_IPRO_ADMIN).single());
    if (r.error?.code !== '23505' || input.slug || (r.error.message.includes('ipro_foila_unik'))) return r;
    // Bentrok slug bisa dicoba ulang; konflik sumber FOILA tidak mengganti identitas proyek.
    if (input.sumber === 'foila') {
      const lama = await hasil<{ id: string }>(sb.from('ipro_proyek').select('id').eq('sumber_slug', data.sumber_slug).eq('sumber', 'foila').maybeSingle());
      if (lama.error || lama.data) return lama.error ? { data: null, error: lama.error } : r;
    }
  }
  return gagal<IproAdmin>('KONFLIK_STATUS');
}
async function cekKonflik(sb: SupabaseClient, id: string): Promise<HasilInvestasi<IproAdmin>> {
  const ada = await hasil<{ id: string }>(sb.from('ipro_proyek').select('id').eq('id', id).maybeSingle());
  return ada.error ? { data: null, error: ada.error } : gagal(ada.data ? 'KONFLIK_VERSI' : 'TIDAK_DITEMUKAN');
}
export async function ubahIpro(sb: SupabaseClient, id: string, input: z.output<typeof iproUbahSchema>) {
  const { versi, ...perubahan } = input;
  let data: Record<string, unknown>;
  try { data = denganSumber(perubahan); } catch { return gagal<IproAdmin>('INPUT_TIDAK_VALID'); }
  const r = await hasilBaris(mutasiBolehKosong<IproAdmin>(sb.from('ipro_proyek').update(data).eq('id', id).eq('versi', versi).select(KOLOM_IPRO_ADMIN).maybeSingle()));
  return !r.error && !r.data ? cekKonflik(sb, id) : r;
}
export const ubahStatusIpro = (sb: SupabaseClient, id: string, status: string, versi: number) =>
  hasil<IproAdmin>(sb.rpc('ipro_ubah_status', { p_proyek_id: id, p_status: status, p_versi: versi }));
export async function hapusIpro(sb: SupabaseClient, id: string, versi: number) {
  const r = await hasilBaris(mutasiBolehKosong<{ id: string }>(sb.from('ipro_proyek').delete().eq('id', id).eq('status', 'draf').eq('versi', versi).select('id').maybeSingle()));
  if (r.error || r.data) return r;
  return cekKonflik(sb, id);
}
export const simpanGambar = (sb: SupabaseClient, proyekId: string,
  data: Omit<GambarIpro, 'id' | 'proyek_id' | 'urutan'> & { urutan?: number }) =>
  hasil<GambarIpro>(sb.rpc('ipro_tambah_gambar', { p_proyek_id: proyekId, p_data: data }));
export const ubahGambar = (sb: SupabaseClient, proyekId: string, id: string,
  data: Partial<Pick<GambarIpro, 'alt' | 'alt_en' | 'keterangan' | 'keterangan_en' | 'utama' | 'urutan'>>) =>
  hasil<GambarIpro>(sb.rpc('ipro_ubah_gambar', { p_proyek_id: proyekId, p_gambar_id: id, p_data: data }));
export const hapusGambar = (sb: SupabaseClient, proyekId: string, id: string) =>
  hasil<Pick<GambarIpro, 'id' | 'kunci' | 'kunci_mini'>>(sb.rpc('ipro_hapus_gambar', { p_proyek_id: proyekId, p_gambar_id: id }));
