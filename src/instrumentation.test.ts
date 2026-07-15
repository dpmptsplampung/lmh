// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('instrumentation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('validates staging and production at server startup', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-runtime');
    const { register } = await import('./instrumentation');
    expect(() => register()).toThrow();
  });

  it('does not reject build-time placeholders', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const { register } = await import('./instrumentation');
    expect(() => register()).not.toThrow();
  });

  it('fails closed when APP_ENV is missing on a Vercel preview runtime', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('NEXT_PHASE', 'phase-runtime');
    const { register } = await import('./instrumentation');
    expect(() => register()).toThrow(/APP_ENV/);
  });

  it('rejects a misspelled APP_ENV outside the build phase', async () => {
    vi.stubEnv('APP_ENV', 'prodction');
    vi.stubEnv('NEXT_PHASE', 'phase-runtime');
    const { register } = await import('./instrumentation');
    expect(() => register()).toThrow();
  });

  it('requires Vercel preview and production to use consistent APP_ENV values', async () => {
    const { validateStartupEnvironment } = await import('./instrumentation');
    expect(() => validateStartupEnvironment({ VERCEL_ENV: 'preview', APP_ENV: 'production' })).toThrow(/staging/);
    expect(() => validateStartupEnvironment({ VERCEL_ENV: 'production', APP_ENV: 'staging' })).toThrow(/production/);
  });

  it('logs captured request errors as structured JSON', async () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onRequestError } = await import('./instrumentation');

    await onRequestError(
      new Error('private failure'),
      { path: '/api/example', method: 'POST', headers: { 'x-request-id': 'req-9' } },
      { routePath: '/api/example', routeType: 'route' } as never,
    );

    const parsed = JSON.parse(String(write.mock.calls[0][0]));
    expect(parsed).toMatchObject({
      level: 'error', requestId: 'req-9', route: '/api/example', method: 'POST',
      operation: 'next.request_error', error: { type: 'Error' },
    });
  });
});
