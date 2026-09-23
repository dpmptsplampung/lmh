import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202609230002_faq_fts.sql'), 'utf8');

describe('FAQ FTS migration', () => {
  it('menyiapkan ekstensi pg_trgm & unaccent + wrapper immutabel', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS unaccent/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.unaccent_imm/);
    expect(sql).toMatch(/IMMUTABLE PARALLEL SAFE/);
  });

  it('menambah kolom fts generated & indeks GIN/trigram', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS fts tsvector/);
    expect(sql).toMatch(/GENERATED ALWAYS AS/);
    expect(sql).toMatch(/idx_faq_fts/i);
    expect(sql).toMatch(/idx_faq_trgm/i);
  });

  it('membuat RPC match_faq_teks dengan revoke/grant benar', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.match_faq_teks/);
    expect(sql).toMatch(/ts_rank_cd/i);
    expect(sql).toMatch(/similarity\(/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.match_faq_teks/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.match_faq_teks/);
  });

  it('tanpa kolom dasar_hukum (tidak ada di skema saat ini)', () => {
    expect(sql).not.toMatch(/dasar_hukum/);
  });
});
