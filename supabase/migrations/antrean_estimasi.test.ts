// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final queue estimation views and jobs', () => {
  const sql = readBaseline(4);

  it('creates estimation views only after visit and layanan exist', () => {
    expect(sql).toMatch(/CREATE\s+MATERIALIZED\s+VIEW\s+public\.mv_estimasi_layanan/i);
    expect(sql).toMatch(/CREATE\s+VIEW\s+public\.v_antrian_loket/i);
    expect(sql).toMatch(/status\s*=\s*'selesai'/i);
    expect(sql).toMatch(/service\.tipe\s*=\s*'konsultatif'/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+public\.v_antrian_loket\s+TO\s+anon,\s*authenticated/i);
  });

  it('uses a 14-day completed-service duration and concurrent-refresh unique index', () => {
    expect(sql).toMatch(/avg\s*\(EXTRACT\s*\(EPOCH\s+FROM\s*\(visit\.waktu_selesai\s*-\s*visit\.waktu_mulai_layan\)\)\s*\/\s*60\)::integer/i);
    expect(sql).toMatch(/visit\.waktu_mulai_layan\s*>\s*now\(\)\s*-\s*INTERVAL\s+'14 days'/i);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_mv_estimasi_layanan_key\s+ON\s+public\.mv_estimasi_layanan\(layanan_id,\s*jam_slot\)/i);
    expect(sql).toMatch(/REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\s+public\.mv_estimasi_layanan/i);
  });

  it('computes queue wait from waiting count and active consultative services only', () => {
    expect(sql).toMatch(/count\(visit\.id\)\s+FILTER\s*\(WHERE\s+visit\.status\s*=\s*'menunggu'\)\s*\*\s*COALESCE/i);
    expect(sql).toMatch(/WHERE\s+service\.tipe\s*=\s*'konsultatif'\s+AND\s+service\.aktif\s*=\s*true/i);
  });

  it('exposes sample_count from mv_estimasi_layanan on v_antrian_loket', () => {
    expect(sql).toMatch(
      /COALESCE\s*\(\s*\(\s*SELECT\s+estimate\.sample_count\s+FROM\s+public\.mv_estimasi_layanan\s+AS\s+estimate[\s\S]*estimate\.jam_slot\s*=\s*EXTRACT\s*\(\s*HOUR\s+FROM\s+now\(\)\s*\)[\s\S]*\)\s*,\s*0\s*\)\s+AS\s+sample_count/i,
    );
  });

  it('schedules an idempotent five-minute refresh', () => {
    expect(sql).toMatch(/cron\.unschedule[\s\S]*refresh_estimasi/i);
    expect(sql).toMatch(/cron\.schedule\([\s\S]*'refresh_estimasi'[\s\S]*'\*\/5 \* \* \* \*'/i);
  });
});
