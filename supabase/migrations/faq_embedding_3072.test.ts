// supabase/migrations/faq_embedding_3072.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202608080002_faq_embedding_3072.sql'), 'utf8');

describe('faq embedding 3072 migration', () => {
  it('alters embedding column to vector(3072)', () => {
    expect(sql).toMatch(/ALTER COLUMN embedding TYPE extensions\.vector\(3072\)/i);
  });
  it('drops and recreates the ivfflat index for 3072 dims', () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.idx_faq_embedding/i);
    expect(sql).toMatch(/vector\(3072\)|USING ivfflat/i);
  });
  it('nulls existing embeddings so rows are re-embedded', () => {
    expect(sql).toMatch(/SET embedding = NULL/i);
    expect(sql).toMatch(/perlu_embed_ulang = true/i);
  });
});
