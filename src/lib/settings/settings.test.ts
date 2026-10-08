// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, EncryptionNotConfiguredError, isEncryptionConfigured, maskSecret } from './crypto';
import { isBlockedIp, makeGuardedFetch, validateBaseUrl } from './ssrf';
import { entryToSpec, rantaiSchema, sanitizeEntries } from './llm-schema';
import { getLlmSpecs, resetLlmConfigCache } from './llm-config';

const KEY = crypto.randomBytes(32).toString('base64');
const publik = async () => [{ address: '93.184.216.34', family: 4 }];

describe('crypto (AES-256-GCM)', () => {
  beforeEach(() => { process.env.SETTINGS_ENCRYPTION_KEY = KEY; });
  afterEach(() => { delete process.env.SETTINGS_ENCRYPTION_KEY; });

  it('enkripsi-dekripsi bolak-balik; ciphertext tidak memuat plaintext; IV unik', () => {
    const plain = 'sk-live-1234567890abcdef';
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(JSON.stringify(a)).not.toContain(plain);
    expect(a.iv).not.toBe(b.iv);
    expect(a.last4).toBe('cdef');
    expect(decryptSecret(a)).toBe(plain);
  });
  it('kunci pendek: tidak ada 4 akhir yang dibocorkan', () => {
    expect(encryptSecret('abcd1234').last4).toBe('');
    expect(maskSecret('cdef')).toBe('••••cdef');
  });
  it('ciphertext dirusak / kunci induk berbeda -> gagal dekripsi', () => {
    const a = encryptSecret('sk-live-1234567890abcdef');
    expect(() => decryptSecret({ ...a, ciphertext: Buffer.from('xx').toString('base64') })).toThrow();
    process.env.SETTINGS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    expect(() => decryptSecret(a)).toThrow();
  });
  it('env belum diset / bukan 32 byte -> ditolak dengan galat jelas', () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(isEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret('sk-live-1234567890abcdef')).toThrow(EncryptionNotConfiguredError);
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.from('pendek').toString('base64');
    expect(isEncryptionConfigured()).toBe(false);
  });
});

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
  ])('memblokir %s', (ip) => { expect(isBlockedIp(ip)).toBe(true); });
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('mengizinkan %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('validateBaseUrl: skema, kredensial, port, IP literal, domain privat', async () => {
    expect((await validateBaseUrl('http://api.example.com/v1', publik)).ok).toBe(false);
    expect((await validateBaseUrl('file:///etc/passwd', publik)).ok).toBe(false);
    expect((await validateBaseUrl('https://u:p@api.example.com', publik)).ok).toBe(false);
    expect((await validateBaseUrl('https://api.example.com:8443/v1', publik)).ok).toBe(false);
    expect((await validateBaseUrl('https://169.254.169.254/latest', publik)).ok).toBe(false);
    expect((await validateBaseUrl('https://[::1]/v1', publik)).ok).toBe(false);
    expect((await validateBaseUrl('bukan url', publik)).ok).toBe(false);
    const privat = async () => [{ address: '10.0.0.5', family: 4 }];
    expect((await validateBaseUrl('https://internal.example.com/v1', privat)).ok).toBe(false);
    const campur = async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
    expect((await validateBaseUrl('https://rebind.example.com/v1', campur)).ok).toBe(false);
    const gagal = async () => { throw new Error('ENOTFOUND'); };
    expect((await validateBaseUrl('https://tidak-ada.example.com', gagal)).ok).toBe(false);
    const ok = await validateBaseUrl('https://api.example.com/v1', publik);
    expect(ok.ok).toBe(true);
  });

  it('guarded fetch menolak tujuan privat sebelum koneksi apa pun', async () => {
    const f = makeGuardedFetch({ resolve: async () => [{ address: '169.254.169.254', family: 4 }] });
    await expect(f('https://metadata.example.com/v1/chat/completions', { method: 'POST', body: '{}' })).rejects.toThrow(/ditolak/);
  });
});

describe('skema rantai & penyaring', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const e = (n: number, o: object = {}) => ({ id: id(n), label: `P${n}`, tipe: 'openai_compat', base_url: 'https://gw.example.com/v1/', model: 'm', aktif: true, ...o });

  it('menerima gateway kustom; menolak base_url kosong, label ganda, field asing', () => {
    expect(rantaiSchema.safeParse([e(1)]).success).toBe(true);
    expect(rantaiSchema.safeParse([e(1, { base_url: null })]).success).toBe(false);
    expect(rantaiSchema.safeParse([e(1), e(2, { label: 'p1' })]).success).toBe(false);
    expect(rantaiSchema.safeParse([e(1, { api_key: 'rahasia' })]).success).toBe(false);
    expect(rantaiSchema.safeParse([]).success).toBe(false);
  });
  it('entri gemini selalu memakai endpoint resmi; spec membawa kunci & kuota', () => {
    const parsed = rantaiSchema.parse([{ id: id(1), label: 'G', tipe: 'gemini', base_url: 'https://evil.example.com', model: 'gemini-flash-latest', aktif: true, kuota_harian: 50 }]);
    const spec = entryToSpec(parsed[0], 'kunci');
    expect(spec.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(spec).toMatchObject({ guarded: true, apiKey: 'kunci', dailyLimit: 50 });
  });
  it('sanitizeEntries: tidak pernah memuat kunci, hanya penanda tersamar', () => {
    const rid = '00000000-0000-4000-8000-0000000000aa';
    const out = sanitizeEntries([e(1, { rahasia_id: rid })], new Map([[rid, 'wxyz']]));
    expect(out[0]).toMatchObject({ punya_kunci: true, kunci_tersamar: '••••wxyz' });
    expect(JSON.stringify(out)).not.toMatch(/ciphertext|api_key/);
  });
});

describe('getLlmSpecs (DB -> cache 60 dtk -> env)', () => {
  const rid = '00000000-0000-4000-8000-0000000000aa';
  const nilai = [{ id: '00000000-0000-4000-8000-000000000001', label: 'Gateway', tipe: 'openai_compat', base_url: 'https://gw.example.com/v1', model: 'm', rahasia_id: rid, aktif: true }];
  function fake(state: { aktif: unknown; fail?: boolean }, calls: { n: number }) {
    return {
      from: (table: string) => {
        calls.n += 1;
        const c: Record<string, unknown> = {};
        const self = new Proxy(c, {
          get: (_t, p) => {
            if (p === 'maybeSingle') return async () => (state.fail ? { data: null, error: { message: 'down' } } : { data: state.aktif, error: null });
            if (p === 'in') return async () => (table === 'rahasia_pengaturan' ? { data: [{ id: rid, ...encryptSecret('kunci-rahasia-1234') }], error: null } : { data: [], error: null });
            return () => self;
          },
        });
        return self;
      },
    } as never;
  }
  beforeEach(() => { process.env.SETTINGS_ENCRYPTION_KEY = KEY; resetLlmConfigCache(); });
  afterEach(() => { delete process.env.SETTINGS_ENCRYPTION_KEY; });

  it('memuat konfigurasi aktif + mendekripsi kunci; cache mencegah query ulang < 60 dtk', async () => {
    const calls = { n: 0 };
    const svc = fake({ aktif: { nilai } }, calls);
    const a = await getLlmSpecs(svc, 1_000);
    expect(a?.[0]).toMatchObject({ name: 'Gateway', apiKey: 'kunci-rahasia-1234', guarded: true, baseURL: 'https://gw.example.com/v1' });
    const n = calls.n;
    await getLlmSpecs(svc, 30_000);
    expect(calls.n).toBe(n);
    await getLlmSpecs(svc, 61_001);
    expect(calls.n).toBeGreaterThan(n);
  });
  it('tidak ada versi aktif -> null (pakai env); DB gagal -> nilai terakhir dipertahankan', async () => {
    const calls = { n: 0 };
    expect(await getLlmSpecs(fake({ aktif: null }, calls), 1_000)).toBeNull();
    resetLlmConfigCache();
    const ok = fake({ aktif: { nilai } }, calls);
    expect((await getLlmSpecs(ok, 1_000))?.length).toBe(1);
    const gagal = fake({ aktif: null, fail: true }, calls);
    expect((await getLlmSpecs(gagal, 70_000))?.length).toBe(1);
  });
  it('kunci induk tidak ada -> entri berkunci dilewati -> null (env tetap jalan)', async () => {
    const blob = encryptSecret('kunci-rahasia-1234');
    const from = (t: string): unknown => new Proxy({}, {
      get: (_x, p) => {
        if (p === 'maybeSingle') return async () => ({ data: { nilai }, error: null });
        if (p === 'in') return async () => ({ data: t === 'rahasia_pengaturan' ? [{ id: rid, ...blob }] : [], error: null });
        return () => from(t);
      },
    });
    const svc = { from } as never;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(await getLlmSpecs(svc, 1_000)).toBeNull();
  });
});
