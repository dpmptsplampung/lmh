// Pembaca konfigurasi LLM aktif dari DB (server-only), cache 60 dtk per instance.
// Fallback berlapis (D.4): DB gagal -> nilai terakhir di memori -> null (pemanggil memakai env lama).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderSpec } from '@/lib/llm/registry';
import { logServerEvent } from '@/lib/observability/logger';
import { decryptSecret } from '@/lib/settings/crypto';
import { LLM_KUNCI, entryToSpec, hostEntri, rantaiSchema } from '@/lib/settings/llm-schema';

export const LLM_CACHE_TTL_MS = 60_000;
const RETRY_AFTER_ERROR_MS = 15_000;

let cache: { at: number; specs: ProviderSpec[] | null } | null = null;

export function resetLlmConfigCache() {
  cache = null;
}

type RahasiaRow = { id: string; ciphertext: string; iv: string; tag: string; host?: string | null };

/** Ambil rahasia terdekripsi per id. Gagal dekripsi -> entri dilewati (tanpa mencetak nilai). */
export async function loadSecrets(service: SupabaseClient, ids: string[], hosts?: Map<string, string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await service.from('rahasia_pengaturan').select('id, ciphertext, iv, tag, host').in('id', ids);
  if (error) throw new Error(`rahasia: ${error.message}`);
  for (const r of (data ?? []) as RahasiaRow[]) {
    hosts?.set(r.id, r.host ?? null);
    try {
      out.set(r.id, decryptSecret(r));
    } catch {
      logServerEvent('warn', { operation: 'settings.decrypt_failed', secretId: r.id });
    }
  }
  return out;
}

async function muat(service: SupabaseClient): Promise<ProviderSpec[] | null> {
  const { data, error } = await service
    .from('pengaturan_sistem')
    .select('nilai')
    .eq('kunci', LLM_KUNCI)
    .eq('status', 'aktif')
    .maybeSingle();
  if (error) throw new Error(`pengaturan: ${error.message}`);
  if (!data) return null; // belum ada konfigurasi -> env
  const parsed = rantaiSchema.safeParse(data.nilai);
  if (!parsed.success) throw new Error('konfigurasi LLM aktif tidak valid');
  const aktif = parsed.data.filter((e) => e.aktif);
  const hosts = new Map<string, string | null>();
  const secrets = await loadSecrets(service, aktif.map((e) => e.rahasia_id).filter((x): x is string => !!x), hosts);
  const specs: ProviderSpec[] = [];
  for (const e of aktif) {
    let key: string | undefined;
    if (e.rahasia_id) {
      const terikat = hosts.get(e.rahasia_id);
      if (terikat && terikat !== hostEntri(e)) {
        logServerEvent('warn', { operation: 'settings.secret_host_mismatch', secretId: e.rahasia_id });
        continue; // kunci tidak dikirim ke host selain yang terikat
      }
      key = secrets.get(e.rahasia_id);
      if (!key) continue; // rahasia hilang/tak terbaca: lewati, rantai berikutnya jalan
    } else if (e.tipe === 'gemini') {
      key = process.env.GEMINI_API_KEY || undefined;
      if (!key) continue;
    }
    specs.push(entryToSpec(e, key));
  }
  return specs.length > 0 ? specs : null;
}

/** null = pakai jalur env lama (SDK Gemini + LLM_CHAT_PROVIDERS). */
export async function getLlmSpecs(service: SupabaseClient, nowMs: number = Date.now()): Promise<ProviderSpec[] | null> {
  if (cache && nowMs - cache.at < LLM_CACHE_TTL_MS) return cache.specs;
  try {
    const specs = await muat(service);
    cache = { at: nowMs, specs };
    return specs;
  } catch (e) {
    logServerEvent('warn', { operation: 'settings.llm_load_failed', cause: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    // Pertahankan nilai terakhir; coba lagi sebentar lagi.
    cache = { at: nowMs - (LLM_CACHE_TTL_MS - RETRY_AFTER_ERROR_MS), specs: cache?.specs ?? null };
    return cache.specs;
  }
}
