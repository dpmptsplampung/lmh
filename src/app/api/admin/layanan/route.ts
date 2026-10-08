import { createClient } from '@/lib/supabase/server';
import { json, requireStaf } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const KOLOM_LAYANAN =
  'id, nama, tipe, aktif, penyerta, status_tampilan, tampil_di_layar, punya_antrean, punya_chat, chatbot_aktif, nomor_loket, prefiks_antrean';

// GET daftar layanan untuk halaman Kelola Layanan. Admin: kelola; Front Office: hanya lihat. Petugas: ditolak.
export async function GET() {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  if (g.me.role !== 'admin' && g.me.role !== 'front_office') return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const { data, error } = await supabase.from('layanan').select(KOLOM_LAYANAN).order('nama');
  if (error) {
    console.error('[admin/layanan GET] gagal', error.message);
    return json({ error: 'Gagal memuat layanan' }, 500);
  }
  return json({ layanan: data ?? [], bisa_ubah: g.me.role === 'admin' });
}
