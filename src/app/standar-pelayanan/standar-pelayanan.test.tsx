// @vitest-environment node
// /standar-pelayanan sebagai Server Component ISR: data dari lib/data/publik-server (klien anon, cache ber-tag),
// tanpa sesi/cookie dan tanpa force-dynamic. Isi HTML awal sudah memuat layanan beserta standarnya.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ muat: vi.fn(), cookies: vi.fn(), headers: vi.fn(), sesi: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: h.cookies, headers: h.headers }));
vi.mock('@/lib/data/publik-server', () => ({ muatStandarPublik: h.muat }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    h.sesi();
    return {};
  },
}));

import StandarPelayananPage, * as modulHalaman from './page';

const SUMBER = readFileSync(join(process.cwd(), 'src/app/standar-pelayanan/page.tsx'), 'utf8');

const standar = (o: Record<string, unknown> = {}) => ({
  layanan_id: 'l1',
  persyaratan: 'KTP dan NIB',
  prosedur: 'Ajukan lewat OSS',
  jangka_waktu: '3 hari kerja',
  biaya: 'Gratis',
  produk_layanan: 'Sertifikat Standar',
  penanganan_pengaduan: 'Lewat kanal pengaduan',
  maklumat: 'Kami siap melayani',
  ...o,
});

beforeEach(() => {
  h.muat.mockReset();
  h.cookies.mockReset();
  h.headers.mockReset();
  h.sesi.mockReset();
});

describe('/standar-pelayanan: server component ISR', () => {
  it('konfigurasi segmen: revalidate = 60 literal, tanpa force-dynamic', () => {
    expect(modulHalaman.revalidate).toBe(60);
    expect(modulHalaman).not.toHaveProperty('dynamic');
    expect(SUMBER).toMatch(/export const revalidate = 60;/);
    expect(SUMBER).not.toMatch(/force-dynamic/);
  });

  it('tidak memakai klien bercookie/sesi dan tidak membaca cookies() atau headers()', async () => {
    h.muat.mockResolvedValue({ layanan: [], standar: [], galat: false });
    renderToString(await StandarPelayananPage());
    expect(h.sesi).not.toHaveBeenCalled();
    expect(h.cookies).not.toHaveBeenCalled();
    expect(h.headers).not.toHaveBeenCalled();
    expect(SUMBER).not.toMatch(/lib\/supabase\//);
  });

  it('layanan dengan standar: semua seksi dan maklumat tampil; yang tanpa standar "sedang disusun"', async () => {
    h.muat.mockResolvedValue({
      layanan: [
        { id: 'l1', nama: 'Helpdesk OSS' },
        { id: 'l2', nama: 'Konsultasi Investasi' },
      ],
      standar: [standar()],
      galat: false,
    });
    const html = renderToString(await StandarPelayananPage());
    expect(html).toContain('Helpdesk OSS');
    for (const teks of ['Persyaratan', 'KTP dan NIB', 'Prosedur', 'Jangka Waktu Penyelesaian', 'Biaya / Tarif', 'Produk Layanan', 'Penanganan Pengaduan', '>Maklumat Pelayanan</h3>', 'Kami siap melayani']) {
      expect(html).toContain(teks);
    }
    expect(html).toContain('Konsultasi Investasi');
    expect(html.match(/sedang disusun/g)).toHaveLength(1);
  });

  it('seksi kosong dilewati, maklumat kosong tidak merender kotak maklumat', async () => {
    h.muat.mockResolvedValue({
      layanan: [{ id: 'l1', nama: 'Helpdesk OSS' }],
      standar: [standar({ prosedur: null, biaya: null, maklumat: null })],
      galat: false,
    });
    const html = renderToString(await StandarPelayananPage());
    expect(html).not.toContain('Prosedur');
    expect(html).not.toContain('Biaya / Tarif');
    expect(html).not.toContain('>Maklumat Pelayanan</h3>');
    expect(html).toContain('Persyaratan');
  });

  it('galat memuat: pesan muat ulang tampil, halaman tetap dirender (tidak melempar)', async () => {
    h.muat.mockResolvedValue({ layanan: [], standar: [], galat: true });
    const html = renderToString(await StandarPelayananPage());
    expect(html).toContain('belum dapat dimuat');
    expect(html).toContain('Standar Pelayanan &amp; Maklumat Pelayanan');
  });
});
