// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import KebijakanPrivasiPage from './page';

// /checkin kini halaman informasi tanpa consent (K3); consent PDP pengunjung ada di reservasi dan chat.
const RESERVASI_SOURCE = readFileSync(join(process.cwd(), 'src/app/me/reservasi/page.tsx'), 'utf8');
const CHAT_SOURCE = readFileSync(join(process.cwd(), 'src/app/chat/page.tsx'), 'utf8');

function consentVersionFrom(source: string): string {
  const match = source.match(/const\s+CONSENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('CONSENT_VERSION not found');
  return match[1];
}

describe('kebijakan-privasi page', () => {
  afterEach(cleanup);

  it('renders h1 and required Indonesian sections without placeholders', () => {
    render(<KebijakanPrivasiPage />);

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /kebijakan privasi/i,
    );

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/pengendali data/i);
    expect(body).toMatch(/DPMPTSP Provinsi Lampung/i);
    expect(body).toMatch(/data yang dikumpulkan|data dikumpulkan/i);
    expect(body).toMatch(/tujuan/i);
    expect(body).toMatch(/retensi/i);
    expect(body).toMatch(/730/);
    expect(body).toMatch(/provisional|sementara|belum final|menunggu/i);
    expect(body).toMatch(/hak subjek/i);
    expect(body).toMatch(/kontak/i);
    expect(body).not.toMatch(/\bTBD\b/);
    expect(body).not.toMatch(/\[nama\]/i);
  });

  it('version matches CONSENT_VERSION used by reservasi and chat', () => {
    const version = consentVersionFrom(RESERVASI_SOURCE);
    expect(consentVersionFrom(CHAT_SOURCE)).toBe(version);

    render(<KebijakanPrivasiPage />);
    const body = document.body.textContent ?? '';
    expect(body).toContain(version);
  });

  it('is linked from reservasi and chat consent flows', () => {
    expect(RESERVASI_SOURCE).toContain('href="/kebijakan-privasi"');
    expect(CHAT_SOURCE).toContain('href="/kebijakan-privasi"');
  });

  it('menjelaskan formulir UMKM, batas WhatsApp pribadi, dan pencatatan opsional', () => {
    render(<KebijakanPrivasiPage />);
    const body = document.body.textContent ?? '';
    expect(screen.getByRole('heading', { name: /katalog dan formulir UMKM/i })).toBeTruthy();
    expect(body).toMatch(/180 hari/);
    expect(body).toMatch(/30 hari sejak.*dibatalkan/);
    expect(body).toMatch(/90 hari bila tidak ada aktivitas/);
    expect(body).toMatch(/LMH tidak dapat menghapusnya/);
    expect(body).toMatch(/tidak dapat membuktikan/);
    expect(body).toMatch(/tanpa menyimpan kata yang dicari/);
    expect(body).toMatch(/tidak.*membagikan nomor UMKM/);
    expect(body).toMatch(/tidak memakai cookie iklan/);
  });

  it('menjelaskan pemeriksaan kontak dan sesi anonim secara sama dengan kebijakan PDP', () => {
    render(<KebijakanPrivasiPage />);
    const dokumen = readFileSync(join(process.cwd(), 'docs/KEBIJAKAN_PDP.md'), 'utf8');
    const pemeriksaan = 'Petugas memeriksa agar nomor telepon, email, alamat rinci, atau nama pemilik usaha ' +
      'tidak tampil di halaman publik.';
    const sesi = 'Pengiriman formulir memakai sesi anonim untuk menahan kiriman berlebihan.';
    for (const naskah of [document.body.textContent ?? '', dokumen]) {
      const teks = naskah.replace(/\s+/g, ' ');
      expect(teks).toContain(pemeriksaan);
      expect(teks).toContain(sesi);
      expect(teks).not.toContain('Halaman publik tidak menampilkan nomor telepon');
    }
  });
});
