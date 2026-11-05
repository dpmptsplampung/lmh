// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

const akar = resolve(__dirname, '../..');
const akarPindai = ['src/app', 'src/components', 'src/lib'];

// Halaman publik tidak termasuk redesain dasbor (g3-umum.md). Daftar folder
// eksplisit: halaman admin/me/chat/layar baru tetap otomatis ikut dipindai.
const folderPublik: Record<string, string> = {
  'src/app/login/': 'Login publik, termasuk logo Google.',
  'src/app/checkin/': 'Informasi check-in publik.',
  'src/app/survei/': 'Formulir survei publik.',
  'src/app/saran/': 'Formulir saran publik.',
  'src/app/pengaduan/': 'Formulir dan pelacakan pengaduan publik.',
  'src/app/transparansi/': 'Laporan transparansi publik.',
  'src/app/umkm/': 'Etalase dan formulir UMKM publik.',
  'src/app/gallery/': 'Galeri investasi publik.',
  'src/app/peta-potensi/': 'Peta potensi publik.',
  'src/app/standar-pelayanan/': 'Standar pelayanan publik.',
  'src/app/kebijakan-privasi/': 'Kebijakan privasi publik.',
  'src/app/offline/': 'Halaman offline publik.',
  'src/components/homepage/': 'Komponen khusus etalase publik.',
  'src/components/survei/': 'Wizard survei publik, termasuk skala jawaban.',
};

const kecuali: Record<string, string> = {
  'src/app/layout.tsx': 'Metadata themeColor PWA; bukan warna komponen dasbor.',
  'src/app/landing.module.css': 'Gaya etalase publik di luar redesain.',
  'src/app/api/investment-docs/page-image/route.ts': 'Watermark SVG raster; tidak memakai CSS/token DOM.',
  'src/components/QRCode.tsx': 'Warna QR canvas harus literal untuk pemindai.',
  'src/components/chat/IkonGoogle.tsx': 'Warna logo merek Google.',
  'src/components/admin/survei/grafik.ts': 'Skala divergen SPAK berurutan, bukan warna tema.',
  'src/components/layout/WidgetSidebar.module.css': 'Widget promosi cangkang G1, di luar pembersihan G3.',
  'src/components/layout/KartuIdentitas.module.css': 'Cangkang G1 di luar G3; avatar memakai putih literal.',
  'src/components/layout/PerintahCepat.module.css': 'Cangkang G1 di luar G3; subteks aktif memakai putih transparan.',
};

// Cangkang G1 dan panel IKM publik sudah memakai token; fallback literal
// dipertahankan untuk pemakaian di luar cakupan tema. Warna langsung tetap gagal.
const fallbackToken: Record<string, string> = {
  'src/components/layout/AppBar.module.css': 'Cangkang G1 dengan fallback token.',
  'src/components/layout/Sidebar.module.css': 'Cangkang G1 dengan fallback token.',
  'src/components/IkmPanel.tsx': 'Panel IKM juga dipakai transparansi publik tanpa tema dasbor.',
};

function daftarBerkas(akar: string): string[] {
  const pindai = (folder: string): string[] => {
    if (!existsSync(resolve(akar, folder))) return [];
    return readdirSync(resolve(akar, folder), { withFileTypes: true }).flatMap((item) => {
      const nama = `${folder}/${item.name}`;
      if (Object.keys(folderPublik).some((prefix) => `${nama}/`.startsWith(prefix))) return [];
      if (item.isDirectory()) return pindai(nama);
      return /\.(?:css|tsx?)$/.test(nama) && !/\.(?:test|spec)\./.test(nama) && !kecuali[nama] ? [nama] : [];
    });
  };
  return akarPindai.flatMap(pindai).sort();
}

function tanpaFallbackToken(isi: string): string {
  // Hitung kurung, sebab fallback bayangan dapat memuat rgba() atau var() lain.
  const awalVar = /var\(\s*(--[\w-]+)\s*,/g;
  let hasil = '';
  let posisi = 0;
  for (let m = awalVar.exec(isi); m; m = awalVar.exec(isi)) {
    let kedalaman = 1;
    let akhir = awalVar.lastIndex;
    for (; akhir < isi.length && kedalaman > 0; akhir++) {
      if (isi[akhir] === '(') kedalaman++;
      if (isi[akhir] === ')') kedalaman--;
    }
    hasil += isi.slice(posisi, m.index) + `var(${m[1]})`;
    posisi = akhir;
    awalVar.lastIndex = akhir;
  }
  return hasil + isi.slice(posisi);
}

it('menemukan berkas baru dan folder bersarang, termasuk TV dan PP, dengan pengecualian terbatas', () => {
  const akar = mkdtempSync(resolve(tmpdir(), 'g3-kebersihan-'));
  const wajib = [
    'src/app/admin/baru/page.tsx',
    'src/app/admin/layar/baru.module.css',
    'src/app/admin/pesan-perilaku/cetak/baru.css',
    'src/components/admin/baru/Panel.tsx',
    'src/components/layout/PanelBaru.module.css',
    'src/lib/layar/baru/gaya.ts',
  ];
  const dikecualikan = [
    'src/app/login/page.tsx', 'src/components/QRCode.tsx',
    'src/components/chat/IkonGoogle.tsx', 'src/components/admin/survei/grafik.ts',
    'src/lib/baru.test.ts', 'src/components/baru.spec.tsx', 'src/lib/baca.md',
  ];
  try {
    for (const nama of [...wajib, ...dikecualikan]) {
      mkdirSync(dirname(resolve(akar, nama)), { recursive: true });
      writeFileSync(resolve(akar, nama), 'const warna = "#6366f1";');
    }
    expect(daftarBerkas(akar).sort()).toEqual(wajib.sort());
  } finally {
    rmSync(akar, { recursive: true, force: true });
  }
});

it('fallback token bersarang tidak menyembunyikan warna langsung atau gaya kaca', () => {
  expect(tanpaFallbackToken('color: var(--text, #fff); background: #123456;'))
    .toBe('color: var(--text); background: #123456;');
  expect(tanpaFallbackToken('box-shadow: var(--shadow, 0 1px 2px rgba(0,0,0,.2)); backdrop-filter: blur(5px);'))
    .toBe('box-shadow: var(--shadow); backdrop-filter: blur(5px);');
  expect(tanpaFallbackToken('color: var(--a, var(--b, #fff)); background: rgb(1,2,3);'))
    .toBe('color: var(--a); background: rgb(1,2,3);');
});

const berkas = daftarBerkas(akar);
it('cakupan mencakup folder dasbor dan seluruh berkas yang sebelumnya dijaga', () => {
  expect(berkas.length).toBeGreaterThan(100);
  for (const nama of [
    'src/app/admin/admin.module.css', 'src/components/ChunkErrorRecovery.tsx',
    'src/components/OfflineBanner.module.css', 'src/components/Toast.module.css',
    'src/components/admin/FoDialog.module.css', 'src/components/admin/FormDialog.tsx',
    'src/components/admin/SurveiQrDialog.module.css', 'src/components/admin/survei/PanelSpakGlobal.tsx',
    'src/components/admin/survei/TrenGrafik.tsx', 'src/components/umkm/FotoUmkm.tsx',
  ]) expect(berkas).toContain(nama);
});

it.each(berkas)('%s memakai token warna tanpa kaca atau indigo', (nama) => {
  const asli = readFileSync(resolve(akar, nama), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const isi = fallbackToken[nama] ? tanpaFallbackToken(asli) : asli;
  expect(isi).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bindigo\b|backdrop-filter/i);
  expect(isi).not.toMatch(/var\([^;{}]*,\s*(?:white|black)\s*\)/i);
});
