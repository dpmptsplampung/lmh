'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canAccessAdminPath } from '@/lib/admin-nav';

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
        .select('role')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (!petugas) {
        router.replace('/me');
        return;
      }

      if (!canAccessAdminPath(petugas.role as 'admin' | 'petugas', pathname)) {
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
