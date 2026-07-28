// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

describe('FAQ petugas scoping migration', () => {
  const raw = readFileSync(
    join(MIGRATIONS_DIR, '202607280003_faq_petugas_scope.sql'),
    'utf8',
  );
  const sql = stripSqlComments(raw);

  it('allows petugas full CRUD on their own layanan FAQ only', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"faq_petugas_all"\s+ON\s+public\.faq_knowledge_base\s+FOR\s+ALL\s+TO\s+authenticated/i);
    expect(sql).toMatch(/faq_petugas_all[\s\S]*layanan_id\s*=\s*public\.get_my_layanan_id\(\)/i);
  });

  it('lets admin manage layanan and petugas toggle their own chatbot flag', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"layanan_admin_all"\s+ON\s+public\.layanan\s+FOR\s+ALL[\s\S]*get_my_role\(\)\s*=\s*'admin'/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"layanan_petugas_chatbot_toggle"\s+ON\s+public\.layanan\s+FOR\s+UPDATE[\s\S]*id\s*=\s*public\.get_my_layanan_id\(\)/i);
  });
});
