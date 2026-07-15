import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { ServerEnv } from '@/lib/env/server';

export function createServiceRoleClient(env: ServerEnv) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
