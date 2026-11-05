// @vitest-environment jsdom
// Layar TV: isi kartu TIDAK boleh bertumpuk atau terpotong; paling banyak 8 kartu per halaman (1, 3, 6, 8, 20, 40
// layanan, termasuk halaman sisa yang dirata tengah).
// Bukan sekadar menghitung sel: markup nyata halaman (dirender di jsdom) + CSS Module asli + globals.css
// dimuat ke Chromium headless (HTML statis, tanpa server/DB/font Google), lalu posisi tiap teks diukur.
// Tanpa Chromium lokal, tes ini dilewati dengan alasan tercetak; kontrak CSS murni (kartuMuat.css.test.ts)
// tetap menjaga aturan ukuran di CI.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// Nama kelas tetap apa adanya (tanpa hash) agar cocok dengan CSS mentah.
vi.mock('@/app/layar/[token]/layar-token.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('@/lib/layar/elemen.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/site-settings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({
    running_text_layar: 'Selamat datang di DPMPTSP Provinsi Lampung. Ambil nomor antrean di Front Office.',
  }),
}));

import LayarTokenPage from '@/app/layar/[token]/page';
import { createClient } from '@/lib/supabase/client';
import { UKURAN_HALAMAN } from './tataLayar';

const execFileAsync = promisify(execFile);

function cariChromium(): string | null {
  const dariEnv = process.env.LMH_CHROMIUM;
  if (dariEnv && existsSync(dariEnv)) return dariEnv;
  const akar = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');
  try {
    for (const d of readdirSync(akar).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const p = join(akar, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (existsSync(p)) return p;
    }
  } catch { /* tidak ada cache playwright */ }
  return null;
}

const chromium = cariChromium();
if (!chromium) {
  console.warn(
    '[layar] DILEWATI: Chromium headless tidak ditemukan (set LMH_CHROMIUM=<path chrome-headless-shell> ' +
      'atau pasang lewat `npx playwright install chromium-headless-shell`). ' +
      'Pengukuran tumpang tindih kartu TV tidak dijalankan; kontrak CSS murni tetap diuji.',
  );
}

const VIEWPORT = [
  { nama: '1280x720', w: 1280, h: 720 },
  { nama: '1366x768', w: 1366, h: 768 },
  { nama: '1920x1080', w: 1920, h: 1080 },
  { nama: '1080x1920', w: 1080, h: 1920 },
] as const;

const NAMA = ['Helpdesk OSS', 'BPJS Kesehatan', 'Pelayanan Perizinan Berusaha Non OSS Terpadu', 'PTSP', 'Bank Lampung'];

function barisUji(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const kosong = i % 3 === 0;
    const adaNomor = i % 3 === 1;
    return {
      layanan_id: `l${i}`,
      layanan_nama: i === 0 ? NAMA[0] : `${NAMA[i % NAMA.length]}${n > 6 ? '' : ` ${i + 1}`}`,
      tipe: 'konsultatif',
      antre_count: kosong ? 0 : 128,
      dilayani_count: kosong ? 0 : 12,
      nomor_sedang_dilayani: adaNomor ? 14 : null,
      nomor_display_dilayani: adaNomor ? 'OS-014' : null,
      estimasi_durasi_menit: 15,
      estimasi_tunggu_total_menit: kosong ? 0 : 180,
    };
  });
}

const SEMUA_HARI = [1, 2, 3, 4, 5, 6, 7].map(hari => ({ hari, jam_mulai: '08:00', jam_selesai: '15:30' }));

function pasangMock(baris: ReturnType<typeof barisUji>, adaRiwayat: boolean) {
  const channelApi = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  const riwayat = Array.from({ length: adaRiwayat ? 4 : 0 }, (_, i) => ({
    id: `p${i}`,
    layanan_id: baris[i % baris.length].layanan_id,
    nomor_display: `OS-01${i}`,
    label: baris[i % baris.length].layanan_nama,
    dibuat_at: new Date(Date.now() - i * 1000).toISOString(),
  }));
  const rantaiKosong = {
    select: () => rantaiKosong,
    gte: () => rantaiKosong,
    order: () => rantaiKosong,
    limit: async () => ({ data: riwayat, error: null }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi.fn(async (nama: string) =>
      nama === 'validate_layar_token'
        ? { data: true, error: null }
        : {
            data: baris.map(b => ({ layanan_id: b.layanan_id, buka_sekarang: false, libur_keterangan: null, jadwal: SEMUA_HARI })),
            error: null,
          },
    ),
    from: vi.fn((tabel: string) =>
      tabel === 'panggilan_layar' ? rantaiKosong : { select: async () => ({ data: baris, error: null }) },
    ),
    channel: vi.fn(() => channelApi),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  });
}

/** Markup halaman ke-`halaman` (1-based) untuk n layanan. Hanya setInterval yang dipalsukan (pergantian halaman). */
async function renderMarkup(n: number, halaman = 1, adaRiwayat = true): Promise<string> {
  pasangMock(barisUji(n), adaRiwayat);
  const p = Promise.resolve({ token: 'tok' });
  const params = Object.assign(p, { status: 'fulfilled' as const, value: { token: 'tok' } });
  let kontainer!: HTMLElement;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    await act(async () => {
      kontainer = render(<LayarTokenPage params={params} />).container;
    });
    await waitFor(() => {
      if (kontainer.querySelectorAll('section').length === 0) throw new Error('kartu belum tampil');
    }, { timeout: 5000 });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(kontainer.querySelector('header')).toHaveTextContent('WIB');
    expect(kontainer.querySelector('[data-testid=panggilan-terakhir]')).not.toBeNull();
    expect(kontainer.querySelectorAll('[data-testid=panggilan-terakhir] li')).toHaveLength(adaRiwayat ? 4 : 0);
    for (let i = 1; i < halaman; i++) {
      await act(async () => { vi.advanceTimersByTime(8_000); });
    }
    const sisa = Math.min(UKURAN_HALAMAN, n - (halaman - 1) * UKURAN_HALAMAN);
    expect(kontainer.querySelectorAll('section')).toHaveLength(sisa);
    const html = kontainer.innerHTML;
    cleanup();
    return html;
  } finally {
    vi.useRealTimers();
  }
}

const akarProyek = process.cwd();
const cssLayar = readFileSync(join(akarProyek, 'src/app/layar/[token]/layar-token.module.css'), 'utf8');
const cssElemen = readFileSync(join(akarProyek, 'src/lib/layar/elemen.module.css'), 'utf8');
const cssGlobal = readFileSync(join(akarProyek, 'src/styles/globals.css'), 'utf8').replace(/@import[^;]+;/g, '');
const cssTema = readFileSync(join(akarProyek, 'src/styles/tema-dasbor.css'), 'utf8');

// Skrip pengukur (jalan di Chromium). Mengembalikan pelanggaran + ukuran huruf terkecil per jenis teks.
const SKRIP_UKUR = String.raw`
function ukurDokumen(d) {
  const w = d.defaultView;
  const galat = [];
  const grid = d.querySelector('[data-testid=kisi-layanan]');
  const gr = grid.getBoundingClientRect();
  const de = d.documentElement;
  if (de.scrollHeight > w.innerHeight + 1 || de.scrollWidth > w.innerWidth + 1) galat.push('halaman bisa di-scroll');
  // Bilah A16 wajib ikut terukur: menyembunyikan limpahan bukan berarti muat satu layar.
  const terakhir = d.querySelector('[data-testid=panggilan-terakhir]');
  if (!terakhir || terakhir.querySelectorAll('li').length !== 4) {
    galat.push('empat panggilan terakhir tidak tampil');
  } else {
    const tr = terakhir.getBoundingClientRect();
    if (tr.top < gr.bottom - 1 || tr.bottom > w.innerHeight + 1 || tr.left < -1 || tr.right > w.innerWidth + 1)
      galat.push('riwayat keluar layar atau menimpa kisi kartu');
    for (const el of [terakhir, ...terakhir.querySelectorAll('h2, ol, li, strong, span')]) {
      if (el.getClientRects().length === 0 || el.clientHeight === 0) {
        galat.push('isi riwayat tidak terlihat');
        continue;
      }
      const cs = w.getComputedStyle(el);
      const toleransi = 1 + 0.2 * parseFloat(cs.fontSize);
      if (el.scrollHeight > el.clientHeight + toleransi)
        galat.push('isi riwayat terpotong tegak');
      // Nama layanan boleh elipsis; nomor harus tampil utuh.
      if (el.tagName === 'STRONG' && el.scrollWidth > el.clientWidth + 1)
        galat.push('nomor panggilan terakhir terpotong');
    }
  }
  const kartuAll = [...d.querySelectorAll('section')];
  const huruf = {};
  const catatHuruf = (kelas, el) => {
    const fs = parseFloat(w.getComputedStyle(el).fontSize);
    if (!(kelas in huruf) || fs < huruf[kelas]) huruf[kelas] = Math.round(fs * 10) / 10;
  };
  let kartuW = 0, kartuH = 0;
  kartuAll.forEach((card, ci) => {
    const cr = card.getBoundingClientRect();
    kartuW = cr.width; kartuH = cr.height;
    const gelagat = (m) => galat.push('kartu ' + ci + ': ' + m);
    // Kotak teks yang terlihat.
    const kotak = [];
    const walker = d.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement;
      if (el.getClientRects().length === 0) continue;
      const cs = w.getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const fs = parseFloat(cs.fontSize);
      let r;
      if (el.closest('.loketName')) {
        r = el.closest('.loketName').getBoundingClientRect();
      } else {
        const rg = d.createRange(); rg.selectNodeContents(t);
        r = rg.getBoundingClientRect();
      }
      const pangkas = el.closest('.loketName') ? 0 : fs * 0.12;
      kotak.push({ teks: t.nodeValue.trim().slice(0, 24), l: r.left, r: r.right, t: r.top + pangkas, b: r.bottom - pangkas });
      for (const k of ['loketName', 'nomorLabel', 'nomorValue', 'antreLabel', 'antreValue']) {
        if (el.closest('.' + k)) { catatHuruf(k, el); break; }
      }
    }
    kotak.forEach(k => {
      if (k.l < cr.left - 1 || k.r > cr.right + 1 || k.t < cr.top - 1 || k.b > cr.bottom + 1)
        gelagat('teks keluar kartu: "' + k.teks + '"');
    });
    for (let i = 0; i < kotak.length; i++) for (let j = i + 1; j < kotak.length; j++) {
      const a = kotak[i], b = kotak[j];
      const lebar = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const tinggi = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (lebar > 1 && tinggi > 1) gelagat('tumpang tindih: "' + a.teks + '" x "' + b.teks + '" (' + Math.round(lebar) + 'x' + Math.round(tinggi) + 'px)');
    }
    // Terpotong: isi lebih besar daripada kotaknya (kecuali nama yang memang dibatasi dua baris).
    [card, ...card.querySelectorAll('*')].forEach(el => {
      if (el.getClientRects().length === 0 || el.closest('.loketName')) return;
      // Toleransi 0,2em tinggi: kotak huruf dengan line-height 1 lebih tinggi daripada garis barisnya (bukan terpotong).
      const toleransi = 1 + 0.2 * parseFloat(w.getComputedStyle(el).fontSize);
      if (el.scrollHeight > el.clientHeight + toleransi || el.scrollWidth > el.clientWidth + 1)
        gelagat('terpotong: .' + (el.className.toString().split(' ')[0] || el.tagName) +
          ' (isi ' + el.scrollWidth + 'x' + el.scrollHeight + ' > kotak ' + el.clientWidth + 'x' + el.clientHeight + ')');
    });
    const nama = card.querySelector('.loketName');
    if (nama && nama.getClientRects().length === 0) gelagat('nama layanan tidak tampil');
  });
  // Kartu sisa harus di tengah kisi (sumbu mendatar dan tegak), bukan menempel kiri/atas.
  if (kartuAll.length > 0) {
    const rs = kartuAll.map(k => k.getBoundingClientRect());
    const kiri = Math.min(...rs.map(r => r.left)), kanan = Math.max(...rs.map(r => r.right));
    const atas = Math.min(...rs.map(r => r.top)), bawah = Math.max(...rs.map(r => r.bottom));
    const gs = w.getComputedStyle(grid);
    const tengahX = gr.left + parseFloat(gs.paddingLeft) + (gr.width - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight)) / 2;
    const tengahY = gr.top + parseFloat(gs.paddingTop) + (gr.height - parseFloat(gs.paddingTop) - parseFloat(gs.paddingBottom)) / 2;
    if (Math.abs((kiri + kanan) / 2 - tengahX) > 3) galat.push('kartu tidak di tengah mendatar');
    if (Math.abs((atas + bawah) / 2 - tengahY) > 3) galat.push('kartu tidak di tengah tegak');
  }
  return { galat, kartu: kartuAll.length, kartuW: Math.round(kartuW), kartuH: Math.round(kartuH),
    area: { w: Math.round(gr.width), h: Math.round(gr.height) }, huruf };
}
`;

type Skenario = { id: string; w: number; h: number; html: string };
type HasilUkur = {
  id: string;
  galat: string[];
  kartu: number;
  kartuW: number;
  kartuH: number;
  area: { w: number; h: number };
  huruf: Record<string, number>;
};

function dokumen(isi: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<style>${cssGlobal}\n${cssTema}\n${cssElemen}\n${cssLayar}</style></head><body>${isi}</body></html>`;
}

async function ukurDiChromium(skenario: Skenario[], direktori: string, nama: string): Promise<HasilUkur[]> {
  const data = JSON.stringify(
    skenario.map(s => ({ id: s.id, w: s.w, h: s.h, doc: s.html })),
  ).replace(/</g, '\\u003c');
  const induk = `<!doctype html><html><body style="margin:0"><pre id="hasil"></pre><script>
${SKRIP_UKUR}
const S = ${data};
const kerja = S.map(s => new Promise(res => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:absolute;left:0;top:0;border:0;width:' + s.w + 'px;height:' + s.h + 'px;visibility:hidden';
  f.onload = () => res({ s, f });
  f.srcdoc = s.doc;
  document.body.appendChild(f);
}));
Promise.all(kerja).then(async (daftar) => {
  const keluar = [];
  for (const { s, f } of daftar) {
    const g = f.contentDocument.querySelector('[data-testid=kisi-layanan]');
    await new Promise(r => setTimeout(r, 30));
    const biasa = ukurDokumen(f.contentDocument);
    // Bingkai panggilan menambah tebal border: isi harus tetap muat dalam kedua keadaan.
    f.contentDocument.querySelectorAll('section').forEach(el => el.classList.add('loketDipanggil'));
    const dipanggil = ukurDokumen(f.contentDocument);
    for (const [jenis, ukuran] of Object.entries(dipanggil.huruf))
      biasa.huruf[jenis] = Math.min(biasa.huruf[jenis] ?? ukuran, ukuran);
    keluar.push({ id: s.id, ...biasa, galat: [...biasa.galat, ...dipanggil.galat.map(g => 'bingkai aktif: ' + g)] });
  }
  document.getElementById('hasil').textContent = JSON.stringify(keluar);
});
</script></body></html>`;
  const berkas = join(direktori, `${nama}.html`);
  writeFileSync(berkas, induk);
  const { stdout } = await execFileAsync(
    chromium!,
    ['--no-sandbox', '--disable-gpu', '--virtual-time-budget=20000', '--dump-dom', `file://${berkas}`],
    { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 },
  );
  const cocok = /<pre id="hasil">([\s\S]*?)<\/pre>/.exec(stdout);
  if (!cocok) throw new Error('Chromium tidak mengembalikan hasil ukur');
  const teks = cocok[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return JSON.parse(teks) as HasilUkur[];
}

const direktori = chromium ? mkdtempSync(join(tmpdir(), 'lmh-layar-')) : '';
afterAll(() => {
  if (direktori) rmSync(direktori, { recursive: true, force: true });
});

describe.skipIf(!chromium)('Layar TV: isi kartu tidak bertumpuk, tidak terpotong, dan sisa kartu di tengah (Chromium)', () => {
  // Pasangan (jumlah layanan, halaman): termasuk halaman sisa yang kurang dari penuh.
  const SKENARIO_UJI = [
    { n: 1, h: 1 }, { n: 3, h: 1 }, { n: 6, h: 1 }, { n: 8, h: 1 },
    { n: 11, h: 1 }, { n: 11, h: 2 }, { n: 20, h: 3 }, { n: 40, h: 1 },
  ] as const;

  it('1..40 layanan bersama empat panggilan terakhir, halaman penuh dan sisa, di 1280x720, 1366x768, 1920x1080, dan layar tegak', { timeout: 240_000 }, async () => {
    // Tahap 1: rasio area kisi nyata per viewport (header, teks berjalan, dan footer ikut mengurangi tinggi).
    const rasio = new Map<string, number>();
    const contoh = dokumen(await renderMarkup(6));
    const tanpaRiwayat = dokumen(await renderMarkup(6, 1, false));
    const tahap1 = await ukurDiChromium(
      VIEWPORT.flatMap(v => [
        { id: v.nama, w: v.w, h: v.h, html: contoh },
        { id: `${v.nama}-kosong`, w: v.w, h: v.h, html: tanpaRiwayat },
      ]),
      direktori,
      'rasio',
    );
    for (const v of VIEWPORT) {
      const penuh = tahap1.find(h => h.id === v.nama)!;
      const kosong = tahap1.find(h => h.id === `${v.nama}-kosong`)!;
      expect(kosong.area, `${v.nama}: area kisi sebelum panggilan pertama`).toEqual(penuh.area);
      expect([kosong.kartuW, kosong.kartuH], `${v.nama}: ukuran kartu sebelum panggilan pertama`).toEqual([penuh.kartuW, penuh.kartuH]);
      rasio.set(v.nama, penuh.area.w / penuh.area.h);
    }

    // Tahap 2: markup dirender ulang di jsdom dengan rasio area itu (seperti peramban sungguhan, kisi dan letak
    // kartu dihitung halaman sendiri), lalu setiap kartu diukur di Chromium.
    const skenario: Skenario[] = [];
    for (const v of VIEWPORT) {
      const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        () => ({ width: rasio.get(v.nama)! * 1000, height: 1000, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect,
      );
      try {
        for (const { n, h } of SKENARIO_UJI) {
          skenario.push({ id: `${v.nama}|${n}|${h}`, w: v.w, h: v.h, html: dokumen(await renderMarkup(n, h)) });
        }
      } finally {
        spy.mockRestore();
      }
    }
    // Pemeriksaan visual manual: LMH_LAYAR_DUMP=<folder> menyimpan tiap skenario sebagai HTML mandiri.
    if (process.env.LMH_LAYAR_DUMP) {
      for (const sk of skenario) writeFileSync(join(process.env.LMH_LAYAR_DUMP, `${sk.id.replace(/\|/g, '_')}.html`), sk.html);
    }
    const hasil = await ukurDiChromium(skenario, direktori, 'kartu');
    // Teks berjalan ikut terukur (memakan tinggi kisi).
    expect(skenario[0].html).toContain('teks-berjalan');
    expect(skenario.every(s => s.html.includes('panggilan-terakhir'))).toBe(true);

    const tabel = hasil.map(h => {
      const [vp, n, hal] = h.id.split('|');
      const f = h.huruf;
      return `${vp.padEnd(9)} n=${n.padStart(2)} hal ${hal} kartu ${h.kartu} ${h.kartuW}x${h.kartuH}  ` +
        `nama ${f.loketName ?? '-'}px  nomor ${f.nomorValue ?? '-'}px  antre ${f.antreValue ?? '-'}px  ` +
        `label ${f.nomorLabel ?? '-'}/${f.antreLabel ?? '-'}px`;
    });
    console.info(`[layar] ukuran huruf terkecil per skenario (font=${process.platform}):\n${tabel.join('\n')}`);

    const pelanggaran = hasil.filter(h => h.galat.length > 0 || h.kartu === 0).map(h => `${h.id}: ${h.galat.slice(0, 3).join('; ')}`);
    expect(pelanggaran).toEqual([]);
    expect(hasil).toHaveLength(VIEWPORT.length * SKENARIO_UJI.length);
    // TV HD dengan halaman padat tetap terbaca dari ruang tunggu.
    for (const h of hasil.filter(h => /^(1280x720|1366x768)\|/.test(h.id) && Number(h.id.split('|')[1]) >= 6)) {
      expect(h.huruf.nomorLabel, `${h.id}: label Dilayani`).toBeGreaterThanOrEqual(20);
      expect(h.huruf.antreLabel, `${h.id}: label Antre`).toBeGreaterThanOrEqual(20);
      expect(h.huruf.loketName, `${h.id}: nama layanan`).toBeGreaterThanOrEqual(28);
    }
    // Tidak pernah lebih dari 8 kartu per halaman.
    expect(Math.max(...hasil.map(h => h.kartu))).toBeLessThanOrEqual(UKURAN_HALAMAN);
  });
});
