// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final FAQ and AI schema', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);

  it('creates vector-backed FAQ and AI audit tables after extension preflight', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.faq_knowledge_base[\s\S]*embedding\s+extensions\.vector\(768\)/i);
    expect(feature).toMatch(/CREATE\s+INDEX\s+idx_faq_embedding[\s\S]*vector_cosine_ops/i);
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.chat_ai_log/i);
  });

  it('exposes match_faq only to authenticated with a fixed search path', () => {
    expect(security).toMatch(/FUNCTION\s+public\.match_faq[\s\S]*SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*extensions/i);
    expect(security).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.match_faq[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(security).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.match_faq[\s\S]*TO\s+authenticated/i);
  });

  it('uses the 768-dimensional cosine query with active and optional service filters', () => {
    expect(feature).toMatch(/embedding\s+extensions\.vector\(768\)/i);
    expect(security).toMatch(/query_embedding\s+extensions\.vector\(768\)/i);
    expect(security).toMatch(/1\s*-\s*\(faq\.embedding\s+OPERATOR\(extensions\.<=>\)\s+query_embedding\)\s+AS\s+similarity/i);
    expect(security).toMatch(/faq\.embedding\s+IS\s+NOT\s+NULL[\s\S]*faq\.aktif\s*=\s*true[\s\S]*p_layanan_id\s+IS\s+NULL\s+OR\s+faq\.layanan_id\s*=\s*p_layanan_id/i);
    expect(security).toMatch(/ORDER\s+BY\s+faq\.embedding\s+OPERATOR\(extensions\.<=>\)\s+query_embedding[\s\S]*LIMIT\s+match_count/i);
  });
});
