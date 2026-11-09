// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const sql = readFileSync(new URL('./202611090012_umkm_kontak_kata_utuh.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../docs/rollback-umkm-kontak-kata-utuh-202611090012.sql', import.meta.url),
  'utf8');
it('pola tautan kontak hanya cocok sebagai kata utuh, deteksi nomor tetap', () => {
  for (const token of ['\\mwa[[:space:]]*[.][[:space:]]*(me|link)\\M', '\\mt[[:space:]]*[.][[:space:]]*me\\M',
    '\\mlinktr[[:space:]]*[.][[:space:]]*ee\\M', '\\mwhatsapp[[:space:]]*[.][[:space:]]*com\\M',
    "sisa ~ '^(0[1-9]|62|8[1-9])'", 'SET search_path = pg_catalog, pg_temp',
    'REVOKE ALL ON FUNCTION umkm_private.ada_kontak(text) FROM PUBLIC, anon, authenticated, service_role']) {
    expect(sql).toContain(token);
  }
  expect(sql).not.toMatch(/'t\[\[:space:\]\]\*\[\.\]/);
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
  expect(rollback).toContain("'t[[:space:]]*[.][[:space:]]*me|linktr[[:space:]]*[.][[:space:]]*ee'");
  expect(mengandungKontrolTransaksi(rollback)).toBe(false);
});
