// @vitest-environment node
// Test gerbang audit lokal (scripts/check-audit.mjs). Logika murni diuji tanpa npm/jaringan.
// Berkas test ini ada di src/test/ (bukan scripts/) karena vitest.config.ts hanya mengambil src/** dan
// supabase/migrations/**; config sengaja tidak diubah (src/test/vitest-config.test.ts mengunci daftar include).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bacaKeluaranAudit,
  evaluasiAudit,
  formatLaporan,
  hariIniWIB,
  idAdvisory,
  tanggalValid,
  validasiAllowlist,
} from '../../scripts/check-audit.mjs';
import { toWIBDateString } from '@/lib/time';

const HARI_INI = '2026-10-13';
const ID_BRACES = 'GHSA-vfj7-8cjw-p6xm';

/** Objek advisory akar seperti di `via` keluaran npm audit. */
function adv(id: string, name: string, severity: string, title = `${name}: judul advisory`) {
  return {
    source: 1000000 + name.length,
    name,
    dependency: name,
    title,
    url: `https://github.com/advisories/${id}`,
    severity,
    range: '<=1.0.0',
  };
}

/** Node paket pada `vulnerabilities` (bentuk auditReportVersion 2). */
function node(name: string, severity: string, via: Array<string | ReturnType<typeof adv>>) {
  return { name, severity, isDirect: false, via, effects: [], range: '*', nodes: [`node_modules/${name}`], fixAvailable: false };
}

function auditDari(...nodes: Array<ReturnType<typeof node>>) {
  return { auditReportVersion: 2, vulnerabilities: Object.fromEntries(nodes.map((n) => [n.name, n])), metadata: {} };
}

/** Meniru rantai NYATA di repo ini: braces -> micromatch -> fast-glob -> @next/eslint-plugin-next -> eslint-config-next. */
function auditRantaiBraces() {
  return auditDari(
    node('braces', 'high', [adv(ID_BRACES, 'braces', 'high', 'braces vulnerable to stack-exhaustion denial of service')]),
    node('micromatch', 'high', ['braces']),
    node('fast-glob', 'high', ['micromatch']),
    node('@next/eslint-plugin-next', 'high', ['fast-glob']),
    node('eslint-config-next', 'high', ['@next/eslint-plugin-next']),
    // moderate: tidak boleh memblok
    node('uuid', 'moderate', [adv('GHSA-w5hq-g745-h8pq', 'uuid', 'moderate')]),
    node('exceljs', 'moderate', ['uuid']),
  );
}

const izinBraces = (tenggat: string) => ({
  pengecualian: [{ id: ID_BRACES, alasan: 'rantai dev-only, belum ada fix layak', tenggat }],
});

describe('evaluasiAudit — kebijakan pemblokiran high+', () => {
  it('GAGAL: advisory high di luar allowlist (allowlist kosong)', () => {
    const h = evaluasiAudit(auditRantaiBraces(), { pengecualian: [] }, HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.tidakDiizinkan).toHaveLength(1);
    expect(h.tidakDiizinkan[0].id).toBe(ID_BRACES);
    // seluruh rantai (5 paket high) ditelusuri sampai ke akar yang sama
    expect(h.tidakDiizinkan[0].paketTerdampak).toEqual([
      '@next/eslint-plugin-next',
      'braces',
      'eslint-config-next',
      'fast-glob',
      'micromatch',
    ]);
    expect(h.ringkasan.akarHighPlus).toBe(1);
    expect(h.ringkasan.paketHighPlus).toBe(5);
    const laporan = formatLaporan(h).join('\n');
    expect(laporan).toContain(`GAGAL ${ID_BRACES}`);
    expect(laporan).toContain('audit-allow.json');
  });

  it('GAGAL: allowlist tidak diberikan sama sekali (berkas tidak ada) tetap memblok', () => {
    const h = evaluasiAudit(auditRantaiBraces(), undefined, HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.tidakDiizinkan).toHaveLength(1);
  });

  it('GAGAL: advisory critical di luar allowlist', () => {
    const a = auditDari(node('paket-x', 'critical', [adv('GHSA-aaaa-bbbb-cccc', 'paket-x', 'critical')]));
    const h = evaluasiAudit(a, { pengecualian: [] }, HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.tidakDiizinkan[0].severity).toBe('critical');
  });

  it('LOLOS: advisory high di dalam allowlist dan tenggat belum lewat', () => {
    const h = evaluasiAudit(auditRantaiBraces(), izinBraces('2027-01-13'), HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.diizinkan).toHaveLength(1);
    expect(h.diizinkan[0]).toMatchObject({ id: ID_BRACES, tenggat: '2027-01-13' });
    expect(h.tidakDiizinkan).toHaveLength(0);
    expect(h.kedaluwarsa).toHaveLength(0);
    expect(h.basi).toHaveLength(0);
    const laporan = formatLaporan(h).join('\n');
    expect(laporan).toContain('DIIZINKAN');
    expect(laporan).toContain('2027-01-13');
    expect(laporan).toContain('LOLOS');
  });

  it('GAGAL: pengecualian yang dipakai sudah lewat tenggat', () => {
    const h = evaluasiAudit(auditRantaiBraces(), izinBraces('2026-10-12'), HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.kedaluwarsa).toHaveLength(1);
    expect(h.kedaluwarsa[0]).toMatchObject({ id: ID_BRACES, tenggat: '2026-10-12' });
    expect(h.diizinkan).toHaveLength(0);
    expect(h.tidakDiizinkan).toHaveLength(0);
    expect(formatLaporan(h).join('\n')).toContain('kedaluwarsa');
  });

  it('tenggat berlaku inklusif: lolos pada hari tenggat, gagal sehari sesudahnya', () => {
    const a = auditRantaiBraces();
    expect(evaluasiAudit(a, izinBraces('2027-01-13'), '2027-01-13').ok).toBe(true);
    expect(evaluasiAudit(a, izinBraces('2027-01-13'), '2027-01-14').ok).toBe(false);
  });

  it('LOLOS: hanya advisory moderate/low (tidak memblok)', () => {
    const a = auditDari(
      node('uuid', 'moderate', [adv('GHSA-w5hq-g745-h8pq', 'uuid', 'moderate')]),
      node('exceljs', 'moderate', ['uuid']),
      node('kecil', 'low', [adv('GHSA-zzzz-yyyy-xxxx', 'kecil', 'low')]),
    );
    const h = evaluasiAudit(a, { pengecualian: [] }, HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.ringkasan.paketHighPlus).toBe(0);
    expect(h.ringkasan.akarHighPlus).toBe(0);
    expect(h.ringkasan.perTingkat.moderate).toBe(2);
    expect(h.ringkasan.perTingkat.low).toBe(1);
  });

  it('LOLOS: tanpa temuan sama sekali', () => {
    const h = evaluasiAudit({ auditReportVersion: 2, vulnerabilities: {} }, undefined, HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.ringkasan.totalPaket).toBe(0);
  });

  it('PERINGATAN (bukan gagal): entri allowlist basi karena tidak dipakai advisory high+ mana pun', () => {
    const a = auditDari(node('uuid', 'moderate', [adv('GHSA-w5hq-g745-h8pq', 'uuid', 'moderate')]));
    const h = evaluasiAudit(a, izinBraces('2027-01-13'), HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.basi).toHaveLength(1);
    expect(h.basi[0].id).toBe(ID_BRACES);
    const laporan = formatLaporan(h).join('\n');
    expect(laporan).toContain('PERINGATAN pengecualian basi');
    expect(laporan).toContain('LOLOS');
  });

  it('entri basi yang juga sudah lewat tenggat tetap hanya peringatan (tidak dipakai)', () => {
    const a = auditDari();
    const h = evaluasiAudit(a, izinBraces('2020-01-01'), HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.basi).toHaveLength(1);
    expect(h.kedaluwarsa).toHaveLength(0);
  });

  it('GAGAL: dua advisory akar high, hanya satu yang diizinkan', () => {
    const a = auditDari(
      node('braces', 'high', [adv(ID_BRACES, 'braces', 'high')]),
      node('paket-lain', 'high', [adv('GHSA-1111-2222-3333', 'paket-lain', 'high', 'RCE di paket-lain')]),
    );
    const h = evaluasiAudit(a, izinBraces('2027-01-13'), HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.diizinkan.map((x) => x.id)).toEqual([ID_BRACES]);
    expect(h.tidakDiizinkan.map((x) => x.id)).toEqual(['GHSA-1111-2222-3333']);
  });

  it('satu paket high dengan beberapa akar: semua akar high harus diizinkan', () => {
    const a = auditDari(
      node('gabungan', 'high', [adv(ID_BRACES, 'braces', 'high'), adv('GHSA-1111-2222-3333', 'x', 'high'), adv('GHSA-4444-5555-6666', 'y', 'moderate')]),
    );
    const h = evaluasiAudit(a, izinBraces('2027-01-13'), HARI_INI);
    expect(h.ok).toBe(false);
    // akar moderate tidak ikut dihitung
    expect(h.ringkasan.akarHighPlus).toBe(2);
    expect(h.tidakDiizinkan.map((x) => x.id)).toEqual(['GHSA-1111-2222-3333']);
  });

  it('pencocokan ID tidak peka huruf besar/kecil dan spasi', () => {
    const allow = { pengecualian: [{ id: `  ${ID_BRACES.toUpperCase()} `, alasan: 'ok', tenggat: '2027-01-13' }] };
    expect(evaluasiAudit(auditRantaiBraces(), allow, HARI_INI).ok).toBe(true);
  });

  it('GAGAL: paket high+ yang akarnya tidak dapat ditelusuri tidak boleh lolos diam-diam', () => {
    const a = auditDari(node('yatim', 'high', ['tidak-ada-di-daftar']));
    const h = evaluasiAudit(a, { pengecualian: [] }, HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.tanpaAkar).toEqual([{ paket: 'yatim', severity: 'high' }]);
  });

  it('penelusuran via tahan terhadap siklus', () => {
    const a = auditDari(
      node('a', 'high', ['b']),
      node('b', 'high', ['a', adv(ID_BRACES, 'braces', 'high')]),
    );
    const h = evaluasiAudit(a, izinBraces('2027-01-13'), HARI_INI);
    expect(h.ok).toBe(true);
    expect(h.diizinkan[0].paketTerdampak).toEqual(['a', 'b']);
  });

  it('melempar galat bila hasil audit atau tanggal tidak sah', () => {
    expect(() => evaluasiAudit({} as never, undefined, HARI_INI)).toThrow(/vulnerabilities/);
    expect(() => evaluasiAudit(auditDari(), undefined, '13-10-2026')).toThrow(/YYYY-MM-DD/);
  });
});

describe('validasiAllowlist', () => {
  it('menerima entri sah', () => {
    const { entri, galat } = validasiAllowlist(izinBraces('2027-01-13'));
    expect(galat).toEqual([]);
    expect(entri).toHaveLength(1);
  });

  it('menolak entri tanpa alasan, tenggat tak valid, id duplikat — dan entri cacat TIDAK dipakai', () => {
    const allow = {
      pengecualian: [
        { id: ID_BRACES, alasan: '   ', tenggat: '2027-01-13' },
        { id: 'GHSA-aaaa-bbbb-cccc', alasan: 'x', tenggat: '2027-02-30' },
        { id: 'GHSA-dddd-eeee-ffff', alasan: 'x', tenggat: '13/01/2027' },
        { id: 'GHSA-gggg-hhhh-iiii', alasan: 'x' },
        { id: 'GHSA-jjjj-kkkk-llll', alasan: 'x', tenggat: '2027-01-13' },
        { id: 'ghsa-jjjj-kkkk-llll', alasan: 'x', tenggat: '2027-01-13' },
        'bukan-objek',
        { alasan: 'x', tenggat: '2027-01-13' },
      ],
    };
    const { entri, galat } = validasiAllowlist(allow);
    expect(entri.map((e) => e.id)).toEqual(['GHSA-jjjj-kkkk-llll']);
    expect(galat.length).toBeGreaterThanOrEqual(6);
    expect(galat.join('\n')).toMatch(/alasan/);
    expect(galat.join('\n')).toMatch(/tenggat/);
    expect(galat.join('\n')).toMatch(/duplikat/);

    // allowlist cacat membuat gerbang gagal, dan advisory-nya tetap tidak diizinkan
    const h = evaluasiAudit(auditRantaiBraces(), { pengecualian: [{ id: ID_BRACES, alasan: '', tenggat: '2027-01-13' }] }, HARI_INI);
    expect(h.ok).toBe(false);
    expect(h.galatAllowlist.length).toBeGreaterThan(0);
    expect(h.tidakDiizinkan).toHaveLength(1);
  });

  it('menolak bentuk berkas yang salah (bukan {pengecualian: []})', () => {
    expect(validasiAllowlist([]).galat).toHaveLength(1);
    expect(validasiAllowlist({}).galat).toHaveLength(1);
    expect(validasiAllowlist({ pengecualian: 'x' }).galat).toHaveLength(1);
    expect(validasiAllowlist(undefined)).toEqual({ entri: [], galat: [] });
  });

  it('audit-allow.json yang dikomit valid (alasan terisi, tenggat tanggal nyata)', () => {
    const mentah = JSON.parse(readFileSync(resolve(process.cwd(), 'audit-allow.json'), 'utf8'));
    const { entri, galat } = validasiAllowlist(mentah);
    expect(galat).toEqual([]);
    // Daftar kosong sah (tidak ada advisory yang dikecualikan); entri apa pun yang ada tetap divalidasi.
    for (const e of entri) {
      expect(e.id).toMatch(/^GHSA(-[a-z0-9]{4}){3}$/);
      expect(e.alasan.length).toBeGreaterThan(40);
    }
  });
});

describe('bacaKeluaranAudit (fail-closed bila audit tidak sah)', () => {
  it('menolak keluaran yang bukan JSON (mis. kegagalan jaringan)', () => {
    expect(() => bacaKeluaranAudit('')).toThrow(/bukan JSON/);
    expect(() => bacaKeluaranAudit('npm ERR! network')).toThrow(/bukan JSON/);
  });

  it('menolak JSON galat dari npm audit', () => {
    const galat = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to https://registry.npmjs.org failed' } });
    expect(() => bacaKeluaranAudit(galat)).toThrow(/registry\.npmjs\.org/);
  });

  it('memakai `message` tingkat atas bila `summary` galat kosong (bentuk nyata saat registry tak terjangkau)', () => {
    const galat = JSON.stringify({
      message: 'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
      error: { summary: '', detail: '' },
    });
    expect(() => bacaKeluaranAudit(galat)).toThrow(/ECONNREFUSED/);
  });

  it('menolak JSON tanpa "vulnerabilities"', () => {
    expect(() => bacaKeluaranAudit('{}')).toThrow(/vulnerabilities/);
    expect(() => bacaKeluaranAudit('null')).toThrow(/vulnerabilities/);
  });

  it('menerima laporan sah, termasuk yang kosong', () => {
    expect(bacaKeluaranAudit('{"auditReportVersion":2,"vulnerabilities":{}}').vulnerabilities).toEqual({});
    expect(bacaKeluaranAudit(JSON.stringify(auditRantaiBraces())).vulnerabilities.braces.severity).toBe('high');
  });
});

describe('idAdvisory', () => {
  it('mengambil bagian GHSA dari url', () => {
    expect(idAdvisory({ url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' })).toBe(ID_BRACES);
    expect(idAdvisory({ url: 'https://github.com/advisories/GHSA-VFJ7-8CJW-P6XM' })).toBe(ID_BRACES);
  });
  it('fallback: url utuh, lalu source', () => {
    expect(idAdvisory({ url: 'https://example.test/adv/1' })).toBe('https://example.test/adv/1');
    expect(idAdvisory({ source: 123 })).toBe('npm-advisory-123');
    expect(idAdvisory({})).toBeNull();
  });
});

describe('tanggal WIB', () => {
  it('hariIniWIB memakai kalender Asia/Jakarta, bukan UTC', () => {
    // 20:00 UTC tgl 12 = 03:00 WIB tgl 13: toISOString() akan salah (12), WIB harus 13.
    const instan = new Date('2026-10-12T20:00:00Z');
    expect(instan.toISOString().split('T')[0]).toBe('2026-10-12');
    expect(hariIniWIB(instan)).toBe('2026-10-13');
    // 16:59 UTC = 23:59 WIB masih tgl yang sama; 17:00 UTC = 00:00 WIB tgl berikutnya.
    expect(hariIniWIB(new Date('2026-10-13T16:59:59Z'))).toBe('2026-10-13');
    expect(hariIniWIB(new Date('2026-10-13T17:00:00Z'))).toBe('2026-10-14');
  });

  it('setara dengan helper aplikasi src/lib/time.ts', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-06-30T17:00:00Z', '2026-10-13T16:59:59Z', '2027-12-31T23:59:59Z']) {
      const d = new Date(iso);
      expect(hariIniWIB(d)).toBe(toWIBDateString(d));
    }
  });

  it('tanggalValid menolak format salah dan tanggal fiktif', () => {
    expect(tanggalValid('2027-01-13')).toBe(true);
    expect(tanggalValid('2028-02-29')).toBe(true);
    expect(tanggalValid('2027-02-29')).toBe(false);
    expect(tanggalValid('2027-02-30')).toBe(false);
    expect(tanggalValid('2027-13-01')).toBe(false);
    expect(tanggalValid('13/01/2027')).toBe(false);
    expect(tanggalValid(undefined)).toBe(false);
  });
});
