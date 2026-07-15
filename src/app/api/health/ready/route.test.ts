// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

type RuntimeEnv = {
  APP_ENV: string;
  APP_VERSION: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function queryClient(abortSignal = vi.fn().mockResolvedValue({ error: null })) {
  const limit = vi.fn().mockReturnValue({ abortSignal });
  const select = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, limit, abortSignal };
}

async function loadRoute(options: {
  parseRuntimeEnv: ReturnType<typeof vi.fn>;
  createServiceRoleClient: ReturnType<typeof vi.fn>;
  logServerEvent?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  const logServerEvent = options.logServerEvent ?? vi.fn();
  vi.doMock('@/lib/env/server', () => ({ parseRuntimeEnv: options.parseRuntimeEnv }));
  vi.doMock('@/lib/supabase/service', () => ({ createServiceRoleClient: options.createServiceRoleClient }));
  vi.doMock('@/lib/observability/logger', () => ({ logServerEvent }));
  const route = await import('./route');
  return { ...route, logServerEvent };
}

const runtimeEnv: RuntimeEnv = {
  APP_ENV: 'production',
  APP_VERSION: 'v9',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'private-key',
};

describe('GET /api/health/ready', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/env/server');
    vi.doUnmock('@/lib/supabase/service');
    vi.doUnmock('@/lib/observability/logger');
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('invokes runtime validation and returns sanitized no-store 503 before client creation', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('APP_VERSION', 'v9');
    const parseRuntimeEnv = vi.fn(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY=private'); });
    const createServiceRoleClient = vi.fn();
    const { GET, logServerEvent } = await loadRoute({ parseRuntimeEnv, createServiceRoleClient });

    const response = await GET();

    expect(parseRuntimeEnv).toHaveBeenCalledOnce();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"status":"not_ready"}');
    expect(logServerEvent).toHaveBeenCalledWith('error', expect.objectContaining({
      operation: 'health.ready', statusCode: 503, error: { type: 'Error' },
    }));
    expect(JSON.stringify(logServerEvent.mock.calls)).not.toContain('private');
  });

  it('wires the validated service-role client to the minimal abortable layanan query', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('APP_VERSION', 'v9');
    const query = queryClient();
    const parseRuntimeEnv = vi.fn().mockReturnValue(runtimeEnv);
    const createServiceRoleClient = vi.fn().mockReturnValue(query.client);
    const { GET } = await loadRoute({ parseRuntimeEnv, createServiceRoleClient });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(createServiceRoleClient).toHaveBeenCalledWith(runtimeEnv);
    expect(query.from).toHaveBeenCalledWith('layanan');
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('aborts the actual route query when its timeout expires', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const query = queryClient(vi.fn().mockImplementation((value: AbortSignal) => {
      signal = value;
      return new Promise(() => undefined);
    }));
    const { GET, logServerEvent } = await loadRoute({
      parseRuntimeEnv: vi.fn().mockReturnValue(runtimeEnv),
      createServiceRoleClient: vi.fn().mockReturnValue(query.client),
    });

    const pending = GET();
    await vi.advanceTimersByTimeAsync(3_001);
    const response = await pending;

    expect(signal?.aborted).toBe(true);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(logServerEvent).toHaveBeenCalledWith('error', expect.objectContaining({
      operation: 'health.ready', statusCode: 503,
    }));
  });

  it('does not leak database messages through response or structured log fields', async () => {
    const query = queryClient(vi.fn().mockResolvedValue({
      error: new Error('postgres password=private person@example.test'),
    }));
    const { GET, logServerEvent } = await loadRoute({
      parseRuntimeEnv: vi.fn().mockReturnValue(runtimeEnv),
      createServiceRoleClient: vi.fn().mockReturnValue(query.client),
    });

    const response = await GET();
    const body = await response.text();
    const logs = JSON.stringify(logServerEvent.mock.calls);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toBe('{"status":"not_ready"}');
    expect(body + logs).not.toContain('private');
    expect(body + logs).not.toContain('person@example.test');
    expect(logServerEvent).toHaveBeenCalledWith('error', expect.objectContaining({
      route: '/api/health/ready', method: 'GET', operation: 'health.ready',
      statusCode: 503, error: { type: 'Error' },
    }));
  });

  it('exports the supported runtime controls from the actual route module', async () => {
    const route = await loadRoute({
      parseRuntimeEnv: vi.fn(),
      createServiceRoleClient: vi.fn(),
    });
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(5);
    expect(route.GET).toBeTypeOf('function');
  });
});
