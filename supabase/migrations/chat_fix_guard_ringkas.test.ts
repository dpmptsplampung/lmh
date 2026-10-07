// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const sql = stripSqlComments(
  readFileSync(join(MIGRATIONS_DIR, '202610070001_chat_fix_guard_ringkas.sql'), 'utf8'),
);

describe('chat fix guard + ringkas migration', () => {
  it('guard mengizinkan service_role dan staf termasuk front_office', () => {
    expect(sql).toMatch(/auth\.role\(\)\s*=\s*'service_role'/i);
    expect(sql).toMatch(/get_my_role\(\)\s+IN\s+\('petugas',\s*'admin',\s*'front_office'\)/i);
    expect(sql).toMatch(/Pengunjung tidak boleh mengubah status/);
  });
  it('pesan baru menaikkan updated_at sesi', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_bump_chat_sesi_on_pesan\s+AFTER\s+INSERT\s+ON\s+public\.chat_pesan/i);
    // pesan bot tidak membump (hemat event realtime)
    expect(sql).toMatch(/WHEN\s+\(NEW\.pengirim\s+IN\s+\('pengunjung',\s*'petugas'\)\)/i);
  });
  it('ringkas dibatasi: bot 7 hari, eskalasi/aktif selalu, selesai opsional', () => {
    expect(sql).toMatch(/s\.status\s+IN\s+\('eskalasi',\s*'aktif'\)/i);
    expect(sql).toMatch(/s\.status\s*=\s*'bot'\s+AND\s+s\.updated_at\s*>\s*pg_catalog\.now\(\)\s*-\s*interval\s+'7 days'/i);
    expect(sql).toMatch(/p_include_selesai\s+AND\s+s\.status\s*=\s*'selesai'/i);
    expect(sql).toMatch(/idx_chat_sesi_status_updated/);
  });
  it('chat_sesi_ringkas SECURITY INVOKER, hanya authenticated', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.chat_sesi_ringkas[\s\S]*SECURITY\s+INVOKER/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.chat_sesi_ringkas\(integer,\s*boolean\)\s+TO\s+authenticated/i);
    expect(sql).toMatch(/LEAST\(/i);
  });
});
