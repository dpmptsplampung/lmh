// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseClientEnv } from './client';
import { parseServerEnv } from './server';

const productionEnv = {
  APP_ENV: 'production',
  APP_VERSION: '2026.07.14',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon_key_value_123456789',
  SUPABASE_SERVICE_ROLE_KEY: 'service_role_value_123456789',
  RESEND_API_KEY: 're_live_value_123456789',
  VAPID_PUBLIC_KEY: 'vapid_public_value_123456789',
  VAPID_PRIVATE_KEY: 'vapid_private_value_123456789',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'vapid_public_value_123456789',
  CRON_SECRET: 'cron_value_123456789',
  RESEND_FROM: 'DPMPTSP Lampung <noreply@lampungprov.go.id>',
  NEXT_PUBLIC_PUBLIC_URL: 'https://layanan.lampungprov.go.id',
  GEMINI_API_KEY: 'gemini_value_123456789',
  GEMINI_MODEL: 'gemini-1.5-flash',
  GEMINI_EMBEDDING_MODEL: 'text-embedding-004',
};

describe('server environment contract', () => {
  it('accepts complete production configuration', () => {
    expect(parseServerEnv(productionEnv).APP_ENV).toBe('production');
  });

  it.each([
    ['missing service variable', { SUPABASE_SERVICE_ROLE_KEY: undefined }],
    ['non-HTTPS public URL', { NEXT_PUBLIC_PUBLIC_URL: 'http://layanan.example.test' }],
    ['placeholder secret', { CRON_SECRET: 'change-me-in-production' }],
    ['example-file replacement marker', { SUPABASE_SERVICE_ROLE_KEY: 'replace-with-supabase-service-role-key' }],
    ['obvious test secret', { GEMINI_API_KEY: 'test-key-for-production' }],
    ['empty application version', { APP_VERSION: '' }],
    ['mismatched VAPID key', { NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'different_public_key_123456789' }],
    ['development return link', { LMH_DEV_RETURN_LINK: 'set' }],
  ])('rejects %s in production', (_label, override) => {
    expect(() => parseServerEnv({ ...productionEnv, ...override })).toThrow();
  });

  it('permits build placeholders in development and test', () => {
    expect(parseServerEnv({ APP_ENV: 'test' }).APP_ENV).toBe('test');
    expect(parseServerEnv({ APP_ENV: 'development' }).APP_ENV).toBe('development');
  });
});

describe('client environment contract', () => {
  it('returns only public variables', () => {
    const parsed = parseClientEnv(productionEnv);
    expect(Object.keys(parsed).sort()).toEqual([
      'NEXT_PUBLIC_PUBLIC_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    ]);
    expect(JSON.stringify(parsed)).not.toContain('service_role_value');
  });
});
