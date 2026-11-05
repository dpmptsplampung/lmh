// @vitest-environment node
// Memakai sesi Chrome tunggal dan server tiruan dari .tim/alat-pratinjau/README.md.
// Jalankan dengan LMH_UJI_PRATINJAU=1; tidak membuka browser atau menyambung ke data nyata.
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Hasil = {
  browserContextId?: string;
  targetId?: string;
  sessionId?: string;
  data?: string;
  result?: { value: unknown };
};

describe.runIf(process.env.LMH_UJI_PRATINJAU === '1')('lebar halaman admin di browser', () => {
  let ws: WebSocket;
  let konteks: string | undefined;
  let target: string | undefined;
  let sesi: string | undefined;
  let urutan = 0;
  const menunggu = new Map<number, { resolve: (value: Hasil) => void; reject: (error: Error) => void }>();

  function kirim(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Hasil> {
    return new Promise((resolve, reject) => {
      const id = ++urutan;
      menunggu.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async function nilai(expression: string) {
    const hasil = await kirim('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sesi);
    return hasil.result?.value;
  }

  beforeAll(async () => {
    const versi = await (await fetch('http://127.0.0.1:9333/json/version')).json();
    ws = new WebSocket(versi.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Sesi Chrome pratinjau tidak tersedia'));
    });
    ws.onmessage = (event) => {
      const pesan = JSON.parse(String(event.data));
      const janji = menunggu.get(pesan.id);
      if (!janji) return;
      menunggu.delete(pesan.id);
      if (pesan.error) janji.reject(new Error(JSON.stringify(pesan.error)));
      else janji.resolve(pesan.result);
    };
    ({ browserContextId: konteks } = await kirim('Target.createBrowserContext'));
    ({ targetId: target } = await kirim('Target.createTarget', { url: 'about:blank', browserContextId: konteks }));
    ({ sessionId: sesi } = await kirim('Target.attachToTarget', { targetId: target, flatten: true }));
    await kirim('Page.enable', {}, sesi);
    await kirim('Network.enable', {}, sesi);
    const akunTiruan = {
      access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJleHAiOjQxMDI0NDQ4MDB9.lokal',
      token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r',
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'dewi@contoh.test', app_metadata: { role: 'admin' }, user_metadata: {} },
    };
    await kirim('Network.setCookie', {
      name: 'sb-localhost-auth-token',
      value: 'base64-' + Buffer.from(JSON.stringify(akunTiruan)).toString('base64url'),
      url: 'http://localhost:3200/', path: '/',
    }, sesi);
  });

  afterAll(async () => {
    try {
      if (target) await kirim('Target.closeTarget', { targetId: target });
      if (konteks) await kirim('Target.disposeBrowserContext', { browserContextId: konteks });
    } finally {
      ws?.close();
    }
  });

  it.each(['/admin', '/admin/rekap'].flatMap((path) => [320, 390, 768].map((lebar) => [path, lebar] as const)))(
    '%s tidak meluap pada %i px',
    async (path, lebar) => {
      await kirim('Emulation.setDeviceMetricsOverride', { width: lebar, height: 1000, deviceScaleFactor: 1, mobile: lebar < 700 }, sesi);
      await kirim('Page.navigate', { url: 'http://localhost:3200' + path }, sesi);
      const penanda = path === '/admin' ? '[aria-label="Statistik utama"]' : '[aria-label="Bagian rekap"]';
      await vi.waitFor(async () => {
        expect(await nilai(`document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(penanda)})`)).toBe(true);
      }, { timeout: 45000, interval: 250 });
      await nilai('document.fonts.ready.then(() => true)');
      await nilai('new Promise(resolve => setTimeout(resolve, 1500))');
      const ukuran = await nilai('({ halaman: document.documentElement.scrollWidth, layar: document.documentElement.clientWidth })') as { halaman: number; layar: number };
      console.info(path, lebar, ukuran);
      expect(ukuran.layar).toBeGreaterThanOrEqual(lebar - 20);
      expect(ukuran.halaman).toBe(ukuran.layar);

      if (lebar === 390) {
        const gambar = await kirim('Page.captureScreenshot', { format: 'png' }, sesi);
        if (!gambar.data) throw new Error('Chrome tidak mengembalikan tangkapan');
        writeFileSync(`.tim/desain-baru/g3-${path === '/admin' ? 'dasbor' : 'rekap'}-390.png`, Buffer.from(gambar.data, 'base64'));
      }

      if (path === '/admin/rekap') {
        await nilai(`Array.from(document.querySelectorAll('[role="tab"]')).find(e => e.textContent.includes('Data Pelayanan'))?.click()`);
        const pemilih = '[role="region"][aria-label="Data pelayanan, satu baris per pelayanan"]';
        await vi.waitFor(async () => {
          expect(await nilai(`!!document.querySelector(${JSON.stringify(pemilih)})`)).toBe(true);
        }, { timeout: 5000 });
        const tabel = await nilai(`(() => {
          const wadah = document.querySelector(${JSON.stringify(pemilih)});
          wadah.querySelector('table').style.minWidth = '1200px';
          const awal = wadah.scrollLeft;
          wadah.scrollLeft = 100;
          return { halaman: document.documentElement.scrollWidth, layar: document.documentElement.clientWidth,
            bergulir: wadah.scrollWidth > wadah.clientWidth && wadah.scrollLeft > awal,
            lebarWadah: wadah.getBoundingClientRect().width };
        })()`);
        expect(tabel).toMatchObject({ halaman: ukuran.layar, layar: ukuran.layar, bergulir: true });
        expect((tabel as { lebarWadah: number }).lebarWadah).toBeLessThanOrEqual(lebar);
      }
    },
    60000,
  );
});
