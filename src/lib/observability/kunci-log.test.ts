// @vitest-environment node
// Penjaga: kunci konteks log yang cocok pola redaksi PII (`SENSITIVE_KEY`) disamarkan jadi "[REDACTED]"
// sehingga data operasional (mis. `jumlahPotongan`, cocok "hp") hilang dari log. Pola redaksi TIDAK boleh
// dilonggarkan; pemanggil yang mengganti nama kunci. Tes ini memindai pemanggil log di src/ agar tidak kambuh.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { SENSITIVE_KEY, logServerEvent } from './logger';

function berkasSumber(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return berkasSumber(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('kunci konteks log vs pola redaksi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('nPotongan (pengganti jumlahPotongan) lolos redaksi; jumlahPotongan tersamarkan (alasan penggantian nama)', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logServerEvent('error', { operation: 'x', nPotongan: 3, jumlahPotongan: 3 });
    const out = JSON.parse(String(write.mock.calls[0][0]));
    expect(out.nPotongan).toBe(3);
    expect(out.jumlahPotongan).toBe('[REDACTED]');
  });

  it('tidak ada pemanggil logServerEvent/catatMutasi/catatMutasiGagal yang memakai kunci tersamarkan', () => {
    const melanggar: string[] = [];
    for (const f of berkasSumber(path.join(process.cwd(), 'src'))) {
      const s = fs.readFileSync(f, 'utf8');
      const re = /\b(?:logServerEvent|catatMutasi|catatMutasiGagal)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        let i = m.index + m[0].length;
        let depth = 1;
        while (i < s.length && depth > 0) {
          if (s[i] === '(') depth++;
          else if (s[i] === ')') depth--;
          i++;
        }
        const badan = s.slice(m.index + m[0].length, i);
        for (const k of badan.matchAll(/(?:^|[{,\s])([A-Za-z_]\w*)\s*(?::|,|\s*\})/g)) {
          if (SENSITIVE_KEY.test(k[1])) melanggar.push(`${path.relative(process.cwd(), f)}: ${k[1]}`);
        }
      }
    }
    expect(melanggar).toEqual([]);
  });
});
