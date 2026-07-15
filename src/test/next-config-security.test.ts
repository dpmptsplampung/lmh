// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

async function getHeaders(supabaseUrl?: string) {
  vi.resetModules();
  if (supabaseUrl === undefined) vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  else vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  const { default: nextConfig } = await import('../../next.config');
  const rules = await nextConfig.headers?.();
  return Object.fromEntries((rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]));
}

describe('Next security headers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses exact Supabase and Google Fonts origins without wildcard sources', async () => {
    const headers = await getHeaders('https://project-ref.supabase.co/path');
    const csp = headers['Content-Security-Policy-Report-Only'];
    expect(csp).toContain("connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://project-ref.supabase.co");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('*');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('resend');
    expect(csp).not.toContain('generativelanguage');
  });

  it.each([undefined, 'not-a-url', 'http://project-ref.supabase.co'])('omits Supabase sources for invalid or missing URL %s', async (url) => {
    const csp = (await getHeaders(url))['Content-Security-Policy-Report-Only'];
    expect(csp).not.toContain('supabase.co');
    expect(csp).not.toContain('wss://');
  });

  it('retains the exact baseline headers without HSTS', async () => {
    const headers = await getHeaders('https://project-ref.supabase.co');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Permissions-Policy']).toBe('camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });
});
