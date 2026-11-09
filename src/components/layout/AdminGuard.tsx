'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canAccessAdminPath, type AdminRole } from '@/lib/admin-nav';

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'allowed'>('checking');

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data: petugas } = await supabase
        .from('petugas')
        .select('role, aktif')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      // Petugas nonaktif tidak boleh mengakses area admin (I-22 / RBA-06).
      if (!petugas || petugas.aktif === false) {
        router.replace('/me');
        return;
      }

      // Kegagalan kolom modul baru tidak mengunci halaman staf yang sudah berjalan.
      let pemeriksaUmkm = false;
      try {
        const { data: flag, error } = await supabase.from('petugas')
          .select('pemeriksa_umkm').eq('auth_user_id', user.id).maybeSingle();
        pemeriksaUmkm = !error && flag?.pemeriksa_umkm === true;
      } catch { /* modul belum tersedia */ }
      // Halaman tugas menjelaskan penolakan API kepada staf; FO tetap ditolak di pintu ini.
      const halamanTugas = pathname === '/admin/umkm-tugas' || pathname.startsWith('/admin/umkm-tugas/');
      const stafTugas = halamanTugas && (petugas.role === 'admin' || petugas.role === 'petugas');
      if (!stafTugas && !canAccessAdminPath(petugas.role as AdminRole, pathname, { pemeriksa_umkm: pemeriksaUmkm })) {
        router.replace('/admin/antrian');
        return;
      }

      setState('allowed');
    }
    check();
  }, [pathname, router]);

  if (state === 'checking') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-16, 4rem)' }}>
        <Loader2 size={28} className="animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
