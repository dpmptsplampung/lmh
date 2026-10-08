// Skema & penyaring konfigurasi rantai LLM (kunci 'llm.rantai_chat'). Urutan array = prioritas.
import { z } from 'zod';
import { maskSecret } from '@/lib/settings/crypto';
import type { ProviderSpec } from '@/lib/llm/registry';

export const LLM_KUNCI = 'llm.rantai_chat';
export const GEMINI_OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

// Preset untuk dropdown layar (base URL otomatis, tetap bisa disunting; "kustom" = isi sendiri).
export const LLM_PRESETS = [
  { id: 'gemini', label: 'Gemini', tipe: 'gemini', base_url: GEMINI_OPENAI_URL, model_contoh: 'gemini-flash-latest' },
  { id: 'groq', label: 'Groq', tipe: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', model_contoh: 'llama-3.3-70b-versatile' },
  { id: 'openrouter', label: 'OpenRouter', tipe: 'openai_compat', base_url: 'https://openrouter.ai/api/v1', model_contoh: '' },
  { id: 'mistral', label: 'Mistral', tipe: 'openai_compat', base_url: 'https://api.mistral.ai/v1', model_contoh: 'mistral-small-latest' },
  { id: 'kustom', label: 'Gateway kustom (kompatibel OpenAI)', tipe: 'openai_compat', base_url: '', model_contoh: '' },
] as const;

export const entrySchema = z
  .object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(60),
    tipe: z.enum(['gemini', 'openai_compat']),
    base_url: z.string().trim().max(300).nullable().optional(),
    model: z.string().trim().min(1).max(120),
    rahasia_id: z.uuid().nullable().optional(),
    aktif: z.boolean(),
    kuota_harian: z.int().min(1).max(1_000_000).nullable().optional(),
    suhu: z.number().min(0).max(2).optional(),
    batas_waktu_ms: z.int().min(1000).max(60_000).optional(),
  })
  .strict();

export const rantaiSchema = z
  .array(entrySchema)
  .min(1)
  .max(12)
  .refine((a) => new Set(a.map((e) => e.id)).size === a.length, 'id entri harus unik')
  .refine((a) => new Set(a.map((e) => e.label.toLowerCase())).size === a.length, 'label entri harus unik')
  .refine((a) => a.every((e) => e.tipe === 'gemini' || !!e.base_url), 'base_url wajib untuk gateway kompatibel OpenAI');

export type LlmEntry = z.infer<typeof entrySchema>;

/** URL efektif: entri gemini selalu memakai endpoint resmi. */
export const baseUrlEfektif = (e: LlmEntry): string => (e.tipe === 'gemini' ? GEMINI_OPENAI_URL : (e.base_url ?? '')).replace(/\/+$/, '');

export function entryToSpec(e: LlmEntry, apiKey: string | undefined): ProviderSpec {
  return {
    name: e.label,
    baseURL: baseUrlEfektif(e),
    apiKeyEnv: '',
    apiKey,
    model: e.model,
    guarded: true,
    dailyLimit: e.kuota_harian ?? undefined,
    temperature: e.suhu,
    timeoutMs: e.batas_waktu_ms,
  };
}

/** Bentuk aman untuk browser: tanpa kunci; hanya penanda tersamar + apakah ada kunci. */
export function sanitizeEntries(entries: unknown, last4ById: Map<string, string>) {
  if (!Array.isArray(entries)) return [];
  return entries.map((raw) => {
    const e = raw as LlmEntry;
    const punya = !!e.rahasia_id && last4ById.has(e.rahasia_id);
    return { ...e, punya_kunci: punya, kunci_tersamar: punya ? maskSecret(last4ById.get(e.rahasia_id as string)) : null };
  });
}

/** Host (huruf kecil) dari URL; null bila bukan URL valid. Dipakai mengikat rahasia ke host tujuan. */
export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase() || null; } catch { return null; }
}
/** Host tujuan efektif entri (gemini = host resmi). */
export const hostEntri = (e: LlmEntry): string | null => hostOf(baseUrlEfektif(e));
