// One-off codemod untuk WP-01: ganti pola UTC `new Date().toISOString().split('T')[0]`
// menjadi `todayWIB()` pada file klien yang menghitung "hari ini" (RPT-07).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'src/app/admin/antrian/page.tsx',
  'src/app/admin/page.tsx',
  'src/app/admin/kunjungan/page.tsx',
  'src/app/me/page.tsx',
  'src/app/admin/absensi/page.tsx',
];

const PATTERN = "new Date().toISOString().split('T')[0]";
const IMPORT_LINE = "import { todayWIB } from '@/lib/time';";

for (const rel of files) {
  const path = join(root, rel);
  let s = readFileSync(path, 'utf8');
  const count = s.split(PATTERN).length - 1;
  if (count === 0) {
    console.log(`${rel}: tidak ada pola, dilewati`);
    continue;
  }
  s = s.split(PATTERN).join('todayWIB()');
  if (!s.includes(IMPORT_LINE)) {
    // Sisipkan setelah baris import pertama agar tidak merusak 'use client'.
    s = s.replace(/(^import[^\n]*\n)/m, `$1${IMPORT_LINE}\n`);
  }
  writeFileSync(path, s);
  console.log(`${rel}: diganti ${count}x`);
}
