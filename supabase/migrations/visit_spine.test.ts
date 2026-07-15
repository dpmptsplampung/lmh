// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readAllBaseline, readBaseline, stripSqlComments } from './migration-test-utils';

describe('final visit spine baseline', () => {
  const core = readBaseline(1);
  const security = readBaseline(3);
  const all = stripSqlComments(readAllBaseline());

  it('creates visit directly with the final lifecycle and indexes', () => {
    expect(core).toMatch(/CREATE\s+TABLE\s+public\.visit/i);
    expect(core).toMatch(/asal\s+text\s+NOT\s+NULL[\s\S]*'walk_in'[\s\S]*'reservasi'/i);
    expect(core).toMatch(/status\s+text\s+NOT\s+NULL[\s\S]*'no_show'/i);
    expect(core).toMatch(/qr_token\s+text\s+UNIQUE/i);
    expect(core).toMatch(/CREATE\s+INDEX\s+idx_visit_layanan_status/i);
  });

  it('contains every runtime visit column and reservation-compatible constraint', () => {
    for (const column of [
      'id', 'asal', 'pengunjung_id', 'nama', 'asal_instansi', 'layanan_id',
      'tujuan', 'nama_yang_ditemui', 'keperluan', 'qr_token', 'status',
      'tanggal_rencana', 'jam_rencana', 'waktu_masuk', 'waktu_scan',
      'waktu_mulai_layan', 'waktu_selesai', 'diarahkan_ke', 'catatan_petugas',
      'created_at', 'updated_at',
    ]) {
      expect(core).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(core).toMatch(/pengunjung_id\s+uuid\s+REFERENCES\s+public\.pengunjung\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(core).toMatch(/tujuan\s+text\s+CHECK\s*\(tujuan\s+IN\s*\('loket',\s*'bertemu_seseorang'\)\)/i);
    expect(core).toMatch(/qr_token\s+text\s+UNIQUE\s+DEFAULT\s+encode\(extensions\.gen_random_bytes\(16\),\s*'hex'\)/i);
    expect(core).toMatch(/CHECK\s*\(status\s+IN\s*\('terjadwal',\s*'menunggu',\s*'dilayani',\s*'selesai',\s*'batal',\s*'no_show'\)\)/i);
    for (const index of ['idx_visit_layanan_status', 'idx_visit_tanggal', 'idx_visit_qr', 'idx_visit_pengunjung', 'idx_visit_asal']) {
      expect(core).toMatch(new RegExp(`CREATE\\s+INDEX\\s+${index}\\b`, 'i'));
    }
  });

  it('requires the canonical name for both walk-in and reservation payloads', () => {
    expect(core).toMatch(/nama\s+text\s+NOT\s+NULL/i);
    expect(security).toMatch(/"visit_insert_reservasi"[\s\S]*asal\s*=\s*'reservasi'[\s\S]*pengunjung_id\s+IN/i);
  });

  it('allows owner SELECT but scopes UPDATE to petugas/admin only', () => {
    expect(security).toMatch(/CREATE\s+POLICY\s+"visit_select_own"[\s\S]*pengunjung_id[\s\S]*auth\.uid/i);
    const update = security.match(/CREATE\s+POLICY\s+"visit_update_staff"[\s\S]*?;/i)?.[0] ?? '';
    expect(update).toMatch(/layanan_id\s*=\s*public\.get_my_layanan_id\(\)|public\.get_my_role\(\)\s*=\s*'admin'/i);
    expect(update).not.toMatch(/pengunjung_id\s+IN/i);
    expect(security).not.toMatch(/CREATE\s+POLICY\s+"visit_update_own"/i);
  });

  it('has no legacy source tables, backfills, or dual-write functions', () => {
    expect(all).not.toMatch(/CREATE\s+TABLE\s+(?:public\.)?(?:kunjungan|reservasi)\b/i);
    expect(all).not.toMatch(/sync_(?:kunjungan|reservasi)|FROM\s+(?:public\.)?(?:kunjungan|reservasi)\b/i);
  });
});
