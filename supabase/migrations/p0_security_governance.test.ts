// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

describe('P0 security & governance migration', () => {
  const raw = readFileSync(
    join(MIGRATIONS_DIR, '202607200001_p0_security_governance.sql'),
    'utf8',
  );
  const sql = stripSqlComments(raw);

  it('recreates visit_insert_walk_in with pengunjung ownership binding', () => {
    expect(sql).toMatch(/DROP\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+public\.visit/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"visit_insert_walk_in"[\s\S]*pengunjung_id\s+IS\s+NULL[\s\S]*auth_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"visit_insert_walk_in"[\s\S]*check_anon_rate\('visit_insert_walk_in'/i);
  });

  it('guards chat_sesi staff columns from pengunjung updates', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.guard_chat_sesi_staff_columns/i);
    expect(sql).toMatch(/NEW\.status\s+IS\s+DISTINCT\s+FROM\s+OLD\.status/i);
    expect(sql).toMatch(/NEW\.ditangani_oleh\s+IS\s+DISTINCT\s+FROM\s+OLD\.ditangani_oleh/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_guard_chat_sesi_staff\s+BEFORE\s+UPDATE\s+ON\s+public\.chat_sesi/i);
  });

  it('limits listing_staff_insert to draft/pending_review for non-admin', () => {
    expect(sql).toMatch(/DROP\s+POLICY\s+"listing_staff_insert"\s+ON\s+public\.listing_umkm/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"listing_staff_insert"[\s\S]*'draft'[\s\S]*'pending_review'/i);
  });

  it('audits petugas role escalation', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_petugas_role\s+AFTER\s+UPDATE\s+OF\s+role\s+ON\s+public\.petugas[\s\S]*audit_change\('update_role'\)/i);
  });

  it('allows admin to record UMKM public-contact consent', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"consent_log_admin_insert"\s+ON\s+public\.consent_log\s+FOR\s+INSERT\s+TO\s+authenticated/i);
    expect(sql).toMatch(/consent_log_admin_insert[\s\S]*get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('blocks absensi backdating via trigger and allows status ditolak', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.guard_absensi_tanggal_today/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_guard_absensi_tanggal\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+tanggal\s+ON\s+public\.absensi_petugas/i);
    expect(sql).toMatch(/Tanggal absensi harus hari ini/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+absensi_petugas_status_check\s+CHECK\s*\(status\s+IN\s*\('pending',\s*'approved',\s*'ditolak'\)\)/i);
  });

  it('stops claiming failed notifications retried five or more times', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.claim_notifikasi/i);
    expect(sql).toMatch(/p_status\s*=\s*'failed'\s+AND\s+n\.retry_count\s*<\s*5/i);
    expect(sql).not.toMatch(/n\.retry_count\s*<\s*3/i);
  });

  it('adds a daily 03:30 chat_ai_log retention cron', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.prune_chat_ai_log/i);
    expect(sql).toMatch(/INTERVAL\s+'90 days'/i);
    expect(sql).toMatch(/cron\.schedule\([\s\S]*'prune_chat_ai_log'[\s\S]*'30 3 \* \* \*'/i);
  });

  it('exposes get_queue_position with the exact contract signature', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.get_queue_position\(p_qr_token\s+uuid\)/i);
    expect(sql).toMatch(/RETURNS\s+TABLE\s*\(posisi\s+int,\s*total_menunggu\s+int\)/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_queue_position\(uuid\)\s+TO\s+anon,\s*authenticated/i);
  });

  it('notifies visitors on petugas chat replies', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.notify_chat_petugas_reply/i);
    expect(sql).toMatch(/NEW\.pengirim\s*<>\s*'petugas'/i);
    expect(sql).toMatch(/Petugas telah membalas chat Anda/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_notify_chat_petugas_reply\s+AFTER\s+INSERT\s+ON\s+public\.chat_pesan/i);
  });

  it('emails inquiry senders on approved/rejected transitions', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.notify_umkm_inquiry_status/i);
    expect(sql).toMatch(/Status inquiry listing UMKM Anda/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_notify_umkm_inquiry_status\s+AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.umkm_inquiry/i);
  });

  it('notifies visitors when a reservasi is confirmed to the queue', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.notify_reservasi_confirmed/i);
    expect(sql).toMatch(/NEW\.status\s*=\s*'menunggu'\s+AND\s+OLD\.status\s*=\s*'terjadwal'/i);
    expect(sql).toMatch(/Reservasi Anda telah dikonfirmasi/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_notify_reservasi_confirmed\s+AFTER\s+UPDATE\s+OF\s+status\s+ON\s+public\.visit/i);
  });

  it('keeps every new definer function on a fixed path with execute revoked', () => {
    const definitions = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([^;]*?SECURITY\s+DEFINER[\s\S]*?;/gi)];
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition[0]).toMatch(/SET\s+search_path\s*=\s*(?:''|pg_catalog(?:\s*,\s*public)?)/i);
      const fn = definition[1].split('.').at(-1)!;
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, 'i'));
    }
  });
});
