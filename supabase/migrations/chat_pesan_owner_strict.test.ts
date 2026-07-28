// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

describe('chat_pesan owner insert hardening', () => {
  const raw = readFileSync(
    join(MIGRATIONS_DIR, '202607280002_chat_pesan_owner_strict.sql'),
    'utf8',
  );
  const sql = stripSqlComments(raw);

  it('recreates chat_pesan_owner_insert', () => {
    expect(sql).toMatch(/DROP\s+POLICY\s+"chat_pesan_owner_insert"\s+ON\s+public\.chat_pesan/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"chat_pesan_owner_insert"\s+ON\s+public\.chat_pesan\s+FOR\s+INSERT\s+TO\s+authenticated/i);
  });

  it('restricts session owners to pengirim=pengunjung only', () => {
    expect(sql).toMatch(/pengirim\s*=\s*'pengunjung'[\s\S]*pengunjung_id\s+IN\s*\(SELECT\s+id\s+FROM\s+public\.pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\(\)\)/i);
  });

  it('keeps petugas inserts scoped to their layanan and admin unrestricted', () => {
    expect(sql).toMatch(/pengirim\s*=\s*'petugas'\s+AND\s+layanan_id\s*=\s*public\.get_my_layanan_id\(\)/i);
    expect(sql).toMatch(/get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('never allows client-side pengirim=bot', () => {
    const policyMatch = sql.match(/CREATE\s+POLICY\s+"chat_pesan_owner_insert"[\s\S]*$/i);
    expect(policyMatch).toBeTruthy();
    expect(policyMatch![0]).not.toMatch(/pengirim\s*=\s*'bot'/i);
  });

  it('keeps anonymous rate limiting for non-staff', () => {
    expect(sql).toMatch(/check_anon_rate\('chat_pesan_insert',\s*20,\s*60\)/i);
  });
});
