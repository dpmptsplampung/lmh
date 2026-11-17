'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { bolehAksesRute, butuhModulUntukRute, type AdminRole, type ModulLayanan } from '@/lib/admin-nav';
import { berandaTolak } from '@/lib/rute-peran';

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

      // Petugas nonaktif tidak boleh mengakses area staf (I-22 / RBA-06).
      if (!petugas || petugas.aktif === false) {
        router.replace('/me');
        return;
      }

      // Lapisan UX di atas proxy.ts (yang menegakkan rute di server, fail-closed): halaman yang tidak boleh
      // dibuka peran ini langsung dialihkan. Modul layanan (staf_modul()) hanya dibaca untuk rute modul;
      // galatnya dianggap tanpa modul (rute modul ditolak, halaman lain tidak terganggu).
      const peran = petugas.role as AdminRole;
      let modul: ModulLayanan | null = null;
      if (butuhModulUntukRute(peran, pathname)) {
        try {
          const { data, error } = await supabase.rpc('staf_modul');
          modul = !error && (data === 'umkm' || data === 'investasi') ? data : null;
        } catch { /* modul belum tersedia */ }
      }
      if (!bolehAksesRute(peran, pathname, { modul })) {
        router.replace(berandaTolak(peran));
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
