import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202609230003_antrean_realtime.sql'), 'utf8');

describe('antrean realtime migration', () => {
  it('memublikasikan tiket_antrean & visit dengan guard idempoten', () => {
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*?tiket_antrean[\s\S]*?ADD TABLE public\.tiket_antrean/i);
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*?visit[\s\S]*?ADD TABLE public\.visit/i);
  });

  it('kanal publik hanya menyertakan kolom non-PII', () => {
    const fn = sql.slice(sql.indexOf('antrean_broadcast'), sql.indexOf('DROP TRIGGER'));
    expect(fn).toMatch(/nomor_display/);
    expect(fn).not.toMatch(/'nama'|kunjungan_id|no_hp/);
  });

  it('policy realtime.messages terbuka untuk topik publik saja', () => {
    expect(sql).toMatch(/CREATE POLICY antrean_publik_receive ON realtime\.messages/);
    expect(sql).toMatch(/topic = 'antrean:publik'/);
  });

  it('idempotensi check-in: kolom + indeks unik parsial', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS client_request_id uuid/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_client_request_id/);
  });
});
