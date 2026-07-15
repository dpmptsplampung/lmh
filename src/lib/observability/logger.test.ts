// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logServerEvent } from './logger';

describe('logServerEvent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON object with stable operational fields', () => {
    const write = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logServerEvent('info', {
      requestId: 'req-1',
      route: '/api/health/live',
      method: 'GET',
      operation: 'health.live',
      durationMs: 4,
      statusCode: 200,
    }, { now: () => new Date('2026-07-14T00:00:00.000Z') });

    expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({
      timestamp: '2026-07-14T00:00:00.000Z',
      level: 'info',
      service: 'lampung-maju-hub',
      environment: 'test',
      version: 'test',
      requestId: 'req-1',
      route: '/api/health/live',
      method: 'GET',
      operation: 'health.live',
      durationMs: 4,
      statusCode: 200,
    });
  });

  it('recursively redacts sensitive and personal fields', () => {
    const write = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    logServerEvent('warn', {
      operation: 'redaction.test',
      context: {
        authorization: 'Bearer leak',
        profile: { email: 'person@example.test', telepon: '08123', nama: 'Sari' },
        form: { message: 'private body', safe: 'kept' },
        tokens: [{ refresh_token: 'secret-token' }],
      },
    });

    const output = String(write.mock.calls[0][0]);
    expect(output).not.toContain('Bearer leak');
    expect(output).not.toContain('person@example.test');
    expect(output).not.toContain('08123');
    expect(output).not.toContain('Sari');
    expect(output).not.toContain('private body');
    expect(output).not.toContain('secret-token');
    expect(output).toContain('[REDACTED]');
  });

  it('serializes Error type without leaking stack in production', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new TypeError('database detail');

    logServerEvent('error', { operation: 'failure', error }, { environment: 'production' });

    const parsed = JSON.parse(String(write.mock.calls[0][0]));
    expect(parsed.error).toEqual({ type: 'TypeError', message: '[REDACTED]' });
    expect(String(write.mock.calls[0][0])).not.toContain(error.stack);
    expect(String(write.mock.calls[0][0])).not.toContain('database detail');
  });

  it('does not leak Error messages or stacks in staging', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('token=private-token person@example.test');
    error.stack = 'Error: token=private-token\n at /secret/password/file.ts:1:1';

    logServerEvent('error', { operation: 'failure', error }, { environment: 'staging' });

    const output = String(write.mock.calls[0][0]);
    expect(JSON.parse(output).error).toEqual({ type: 'Error', message: '[REDACTED]' });
    expect(output).not.toContain('private-token');
    expect(output).not.toContain('person@example.test');
    expect(output).not.toContain('/secret/password');
  });

  it('normalizes bigint and serializes shared and circular references', () => {
    const write = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const shared = { value: 42 };
    const context: Record<string, unknown> = { count: BigInt('9007199254740993'), first: shared, second: shared };
    context.self = context;

    expect(() => logServerEvent('info', { operation: 'graph', context })).not.toThrow();

    const parsed = JSON.parse(String(write.mock.calls[0][0]));
    expect(parsed.context).toEqual({
      count: '9007199254740993', first: { value: 42 }, second: { value: 42 }, self: '[CIRCULAR]',
    });
  });
});
