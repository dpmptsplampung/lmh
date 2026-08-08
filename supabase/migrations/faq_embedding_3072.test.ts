// supabase/migrations/faq_embedding_3072.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202608080002_faq_embedding_3072.sql'), 'utf8');

// Strip line comments so assertions can't be satisfied by commented-out SQL.
const bare = sql.replace(/--[^\n]*/g, '');

describe('faq embedding 3072 migration', () => {
  it('alters embedding column to vector(3072)', () => {
    expect(bare).toMatch(/ALTER COLUMN embedding TYPE extensions\.vector\(3072\)/i);
  });

  it('drops the old index and creates an hnsw index (supports >2000 dims)', () => {
    expect(bare).toMatch(/DROP INDEX IF EXISTS public\.idx_faq_embedding/i);
    expect(bare).toMatch(/CREATE INDEX IF NOT EXISTS idx_faq_embedding/i);
    expect(bare).toMatch(/USING hnsw/i);
    expect(bare).toMatch(/vector_cosine_ops/i);
  });

  it('nulls existing embeddings BEFORE altering the column type (pgvector cannot cast across dims)', () => {
    expect(bare).toMatch(/SET embedding = NULL/i);
    expect(bare).toMatch(/perlu_embed_ulang = true/i);
    const nullIdx = bare.search(/SET embedding = NULL/i);
    const alterIdx = bare.search(/ALTER COLUMN embedding TYPE/i);
    expect(nullIdx).toBeGreaterThanOrEqual(0);
    expect(alterIdx).toBeGreaterThanOrEqual(0);
    expect(nullIdx).toBeLessThan(alterIdx);
  });

  it('migrates match_faq to vector(3072) with SECURITY DEFINER + fixed search_path', () => {
    expect(bare).toMatch(/DROP FUNCTION IF EXISTS public\.match_faq\(extensions\.vector, uuid, integer\)/i);
    expect(bare).toMatch(/CREATE FUNCTION public\.match_faq\(\s*query_embedding extensions\.vector\(3072\)/i);
    expect(bare).toMatch(/SECURITY DEFINER/i);
    expect(bare).toMatch(/SET search_path = pg_catalog, public, extensions/i);
  });

  it('keeps match_faq revoked from PUBLIC/anon and granted only to authenticated', () => {
    expect(bare).toMatch(/REVOKE EXECUTE ON FUNCTION public\.match_faq[\s\S]*FROM PUBLIC, anon, authenticated/i);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.match_faq[\s\S]*TO authenticated/i);
  });
});
