// Uji buildErrorLogPayload (SEC-03): sanitasi PII & struktur error_log.
import { describe, it, expect } from 'vitest';
import { buildErrorLogPayload } from './logger';

describe('buildErrorLogPayload', () => {
  it('menyusun payload lengkap dari fields', () => {
    const p = buildErrorLogPayload(
      'error',
      {
        operation: 'checkin.insert',
        route: '/api/checkin',
        method: 'POST',
        requestId: 'req-1',
        statusCode: 500,
        error: new Error('boom'),
      },
      'production',
      '2.1.0',
    );
    expect(p.level).toBe('error');
    expect(p.operation).toBe('checkin.insert');
    expect(p.route).toBe('/api/checkin');
    expect(p.method).toBe('POST');
    expect(p.requestId).toBe('req-1');
    expect(p.statusCode).toBe(500);
    expect(p.environment).toBe('production');
    expect(p.version).toBe('2.1.0');
  });

  it('tidak membawa PII pada detail (email/hp/nama disanitasi)', () => {
    const p = buildErrorLogPayload(
      'error',
      {
        operation: 'op',
        email: 'warga@example.com',
        telepon: '081234567890',
        nama: 'Budi Santoso',
      },
      'production',
    );
    const serialized = JSON.stringify(p.detail);
    expect(serialized).not.toContain('warga@example.com');
    expect(serialized).not.toContain('081234567890');
    expect(serialized).not.toContain('Budi Santoso');
    expect(serialized).toContain('[REDACTED]');
  });

  it('pesan error tidak membocorkan isi message (hanya nama error)', () => {
    const p = buildErrorLogPayload(
      'error',
      { operation: 'op', error: new Error('rahasia: token=abc123') },
      'production',
    );
    expect(p.message).not.toContain('abc123');
    expect(p.message).toContain('Error');
  });

  it('memakai operation sebagai pesan bila tidak ada error', () => {
    const p = buildErrorLogPayload('warn', { operation: 'op.lain' }, 'production');
    expect(p.operation).toBe('op.lain');
  });
});
