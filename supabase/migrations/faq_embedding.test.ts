// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_035 = join(
  process.cwd(),
  'supabase',
  'migrations',
  '035_faq_embedding.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_035, 'utf8');
}

describe('Fase 3 / I4: migration 035_faq_embedding.sql', () => {
  it('file exists and is non-empty', () => {
    const sql = readMigration();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    const sql = readMigration();
    expect(sql).toMatch(/Fase 3 \/ I4: FAQ embedding for RAG/i);
  });

  it('documents the pgvector Dashboard prerequisite', () => {
    const sql = readMigration();
    expect(sql).toMatch(/PRASYARAT/i);
    expect(sql).toMatch(/pgvector/i);
    expect(sql).toMatch(/Dashboard/i);
  });

  it('adds embedding column vector(768) to faq_knowledge_base', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+faq_knowledge_base\s+ADD\s+COLUMN\s+embedding\s+vector\(768\)/i,
    );
  });

  it('creates ivfflat index for cosine similarity', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_faq_embedding\s+ON\s+faq_knowledge_base/i);
    expect(sql).toMatch(/ivfflat/i);
    expect(sql).toMatch(/vector_cosine_ops/i);
    expect(sql).toMatch(/lists\s*=\s*100/i);
  });

  it('creates match_faq function with correct signature', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+match_faq/i);
    expect(sql).toMatch(/query_embedding\s+vector\(768\)/i);
    expect(sql).toMatch(/p_layanan_id\s+UUID/i);
    expect(sql).toMatch(/match_count\s+INT/i);
  });

  it('match_faq returns id, layanan_id, pertanyaan, jawaban, similarity', () => {
    const sql = readMigration();
    expect(sql).toMatch(/RETURNS\s+TABLE/i);
    expect(sql).toMatch(/id\s+UUID/i);
    expect(sql).toMatch(/layanan_id\s+UUID/i);
    expect(sql).toMatch(/pertanyaan\s+TEXT/i);
    expect(sql).toMatch(/jawaban\s+TEXT/i);
    expect(sql).toMatch(/similarity\s+FLOAT/i);
  });

  it('match_faq is SECURITY DEFINER STABLE', () => {
    const sql = readMigration();
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/STABLE/i);
  });

  it('match_faq computes similarity as 1 - cosine distance', () => {
    const sql = readMigration();
    expect(sql).toMatch(/1\s*-\s*\(f\.embedding\s*<=>\s*query_embedding\)/i);
  });

  it('match_faq filters embedding IS NOT NULL and aktif = true', () => {
    const sql = readMigration();
    expect(sql).toMatch(/f\.embedding\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/f\.aktif\s*=\s*true/i);
  });

  it('match_faq supports optional layanan_id filter', () => {
    const sql = readMigration();
    expect(sql).toMatch(/p_layanan_id\s+IS\s+NULL\s+OR\s+f\.layanan_id\s*=\s*p_layanan_id/i);
  });

  it('grants EXECUTE on match_faq to authenticated', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+match_faq\(vector\(768\),\s*UUID,\s*INT\)\s+TO\s+authenticated/i,
    );
  });

  it('creates chat_ai_log table with required columns', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+TABLE\s+chat_ai_log/i);
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/sesi_id\s+UUID\s+REFERENCES\s+chat_sesi/i);
    expect(sql).toMatch(/pertanyaan\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/context_faq_ids\s+UUID\[\]/i);
    expect(sql).toMatch(/jawaban\s+TEXT/i);
    expect(sql).toMatch(/top_similarity\s+FLOAT/i);
    expect(sql).toMatch(/eskalasi\s+BOOLEAN/i);
    expect(sql).toMatch(/reason\s+TEXT/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ/i);
  });

  it('enables RLS on chat_ai_log', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ALTER\s+TABLE\s+chat_ai_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('creates chat_ai_log_admin_select policy for admin only', () => {
    const sql = readMigration();
    expect(sql).toMatch(/chat_ai_log_admin_select/i);
    expect(sql).toMatch(/get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('has a ROLLBACK section that reverses all changes', () => {
    const sql = readMigration();
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_ai_log_admin_select"\s+ON\s+chat_ai_log/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+chat_ai_log/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+match_faq/i);
    expect(sql).toMatch(/DROP\s+INDEX\s+IF\s+EXISTS\s+idx_faq_embedding/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+faq_knowledge_base\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+embedding/i);
  });
});
