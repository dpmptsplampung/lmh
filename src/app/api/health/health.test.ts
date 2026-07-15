// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLivenessResponse } from './live/health';
import { createReadinessResponse } from './ready/health';

describe('/api/health/live', () => {
  it('returns dependency-free no-store process metadata', async () => {
    const response = createLivenessResponse({
      environment: 'staging', version: 'v42', now: () => new Date('2026-07-14T01:02:03.000Z'),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'live', version: 'v42', environment: 'staging', timestamp: '2026-07-14T01:02:03.000Z',
    });
  });
});

describe('/api/health/ready', () => {
  const base = {
    validateConfig: () => undefined,
    now: () => new Date('2026-07-14T01:02:03.000Z'),
    environment: 'production',
    version: 'v42',
    timeoutMs: 20,
  };

  it('returns ready after a successful minimal database query', async () => {
    const response = await createReadinessResponse({ ...base, queryLayanan: async () => undefined });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'ready', version: 'v42', environment: 'production' });
  });

  it('returns a sanitized 503 for invalid runtime configuration', async () => {
    const response = await createReadinessResponse({ ...base, validateConfig: () => { throw new Error('secret key leaked'); }, queryLayanan: vi.fn() });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"not_ready"}');
  });

  it('returns a sanitized 503 for database failure', async () => {
    const response = await createReadinessResponse({ ...base, queryLayanan: async () => { throw new Error('postgres URL and message'); } });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"not_ready"}');
  });

  it('bounds the dependency query with a timeout', async () => {
    vi.useFakeTimers();
    const pending = createReadinessResponse({ ...base, queryLayanan: () => new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(21);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"not_ready"}');
    vi.useRealTimers();
  });

  it('aborts the underlying dependency query when readiness times out', async () => {
    vi.useFakeTimers();
    let querySignal: AbortSignal | undefined;
    const pending = createReadinessResponse({
      ...base,
      queryLayanan: (signal) => {
        querySignal = signal;
        return new Promise(() => undefined);
      },
    });
    await vi.advanceTimersByTimeAsync(21);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(querySignal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
