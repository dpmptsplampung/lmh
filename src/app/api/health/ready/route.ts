import { parseRuntimeEnv } from '@/lib/env/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createReadinessHandler } from './health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 5;

export function GET(): Promise<Response> {
  return createReadinessHandler({
    env: process.env,
    parseEnv: parseRuntimeEnv,
    createServiceClient: createServiceRoleClient,
    timeoutMs: 3_000,
  })();
}
