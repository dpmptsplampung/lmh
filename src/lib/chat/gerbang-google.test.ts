// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { punyaIdentitasGoogle, tolakAkunAnonim, tolakBukanGoogle } from './gerbang-google';

const google = { is_anonymous: false, identities: [{ provider: 'google' }] };
const sandi = { is_anonymous: false, identities: [{ provider: 'email' }], app_metadata: { provider: 'email', providers: ['email'] } };

describe('punyaIdentitasGoogle (R5: bukti dari data Auth, bukan klaim klien)', () => {
  it('menerima identitas Google dari identities, app_metadata.provider, atau app_metadata.providers', () => {
    expect(punyaIdentitasGoogle(google)).toBe(true);
    expect(punyaIdentitasGoogle({ is_anonymous: false, app_metadata: { provider: 'google' } })).toBe(true);
    expect(punyaIdentitasGoogle({ is_anonymous: false, app_metadata: { providers: ['email', 'google'] } })).toBe(true);
  });
  it('menolak akun nonanonim tanpa identitas Google dan akun anonim', () => {
    expect(punyaIdentitasGoogle(sandi)).toBe(false);
    expect(punyaIdentitasGoogle({ is_anonymous: false })).toBe(false);
    expect(punyaIdentitasGoogle({ is_anonymous: true, identities: [{ provider: 'google' }] })).toBe(false);
    expect(punyaIdentitasGoogle(null)).toBe(false);
  });
  it('tidak percaya user_metadata (dapat diubah klien)', () => {
    const palsu = { is_anonymous: false, identities: [], user_metadata: { provider: 'google', iss: 'https://accounts.google.com' } };
    expect(punyaIdentitasGoogle(palsu as never)).toBe(false);
  });
});

describe('tolakBukanGoogle', () => {
  it('pengunjung Google lolos; pengunjung sandi nonanonim dan anonim ditolak 403 LOGIN_GOOGLE', async () => {
    expect(tolakBukanGoogle(google, false)).toBeNull();
    for (const u of [sandi, { is_anonymous: true }]) {
      const res = tolakBukanGoogle(u, false);
      expect(res?.status).toBe(403);
      expect((await res!.json()).kode).toBe('LOGIN_GOOGLE');
    }
  });
  it('staf sah boleh dengan sandi, tetapi akun anonim tetap ditolak', () => {
    expect(tolakBukanGoogle(sandi, true)).toBeNull();
    expect(tolakBukanGoogle({ is_anonymous: true }, true)?.status).toBe(403);
  });
  it('tolakAkunAnonim hanya menolak anonim', () => {
    expect(tolakAkunAnonim(sandi)).toBeNull();
    expect(tolakAkunAnonim({ is_anonymous: true })?.status).toBe(403);
  });
});
