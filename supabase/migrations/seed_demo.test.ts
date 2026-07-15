// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const seed = readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8');
const demo = readFileSync(join(process.cwd(), 'supabase', 'seed-demo.sql'), 'utf8');

describe('production and demo seed separation', () => {
  it('keeps demo users and Unsplash rows only in the explicit dev/staging seed', () => {
    expect(demo).toMatch(/DEV\/STAGING|DEV\/STAGING ONLY/i);
    expect(demo).toContain('password123');
    expect(demo).toContain('unsplash.com');
    expect(seed).not.toContain('password123');
    expect(seed).not.toContain('unsplash.com');
    expect(seed).not.toMatch(/auth\.(?:users|identities)/i);
  });

  it('does not reference retired migration numbers', () => {
    expect(demo).not.toMatch(/migration\s+(?:017|023)\b/i);
  });

  it('contains exactly nine final services with explicit type and chatbot flags', () => {
    const serviceValues = seed.match(/INSERT\s+INTO\s+public\.layanan[\s\S]*?ON\s+CONFLICT/gi) ?? [];
    expect(serviceValues).toHaveLength(1);
    const tuples = serviceValues[0]!.match(/\('[^']+',\s*'(?:konsultatif|mitra|modul_publik)',\s*(?:true|false)\)/gi) ?? [];
    expect(tuples).toHaveLength(9);
    for (const name of ['Helpdesk OSS', 'Sertifikasi Halal', 'BPJS Kesehatan', 'Bank Lampung', 'Matchmaking UMKM', 'Investment Gallery', 'BALMON', 'Sertifikasi Mutu Keamanan Hasil Perikanan', 'Layanan Jasa Industri']) {
      expect(seed).toContain(name);
    }
  });

  it('contains safe site and landing defaults without a fake phone number', () => {
    expect(seed).toMatch(/INSERT\s+INTO\s+public\.site_settings/i);
    expect(seed).toMatch(/INSERT\s+INTO\s+public\.landing_content/i);
    expect(seed).not.toMatch(/wa_number|6281234567890|6281277000000/i);
  });
});
