// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { cekDomainEmail, periksaAlamatEmail, type PenyelesaiDns } from './email-valid';

describe('periksaAlamatEmail', () => {
  it.each([
    ['budi@gmail.com', 'budi@gmail.com'],
    ['  Budi.Santoso+lmh@Mail.Dpmptsp.web.id  ', 'budi.santoso+lmh@mail.dpmptsp.web.id'],
    ['a_b-c@sub.domain.co.id', 'a_b-c@sub.domain.co.id'],
  ])('menerima %s', (masuk, keluar) => {
    expect(periksaAlamatEmail(masuk)).toEqual({ valid: true, email: keluar, domain: keluar.split('@')[1] });
  });

  it.each([
    ['', 'kosong'],
    ['   ', 'kosong'],
    ['Tidak berlaku', 'format'],
    ['-', 'format'],
    ['budi', 'format'],
    ['budi@', 'format'],
    ['@gmail.com', 'format'],
    ['budi@gmail', 'format'],
    ['budi@@gmail.com', 'format'],
    ['bu di@gmail.com', 'format'],
    ['budi@gmail..com', 'format'],
    ['.budi@gmail.com', 'format'],
    ['budi.@gmail.com', 'format'],
    ['bu..di@gmail.com', 'format'],
    ['budi@-gmail.com', 'format'],
    ['budi@gmail-.com', 'format'],
    ['budi@gmail.c', 'format'],
    ['budi@gmail.123', 'format'],
    ['budi@192.168.0.1', 'format'],
    [`${'a'.repeat(65)}@gmail.com`, 'format'],
    [`budi@${'a'.repeat(64)}.com`, 'format'],
    [`${'a'.repeat(250)}@gmail.com`, 'format'],
  ])('menolak format salah %j', (masuk, alasan) => {
    const hasil = periksaAlamatEmail(masuk);
    expect(hasil.valid).toBe(false);
    if (!hasil.valid) expect(hasil.alasan).toContain(alasan);
  });

  it.each(['budi@example.com', 'budi@example.org', 'budi@sub.example.net', 'budi@kantor.test', 'budi@host.invalid', 'budi@x.localhost', 'budi@x.local'])(
    'menolak domain cadangan/tak terkirim %s',
    (masuk) => {
      const hasil = periksaAlamatEmail(masuk);
      expect(hasil.valid).toBe(false);
      if (!hasil.valid) expect(hasil.alasan).toContain('cadangan');
    },
  );

  it.each([
    ['budi@gmial.com', 'gmail.com'],
    ['budi@gamil.com', 'gmail.com'],
    ['budi@gmail.con', 'gmail.com'],
    ['budi@gmail.co', 'gmail.com'],
    ['budi@yahooo.com', 'yahoo.com'],
    ['budi@hotmial.com', 'hotmail.com'],
    ['budi@outlok.com', 'outlook.com'],
  ])('menolak salah ketik domain umum %s (saran %s)', (masuk, saran) => {
    const hasil = periksaAlamatEmail(masuk);
    expect(hasil.valid).toBe(false);
    if (!hasil.valid) expect(hasil.alasan).toContain(saran);
  });

  it('tidak salah menolak domain sah yang mirip', () => {
    for (const e of ['a@gmail.com', 'a@googlemail.com', 'a@yahoo.co.id', 'a@yahoo.com', 'a@hotmail.com', 'a@outlook.com', 'a@lampungprov.go.id', 'a@gmail.co.id']) {
      expect(periksaAlamatEmail(e).valid).toBe(true);
    }
  });

  it.each(['budi_santoso@gmail.com', 'budi-santoso@gmail.com', 'budi%x@gmail.com', 'budi_s@googlemail.com', `${'a'.repeat(31)}@gmail.com`, '+tag@gmail.com'])(
    'menolak username Gmail yang melanggar aturan Gmail %s',
    (masuk) => {
      const hasil = periksaAlamatEmail(masuk);
      expect(hasil.valid).toBe(false);
      if (!hasil.valid) expect(hasil.alasan).toContain('Gmail');
    },
  );

  it('menerima username Gmail sah, termasuk titik, tag +, angka, dan pendek', () => {
    for (const e of ['budi.santoso@gmail.com', 'budi+lmh@gmail.com', 'budi.santoso+tag_apa-saja@gmail.com', 'b123@gmail.com', `${'a'.repeat(30)}@gmail.com`, 'budi_santoso@yahoo.com', 'budi_s@lampungprov.go.id']) {
      expect(periksaAlamatEmail(e).valid).toBe(true);
    }
  });

  it('bukan string = tidak valid', () => {
    expect(periksaAlamatEmail(undefined as unknown as string).valid).toBe(false);
    expect(periksaAlamatEmail(null as unknown as string).valid).toBe(false);
  });
});

function dnsPalsu(opsi: { mx?: unknown; a?: unknown }): PenyelesaiDns {
  const jalan = (v: unknown) => (typeof v === 'function' ? (v as () => Promise<unknown>)() : Promise.resolve(v));
  return {
    resolveMx: vi.fn(() => jalan(opsi.mx)) as unknown as PenyelesaiDns['resolveMx'],
    resolve4: vi.fn(() => jalan(opsi.a)) as unknown as PenyelesaiDns['resolve4'],
  };
}
const galatDns = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));

describe('cekDomainEmail', () => {
  it('ada bila punya MX', async () => {
    const dns = dnsPalsu({ mx: [{ exchange: 'mx.x.id', priority: 10 }] });
    expect(await cekDomainEmail('a-ada-mx.id', { dns, cache: new Map() })).toBe('ada');
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it('ada bila tanpa MX tetapi punya A (aturan implicit MX)', async () => {
    const dns = dnsPalsu({ mx: galatDns('ENODATA'), a: ['1.2.3.4'] });
    expect(await cekDomainEmail('b-a-saja.id', { dns, cache: new Map() })).toBe('ada');
  });

  it('tidak_ada bila domain tidak ada (NXDOMAIN)', async () => {
    const dns = dnsPalsu({ mx: galatDns('ENOTFOUND'), a: galatDns('ENOTFOUND') });
    expect(await cekDomainEmail('c-hantu.id', { dns, cache: new Map() })).toBe('tidak_ada');
  });

  it('tidak_ada bila tanpa MX dan tanpa A', async () => {
    const dns = dnsPalsu({ mx: galatDns('ENODATA'), a: galatDns('ENODATA') });
    expect(await cekDomainEmail('d-kosong.id', { dns, cache: new Map() })).toBe('tidak_ada');
  });

  it('tidak_ada untuk null MX (RFC 7505: domain menolak email)', async () => {
    const dns = dnsPalsu({ mx: [{ exchange: '', priority: 0 }], a: ['1.2.3.4'] });
    expect(await cekDomainEmail('e-nullmx.id', { dns, cache: new Map() })).toBe('tidak_ada');
  });

  it('tidak_pasti (jangan blokir) bila DNS timeout/SERVFAIL', async () => {
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED']) {
      const dns = dnsPalsu({ mx: galatDns(code), a: galatDns(code) });
      expect(await cekDomainEmail(`f-${code.toLowerCase()}.id`, { dns, cache: new Map() })).toBe('tidak_pasti');
    }
  });

  it('MX timeout tetapi A menjawab ada -> ada', async () => {
    const dns = dnsPalsu({ mx: galatDns('ETIMEOUT'), a: ['1.2.3.4'] });
    expect(await cekDomainEmail('g-campur.id', { dns, cache: new Map() })).toBe('ada');
  });

  it('hasil pasti di-cache; tidak_pasti tidak di-cache', async () => {
    const cache = new Map();
    const dns = dnsPalsu({ mx: [{ exchange: 'mx.h.id', priority: 1 }] });
    await cekDomainEmail('h-cache.id', { dns, cache });
    await cekDomainEmail('h-cache.id', { dns, cache });
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);

    const dnsGoyah = dnsPalsu({ mx: galatDns('ETIMEOUT'), a: galatDns('ETIMEOUT') });
    await cekDomainEmail('i-goyah.id', { dns: dnsGoyah, cache });
    await cekDomainEmail('i-goyah.id', { dns: dnsGoyah, cache });
    expect(dnsGoyah.resolveMx).toHaveBeenCalledTimes(2);
  });
});
