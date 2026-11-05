// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const akar = resolve(__dirname, '../..');
const akarPindai = ['src/app/admin', 'src/components/admin', 'src/app/me', 'src/lib'];
// Pemilik helper berhak mendefinisikan formatter; semua area fitur tetap dipindai.
const kecuali = ['src/lib/time.ts', 'src/lib/utils.ts'];

function daftarBerkas(folder: string): string[] {
  return readdirSync(resolve(akar, folder), { withFileTypes: true }).flatMap((item) => {
    const nama = `${folder}/${item.name}`;
    if (item.isDirectory()) return daftarBerkas(nama);
    return /\.(?:ts|tsx)$/.test(nama) && !/\.(?:test|spec)\./.test(nama) && !kecuali.includes(nama) ? [nama] : [];
  });
}

/** Parse argumen sebagai AST agar kurung bersarang, komentar, dan literal tidak mengecoh pemeriksaan. */
function pelanggaran(isi: string, nama = 'contoh.ts'): string[] {
  // Kebanyakan berkas tidak memanggil formatter locale; hindari parse AST yang tidak diperlukan.
  if (!/toLocale(?:Date|Time)?String/.test(isi)) return [];
  const sumber = ts.createSourceFile(nama, isi, ts.ScriptTarget.Latest, true, nama.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hasil: string[] = [];
  const kunjungi = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const metode = node.expression.name.text;
      if (/^toLocale(?:Date|Time)?String$/.test(metode)) {
        const penerima = node.expression.expression.getText(sumber);
        // Dua formatter ini menerima number, bukan Date; timeZone tidak berlaku untuk angka.
        const angka = nama === 'src/lib/rekap/format.ts' && metode === 'toLocaleString'
          && ['(rasio * 100)', 'menit'].includes(penerima);
        const opsi = node.arguments[1];
        const zona = opsi && ts.isObjectLiteralExpression(opsi) && opsi.properties.some((properti) =>
          properti.name && (ts.isIdentifier(properti.name) || ts.isStringLiteral(properti.name)) && properti.name.text === 'timeZone');
        if (!angka && !zona) {
          const { line } = sumber.getLineAndCharacterOfPosition(node.getStart(sumber));
          hasil.push(`${nama}:${line + 1}: ${metode} tanpa timeZone`);
        }
      }
    }
    ts.forEachChild(node, kunjungi);
  };
  kunjungi(sumber);
  return hasil;
}

describe('A9: formatter tanggal dan waktu memakai zona waktu eksplisit', () => {
  it.each(['src/app/admin/layar', 'src/app/admin/pesan-perilaku', 'src/lib/layar'])(
    'memindai %s agar regresi WIB di area yang sudah selesai ikut tertangkap', (folder) => {
      const berkas = daftarBerkas(folder);
      expect(berkas.length).toBeGreaterThan(0);
      expect(berkas.some((nama) => nama.endsWith('.test.ts'))).toBe(false);
    },
  );

  it.each(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'])('menolak %s tanpa zona waktu', (metode) => {
    expect(pelanggaran(`new Date().${metode}('id-ID')`)).toHaveLength(1);
    expect(pelanggaran(`new Date(hitung(1, 2)).${metode}('id-ID', { month: 'long' })`)).toHaveLength(1);
  });

  it('menerima zona di argumen opsi, termasuk pemanggilan multibaris', () => {
    expect(pelanggaran(`new Date().toLocaleString('id-ID', {
      hour: '2-digit', timeZone: 'Asia/Jakarta',
    })`)).toEqual([]);
  });

  it('tidak menganggap komentar, string, atau argumen locale sebagai opsi zona waktu', () => {
    expect(pelanggaran(`// new Date().toLocaleString()
      const teks = "new Date().toLocaleString()";
      new Date().toLocaleString('timeZone', { hour: '2-digit' /* timeZone */ });`)).toHaveLength(1);
  });

  it('membatasi pengecualian angka ke dua penerima pada formatter rekap', () => {
    const angka = `(rasio * 100).toLocaleString('id-ID'); menit.toLocaleString('id-ID');`;
    expect(pelanggaran(angka, 'src/lib/rekap/format.ts')).toEqual([]);
    expect(pelanggaran(angka)).toHaveLength(2);
    expect(pelanggaran(`new Date().toLocaleString('id-ID')`, 'src/lib/rekap/format.ts')).toHaveLength(1);
  });

  it('seluruh berkas dalam lingkup A9 bebas formatter tanggal/waktu tanpa zona waktu', () => {
    const berkas = akarPindai.flatMap(daftarBerkas);
    expect(berkas.length).toBeGreaterThan(100);
    expect(berkas.flatMap((nama) => pelanggaran(readFileSync(resolve(akar, nama), 'utf8'), relative(akar, resolve(akar, nama))))).toEqual([]);
  });
});
