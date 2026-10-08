// Uji satu penyedia LLM (tombol "Uji" di konsol): status HTTP, latensi, cuplikan balasan, curl setara.
// Kunci pada curl SELALU tersamar; galat dipotong 200 karakter tanpa header/kunci.
import { buildChatBody, chatCompletionsUrl, type ProviderSpec } from '@/lib/llm/registry';
import { makeGuardedFetch } from '@/lib/settings/ssrf';
import { maskSecret } from '@/lib/settings/crypto';

export interface UjiHasil {
  ok: boolean;
  http_status: number | null;
  latensi_ms: number;
  cuplikan: string | null;
  error: string | null;
  tokens: { masuk: number | null; keluar: number | null } | null;
  curl: string;
}

const PROMPT_UJI = 'Balas dengan satu kata: SIAP';
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildCurl(spec: ProviderSpec, last4: string | null): string {
  const body = JSON.stringify(buildChatBody(spec, 'Anda asisten uji koneksi.', PROMPT_UJI));
  const parts = [`curl -sS -X POST ${shq(chatCompletionsUrl(spec))}`, `-H 'Content-Type: application/json'`];
  if (spec.apiKey) parts.push(`-H ${shq(`Authorization: Bearer ${maskSecret(last4)}`)}`);
  parts.push(`-d ${shq(body)}`);
  return parts.join(' \\\n  ');
}

export async function ujiPenyedia(
  spec: ProviderSpec,
  last4: string | null,
  fetcher?: typeof fetch,
): Promise<UjiHasil> {
  const curl = buildCurl(spec, last4);
  const f = fetcher ?? makeGuardedFetch({ timeoutMs: spec.timeoutMs ?? 15_000 });
  const t0 = Date.now();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (spec.apiKey) headers.Authorization = `Bearer ${spec.apiKey}`;
    const res = await f(chatCompletionsUrl(spec), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildChatBody(spec, 'Anda asisten uji koneksi.', PROMPT_UJI)),
    });
    const latensi_ms = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, http_status: res.status, latensi_ms, cuplikan: null, error: `Penyedia membalas status ${res.status}`, tokens: null, curl };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      ok: text.length > 0,
      http_status: res.status,
      latensi_ms,
      cuplikan: text ? text.slice(0, 200) : null,
      error: text ? null : 'Balasan kosong / format bukan OpenAI-compatible',
      tokens: data.usage ? { masuk: data.usage.prompt_tokens ?? null, keluar: data.usage.completion_tokens ?? null } : null,
      curl,
    };
  } catch (e) {
    return {
      ok: false, http_status: null, latensi_ms: Date.now() - t0, cuplikan: null,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200), tokens: null, curl,
    };
  }
}
