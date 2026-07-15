// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import KebijakanPrivasiPage from './page';

const CHECKIN_SOURCE = readFileSync(
  join(process.cwd(), 'src/app/checkin/page.tsx'),
  'utf8',
);
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

  it('version matches CONSENT_VERSION used by checkin and chat', () => {
    const version = consentVersionFrom(CHECKIN_SOURCE);
    expect(consentVersionFrom(CHAT_SOURCE)).toBe(version);

    render(<KebijakanPrivasiPage />);
    const body = document.body.textContent ?? '';
    expect(body).toContain(version);
  });

  it('is linked from checkin and chat consent flows', () => {
    expect(CHECKIN_SOURCE).toContain('href="/kebijakan-privasi"');
    expect(CHAT_SOURCE).toContain('href="/kebijakan-privasi"');
  });
});
