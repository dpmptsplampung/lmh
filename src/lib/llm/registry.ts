// Fase 1b — Rantai penyedia LLM dengan pemutus arus & kuota harian.
// Prinsip: tidak ada satu pun kegagalan vendor yang membuat bot bisu.
// Semua penyedia non-gemini memakai protokol OpenAI-compatible (chat
// completions) sehingga menambah vendor = baris env, bukan kode baru.

import { todayWIB } from '@/lib/time';
import { logServerEvent } from '@/lib/observability/logger';
import { makeGuardedFetch } from '@/lib/settings/ssrf';

function failCause(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

export interface ProviderSpec {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  model: string;
  // Hanya untuk penyedia dari konsol Admin (DB): kunci sudah didekripsi, panggilan lewat penjaga SSRF.
  apiKey?: string;
  guarded?: boolean;
  dailyLimit?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ProviderState {
  failStreak: number;
  cooldownUntil: number;
  usedToday: number;
  day: string;
}

export const MAX_FAIL_STREAK = 3;
export const COOLDOWN_MS = 10 * 60 * 1000;
export const DEFAULT_DAILY_LIMIT = 200;

const PROVIDER_DEFAULTS: Record<string, { baseURL: string; apiKeyEnv: string }> = {
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  groq: { baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
  mistral: { baseURL: 'https://api.mistral.ai/v1', apiKeyEnv: 'MISTRAL_API_KEY' },
  ollama: { baseURL: 'http://127.0.0.1:11434/v1', apiKeyEnv: '' },
};

// Format env: "gemini:gemini-flash-latest, groq:llama-3.3-70b-versatile, ..."
// (urutan = prioritas). Base URL & env kunci punya default per provider;
// dapat dioverride "provider:model@NAMA_ENV_KUNCI".
export function parseChatProviderSpec(spec: string | undefined): ProviderSpec[] {
  if (!spec || !spec.trim()) {
    const d = PROVIDER_DEFAULTS.gemini;
    return [{
      name: 'gemini',
      baseURL: d.baseURL,
      apiKeyEnv: d.apiKeyEnv,
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    }];
  }
  return spec
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, rest] = entry.split(':', 2);
      const [model, keyEnvOverride] = (rest ?? '').split('@');
      const d = PROVIDER_DEFAULTS[name] ?? {
        baseURL: process.env[`${name.toUpperCase()}_BASE_URL`] ?? '',
        apiKeyEnv: `${name.toUpperCase()}_API_KEY`,
      };
      return {
        name,
        baseURL: d.baseURL,
        apiKeyEnv: keyEnvOverride || d.apiKeyEnv,
        model: model || process.env[`${name.toUpperCase()}_MODEL`] || '',
      };
    });
}

/** URL chat completions untuk sebuah penyedia (dipakai panggilan nyata & pengujian/curl). */
export const chatCompletionsUrl = (spec: Pick<ProviderSpec, 'baseURL'>): string =>
  `${spec.baseURL.replace(/\/+$/, '')}/chat/completions`;

export function buildChatBody(spec: Pick<ProviderSpec, 'model' | 'temperature'>, system: string, prompt: string) {
  return {
    model: spec.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: spec.temperature ?? 0.4,
  };
}

export function getState(states: Map<string, ProviderState>, name: string): ProviderState {
  let st = states.get(name);
  if (!st) {
    st = { failStreak: 0, cooldownUntil: 0, usedToday: 0, day: todayWIB() };
    states.set(name, st);
  }
  return st;
}

export function resetIfNewDay(st: ProviderState): void {
  const today = todayWIB();
  if (st.day !== today) {
    st.day = today;
    st.usedToday = 0;
  }
}

export function canAttempt(st: ProviderState, now: number, dailyLimit: number): boolean {
  resetIfNewDay(st);
  if (st.usedToday >= dailyLimit) return false;
  return now >= st.cooldownUntil;
}

export function recordSuccess(st: ProviderState): void {
  st.failStreak = 0;
  st.usedToday += 1;
}

export function recordFailure(st: ProviderState, now: number): void {
  st.failStreak += 1;
  if (st.failStreak >= MAX_FAIL_STREAK) {
    st.cooldownUntil = now + COOLDOWN_MS;
    st.failStreak = 0;
  }
}

export interface NamedGenerator {
  name: string;
  generate: () => Promise<string>;
}

export interface GenerateDeps {
  states?: Map<string, ProviderState>;
  now?: () => number;
  fetcher?: typeof fetch;
  spec?: string;
  // Daftar siap pakai (dari konsol Admin); bila ada, menggantikan parsing env `spec`.
  specs?: ProviderSpec[];
  guardedFetcher?: typeof fetch;
  dailyLimit?: number;
}

export interface GenerateResult {
  text: string;
  provider: string;
}

async function callOpenAICompatible(
  fetcher: typeof fetch,
  spec: ProviderSpec,
  opts: { system: string; prompt: string },
): Promise<string> {
  const apiKey = spec.apiKey ?? (spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : undefined);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetcher(chatCompletionsUrl(spec), {
    method: 'POST',
    headers,
    body: JSON.stringify(buildChatBody(spec, opts.system, opts.prompt)),
  });
  if (!res.ok) throw new Error(`llm ${spec.name} status ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error(`llm ${spec.name} jawaban kosong`);
  return text;
}

// Jalankan primary (jalur lama, mis. SDK Gemini yang sudah di-mock di test)
// lebih dulu; bila gagal/tidak ada, coba penyedia tambahan sesuai env spec.
export async function generateWithFallback(
  primary: NamedGenerator | null,
  input: { system: string; prompt: string },
  deps: GenerateDeps = {},
): Promise<GenerateResult | null> {
  const states = deps.states ?? globalStates;
  const now = deps.now ?? Date.now;
  const fetcher = deps.fetcher ?? fetch;
  const dailyLimit =
    deps.dailyLimit ?? (Number(process.env.LLM_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT);

  if (primary) {
    // Kunci state dipisah dari entri spec (SDK vs OpenAI-compatible punya
    // kuota/cooldown sendiri walau sama-sama bernama "gemini").
    const st = getState(states, `primary:${primary.name}`);
    if (canAttempt(st, now(), dailyLimit)) {
      try {
        const text = await primary.generate();
        recordSuccess(st);
        return { text, provider: primary.name };
      } catch (e) {
        recordFailure(st, now());
        logServerEvent('warn', { operation: 'llm.primary_failed', provider: primary.name, cause: failCause(e) });
      }
    }
  }

  for (const spec of deps.specs ?? parseChatProviderSpec(deps.spec ?? process.env.LLM_CHAT_PROVIDERS)) {
    // Penyedia dari DB (guarded) boleh tanpa kunci (gateway terbuka); jalur env tetap seperti semula.
    const apiKey = spec.guarded ? 'db' : spec.apiKeyEnv ? process.env[spec.apiKeyEnv] : 'ollama-lokal';
    if (!apiKey) continue;
    const st = getState(states, spec.name);
    if (!canAttempt(st, now(), spec.dailyLimit ?? dailyLimit)) continue;
    const spesFetcher = spec.guarded
      ? (deps.guardedFetcher ?? makeGuardedFetch({ timeoutMs: spec.timeoutMs }))
      : fetcher;
    try {
      const text = await callOpenAICompatible(spesFetcher, spec, input);
      recordSuccess(st);
      return { text, provider: spec.name };
    } catch (e) {
      recordFailure(st, now());
      logServerEvent('warn', { operation: 'llm.provider_failed', provider: spec.name, cause: failCause(e) });
    }
  }
  return null;
}

const globalStates = new Map<string, ProviderState>();
