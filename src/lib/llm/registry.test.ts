import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseChatProviderSpec,
  generateWithFallback,
  canAttempt,
  recordFailure,
  recordSuccess,
  resetIfNewDay,
  MAX_FAIL_STREAK,
  COOLDOWN_MS,
  DEFAULT_DAILY_LIMIT,
  type ProviderState,
} from './registry';

describe('parseChatProviderSpec', () => {
  it('tanpa spec → gemini default', () => {
    const specs = parseChatProviderSpec(undefined);
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe('gemini');
    expect(specs[0].apiKeyEnv).toBe('GEMINI_API_KEY');
  });

  it('mem-parsing daftar berurutan dengan override env kunci', () => {
    const specs = parseChatProviderSpec('groq:llama-3.3-70b-versatile, mistral:mistral-small@KUNCI_MISTRAL');
    expect(specs.map((s) => s.name)).toEqual(['groq', 'mistral']);
    expect(specs[0].model).toBe('llama-3.3-70b-versatile');
    expect(specs[0].apiKeyEnv).toBe('GROQ_API_KEY');
    expect(specs[1].apiKeyEnv).toBe('KUNCI_MISTRAL');
  });
});

describe('pemutus arus & kuota', () => {
  let st: ProviderState;
  beforeEach(() => {
    st = { failStreak: 0, cooldownUntil: 0, usedToday: 0, day: '2026-09-23' };
  });

  it('cooldown setelah 3 gagal berturut-turut, pulih setelahnya', () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_FAIL_STREAK; i++) recordFailure(st, now);
    expect(st.cooldownUntil).toBe(now + COOLDOWN_MS);
    expect(canAttempt(st, now + 1, DEFAULT_DAILY_LIMIT)).toBe(false);
    expect(canAttempt(st, now + COOLDOWN_MS + 1, DEFAULT_DAILY_LIMIT)).toBe(true);
  });

  it('sukses menghapus fail streak', () => {
    recordFailure(st, 0);
    recordSuccess(st);
    expect(st.failStreak).toBe(0);
    expect(st.usedToday).toBe(1);
  });

  it('kuota harian menolak, reset saat ganti hari WIB', () => {
    st.usedToday = DEFAULT_DAILY_LIMIT;
    expect(canAttempt(st, 0, DEFAULT_DAILY_LIMIT)).toBe(false);
    st.day = '2026-09-22';
    resetIfNewDay(st);
    expect(st.usedToday).toBe(0);
    expect(canAttempt(st, 0, DEFAULT_DAILY_LIMIT)).toBe(true);
  });
});

describe('generateWithFallback', () => {
  const input = { system: 'sys', prompt: 'q' };

  it('primary sukses → dipakai', async () => {
    const result = await generateWithFallback(
      { name: 'gemini', generate: async () => 'jawaban gemini' },
      input,
      { spec: 'groq:x', fetcher: (() => { throw new Error('tidak boleh dipanggil'); }) as unknown as typeof fetch },
    );
    expect(result).toEqual({ text: 'jawaban gemini', provider: 'gemini' });
  });

  it('primary gagal → lanjut penyedia berikutnya yang punya kunci', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'jawaban groq' } }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const result = await generateWithFallback(
      { name: 'gemini', generate: async () => { throw new Error('kuota habis'); } },
      input,
      { spec: 'groq:llama-3.3-70b-versatile', fetcher: fakeFetch },
    );
    expect(result).toEqual({ text: 'jawaban groq', provider: 'groq' });
    delete process.env.GROQ_API_KEY;
  });

  it('semua gagal → null (bot lanjut ke jawaban jujur/eskalasi)', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    const fakeFetch = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
    const states = new Map();
    const result = await generateWithFallback(
      { name: 'gemini', generate: async () => { throw new Error('mati'); } },
      input,
      { spec: 'groq:x', fetcher: fakeFetch, states },
    );
    expect(result).toBeNull();
    delete process.env.GROQ_API_KEY;
  });

  it('penyedia tanpa kunci dilewati', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await generateWithFallback(
      null,
      input,
      { spec: 'openrouter:x', fetcher: (() => { throw new Error('tidak boleh'); }) as unknown as typeof fetch },
    );
    expect(result).toBeNull();
  });
});
