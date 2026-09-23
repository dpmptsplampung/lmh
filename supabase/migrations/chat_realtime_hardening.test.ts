import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(__dirname, '202609230001_chat_realtime_hardening.sql'),
  'utf8',
);

describe('chat realtime hardening migration', () => {
  it('menjaga publikasi realtime dengan pemeriksaan (idempoten)', () => {
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*?chat_sesi[\s\S]*?ADD TABLE public\.chat_sesi/i);
    expect(sql).toMatch(/IF NOT EXISTS[\s\S]*?chat_pesan[\s\S]*?ADD TABLE public\.chat_pesan/i);
  });

  it('mengatur REPLICA IDENTITY FULL untuk kedua tabel', () => {
    expect(sql).toMatch(/ALTER TABLE public\.chat_sesi REPLICA IDENTITY FULL/i);
    expect(sql).toMatch(/ALTER TABLE public\.chat_pesan REPLICA IDENTITY FULL/i);
  });

  it('membuat indeks unik (sesi_id, client_uuid) untuk idempotensi', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_pesan_sesi_client_uuid/i);
    expect(sql).toMatch(/WHERE client_uuid IS NOT NULL/i);
  });

  it('menyertakan front_office pada policy select/update chat', () => {
    const selectCount = (sql.match(/"chat_sesi_owner_select"/g) ?? []).length;
    expect(selectCount).toBeGreaterThanOrEqual(2); // DROP + CREATE
    expect(sql).toMatch(/'admin', 'front_office'/);
  });
});
