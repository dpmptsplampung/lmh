// Kanal pengaduan publik (Server Component ber-cache). Daftar layanan dimuat di server lewat muatOpsiLayananPengaduan()
// (klien anon tanpa cookie, unstable_cache 60 detik, tag publik-layanan) dan dioper sebagai data biasa ke formulir
// klien (FormPengaduan.tsx). Halaman tidak membaca sesi/cookies/headers. Ikon dirender di sini sebagai elemen JSX
// (komponen ikon tidak boleh dioper sebagai prop ke komponen klien).
import Link from 'next/link';
import { ClipboardList, ShieldAlert } from 'lucide-react';
import { muatOpsiLayananPengaduan } from '@/lib/data/publik-server';
import FormPengaduan from './FormPengaduan';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

export default async function PengaduanPage() {
  // Galat memuat daftar = pilihan hanya "Umum / tidak spesifik" (sama dengan perilaku lama bila kueri gagal).
  const { layanan } = await muatOpsiLayananPengaduan();

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
        <ShieldAlert size={28} style={{ color: 'var(--color-primary-500)', flexShrink: 0, marginTop: 4 }} />
        <div>
          <h1 style={{ margin: 0 }}>Kanal Pengaduan</h1>
          <p style={{ margin: 0, color: 'var(--color-neutral-500)' }}>
            Sampaikan keluhan layanan atau laporan integritas. Sesuai UU 25/2009 tentang Pelayanan Publik.
          </p>
        </div>
      </div>
      <FormPengaduan layanan={layanan} />
      <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
        <Link href="/pengaduan/lacak" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
          <ClipboardList size={14} /> Sudah punya tiket? Lacak status pengaduan
        </Link>
      </p>
    </main>
  );
}
