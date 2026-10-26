import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { json, requireAdmin, requireStaf } from '@/lib/akun/server';
import { layananBuatSchema, type InstansiRow, type LayananAdmin } from '@/lib/layanan/schemas';
import { kolomHomepageBelumAda, petaGalatTulisLayanan } from './_galat';

export const dynamic = 'force-dynamic';

const KOLOM_LAYANAN =
  'id, nama, tipe, aktif, penyerta, status_tampilan, tampil_di_layar, tampil_di_homepage, punya_antrean, punya_chat, chatbot_aktif, nomor_loket, prefiks_antrean, form_pendataan, instansi_id, slug, deskripsi, urutan, konten_sumber_url, konten_diperbarui_at, diarsipkan_at, layanan_tautan(label, url, urut)';

const KOLOM_LAYANAN_TANPA_HOMEPAGE = KOLOM_LAYANAN.replace(' tampil_di_homepage,', '');

type BarisLayanan = Omit<LayananAdmin, 'website_terkait'> & {
  layanan_tautan: Array<{ label: string; url: string; urut: number }> | null;
};

// GET daftar layanan (termasuk yang diarsipkan: aktif=false) + daftar instansi untuk halaman Kelola Layanan.
// Admin: kelola; Front Office: hanya lihat. Petugas: ditolak.
export async function GET() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  if (g.me.role !== 'admin' && g.me.role !== 'front_office') return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const [layPertama, ins] = await Promise.all([
    supabase.from('layanan').select(KOLOM_LAYANAN).order('urutan').order('nama'),
    supabase.from('instansi').select('id, nama, singkatan').order('nama'),
  ]);
  // Migrasi 202610280001 belum diterapkan: kolom tampil_di_homepage belum ada -> ulangi tanpa kolom itu
  // (dianggap true) supaya halaman Kelola Layanan tidak ikut rusak.
  const lay: { data: unknown; error: { message: string } | null } = layPertama.error
    ? await supabase.from('layanan').select(KOLOM_LAYANAN_TANPA_HOMEPAGE).order('urutan').order('nama')
    : layPertama;
  if (lay.error || ins.error) {
    console.error('[admin/layanan GET] gagal', (lay.error ?? ins.error)?.message);
    return json({ error: 'Gagal memuat layanan' }, 500);
  }
  const layanan: LayananAdmin[] = ((lay.data ?? []) as unknown as BarisLayanan[]).map(({ layanan_tautan, ...baris }) => ({
    ...baris,
    tampil_di_homepage: baris.tampil_di_homepage !== false,
    website_terkait: [...(layanan_tautan ?? [])]
      .sort((a, b) => a.urut - b.urut)
      .map((t) => ({ label: t.label, url: t.url })),
  }));
  return json({ layanan, instansi: (ins.data ?? []) as InstansiRow[], bisa_ubah: g.me.role === 'admin' });
}

// POST buat layanan baru (Admin). Ditulis lewat sesi Admin sendiri (RLS layanan_admin_all) agar trigger audit
// mencatat pelaku. Slug kosong -> diisi trigger dari nama; prefiks kosong -> diisi trigger. form_pendataan
// dikirim apa adanya (null = tanpa formulir tetap): trigger tebakan dari nama sudah dicabut.
export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = layananBuatSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    // Galat prefiks dijelaskan langsung (form menampilkannya di bawah isian prefiks).
    const galatPrefiks = (details as Record<string, string[] | undefined>).prefiks?.[0];
    return json({ error: galatPrefiks ?? 'Invalid input', details }, 400);
  }
  const { prefiks, form_pendataan, ...rest } = parsed.data;
  const baris: Record<string, unknown> = { ...rest, form_pendataan: form_pendataan ?? null };
  if (prefiks !== undefined) baris.prefiks_antrean = prefiks;
  if (rest.deskripsi != null || rest.konten_sumber_url != null) baris.konten_diperbarui_at = new Date().toISOString();

  const supabase = await createClient();
  const sisipkan = (b: Record<string, unknown>) =>
    mutasiInsert<{ id: string; slug: string }>(supabase.from('layanan').insert(b).select('id, slug').single());
  try {
    let dibuat;
    try {
      dibuat = await sisipkan(baris);
    } catch (e) {
      // Migrasi 202610280001 belum diterapkan: ulangi tanpa saklar homepage (layanan baru tampil secara bawaan).
      if (!(e instanceof MutasiError) || !('tampil_di_homepage' in baris) || !kolomHomepageBelumAda(e)) throw e;
      const { tampil_di_homepage: _abaikan, ...tanpaSaklar } = baris;
      void _abaikan;
      dibuat = await sisipkan(tanpaSaklar);
    }
    const satu = dibuat[0];
    if (!satu) return json({ error: 'Gagal membuat layanan' }, 500);
    return json({ id: satu.id, slug: satu.slug }, 201);
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    const galat = petaGalatTulisLayanan(e);
    if (galat) return json(galat.body, galat.status);
    catatMutasiGagal('/api/admin/layanan', 'admin.layanan.buat', e);
    return json({ error: 'Gagal membuat layanan' }, 500);
  }
}
