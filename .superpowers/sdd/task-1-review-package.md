# Task 1 Review Package — Final remediation
## New migration
diff --git a/supabase/migrations/202607300014_buku_tamu.sql b/supabase/migrations/202607300014_buku_tamu.sql
new file mode 100644
index 0000000..11db6c9
--- /dev/null
+++ b/supabase/migrations/202607300014_buku_tamu.sql
@@ -0,0 +1,37 @@
+-- 202607300014_buku_tamu.sql
+-- WP-21 / GST-01..04: private guest book with a traceable legacy-visit link.
+--
+-- ADITIF: visit remains unchanged and is still the transition source of truth.
+
+BEGIN;
+
+CREATE TABLE IF NOT EXISTS public.buku_tamu (
+  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  legacy_visit_id uuid UNIQUE REFERENCES public.visit(id) ON DELETE RESTRICT,
+  nama text NOT NULL,
+  asal text,
+  no_hp text,
+  menemui_siapa text NOT NULL,
+  keperluan text,
+  waktu_masuk timestamptz NOT NULL DEFAULT now(),
+  tanda_tangan_svg text,
+  dicatat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
+  created_at timestamptz NOT NULL DEFAULT now()
+);
+
+CREATE INDEX IF NOT EXISTS idx_buku_tamu_waktu
+  ON public.buku_tamu(waktu_masuk DESC);
+CREATE INDEX IF NOT EXISTS idx_buku_tamu_legacy_visit_id
+  ON public.buku_tamu(legacy_visit_id)
+  WHERE legacy_visit_id IS NOT NULL;
+
+ALTER TABLE public.buku_tamu ENABLE ROW LEVEL SECURITY;
+GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.buku_tamu TO authenticated;
+
+DROP POLICY IF EXISTS buku_tamu_fo_admin_all ON public.buku_tamu;
+CREATE POLICY buku_tamu_fo_admin_all ON public.buku_tamu
+  FOR ALL TO authenticated
+  USING (public.get_my_role() IN ('admin','front_office'))
+  WITH CHECK (public.get_my_role() IN ('admin','front_office'));
+
+COMMIT;

## Final static test
diff --git a/supabase/migrations/kunjungan_dual_write.test.ts b/supabase/migrations/kunjungan_dual_write.test.ts
new file mode 100644
index 0000000..3e6b810
--- /dev/null
+++ b/supabase/migrations/kunjungan_dual_write.test.ts
@@ -0,0 +1,36 @@
+// @vitest-environment node
+import { readFileSync } from 'node:fs';
+import { join } from 'node:path';
+import { describe, expect, it } from 'vitest';
+import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
+
+const readMigration = (name: string) =>
+  stripSqlComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
+
+describe('WP-21 atomic visit dual-write migrations', () => {
+  it('creates a private buku_tamu that can trace its legacy visit', () => {
+    const sql = readMigration('202607300014_buku_tamu.sql');
+    expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.buku_tamu/i);
+    expect(sql).toMatch(/id\s+uuid\s+PRIMARY\s+KEY/i);
+    expect(sql).toMatch(/nama\s+text\s+NOT\s+NULL/i);
+    expect(sql).toMatch(/asal\s+text/i);
+    expect(sql).toMatch(/no_hp\s+text/i);
+    expect(sql).toMatch(/menemui_siapa\s+text\s+NOT\s+NULL/i);
+    expect(sql).toMatch(/keperluan\s+text/i);
+    expect(sql).toMatch(/waktu_masuk\s+timestamptz\s+NOT\s+NULL/i);
+    expect(sql).toMatch(/tanda_tangan_svg\s+text/i);
+    expect(sql).toMatch(/dicatat_oleh\s+uuid\s+REFERENCES\s+public\.petugas\(id\)/i);
+    expect(sql).toMatch(/created_at\s+timestamptz\s+NOT\s+NULL/i);
+    expect(sql).toMatch(/legacy_visit_id\s+uuid\s+UNIQUE\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
+    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_buku_tamu_waktu\s+ON\s+public\.buku_tamu\s*\(waktu_masuk\s+DESC\)/i);
+    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_buku_tamu_legacy_visit_id\s+ON\s+public\.buku_tamu\s*\(legacy_visit_id\)\s+WHERE\s+legacy_visit_id\s+IS\s+NOT\s+NULL/i);
+    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.buku_tamu\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
+    expect(sql).toMatch(/GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+public\.buku_tamu\s+TO\s+authenticated/i);
+    expect(sql).toMatch(/CREATE\s+POLICY\s+buku_tamu_fo_admin_all\s+ON\s+public\.buku_tamu\s+FOR\s+ALL\s+TO\s+authenticated/i);
+    expect(sql).toMatch(/USING\s*\(public\.get_my_role\(\)\s+IN\s*\('admin','front_office'\)\)/i);
+    expect(sql).toMatch(/WITH\s+CHECK\s*\(public\.get_my_role\(\)\s+IN\s*\('admin','front_office'\)\)/i);
+    expect(sql.match(/CREATE\s+POLICY\b/gi)).toHaveLength(1);
+    expect(sql).not.toMatch(/(?:GRANT|CREATE\s+POLICY|ALTER\s+POLICY)[\s\S]*\bTO\s+(?:anon|public)\b/i);
+    expect(sql).not.toMatch(/(?:ALTER\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE)\s+public\.visit\b/i);
+  });
+});

## Inventory delta
diff --git a/supabase/migrations/migration-test-utils.ts b/supabase/migrations/migration-test-utils.ts
index d6e838b..337cf3e 100644
--- a/supabase/migrations/migration-test-utils.ts
+++ b/supabase/migrations/migration-test-utils.ts
@@ -12,29 +12,45 @@ export const BASELINE_FILES = [
 ] as const;
 
 export const FORWARD_MIGRATION_FILES = [
   '202607200001_p0_security_governance.sql',
   '202607210001_walkin_kontak_dan_layanan_perizinan.sql',
   '202607240001_pengunjung_no_hp.sql',
   '202607280001_layanan_jadwal.sql',
   '202607280002_chat_pesan_owner_strict.sql',
   '202607280003_faq_petugas_scope.sql',
   '202607280004_chat_pesan_client_uuid.sql',
+  '202607280005_antrian_hari_ini.sql',
+  '202607290001_observability_error_log.sql',
+  '202607290002_faq_reembed.sql',
+  '202607290003_antrean_counter.sql',
+  '202607290004_petugas_aktif.sql',
+  '202607290005_jadwal_harian_beku.sql',
+  '202607290006_skm_response_rate.sql',
+  '202607290007_pengaduan.sql',
+  '202607290008_standar_pelayanan.sql',
+  '202607290009_role_front_office.sql',
+  '202607290010_jadwal_standby.sql',
+  '202607290011_absensi_gerbang.sql',
+  '202607290012_layanan_kontak_notifikasi.sql',
+  '202607290013_kunjungan_tiket.sql',
+  '202607300014_buku_tamu.sql',
 ] as const;
 
 export function listMigrationFiles(): string[] {
   return readdirSync(MIGRATIONS_DIR)
     .filter((file) => file.endsWith('.sql'))
     .sort();
 }
 
 export function readBaseline(index: 0 | 1 | 2 | 3 | 4): string {
   return readFileSync(join(MIGRATIONS_DIR, BASELINE_FILES[index]), 'utf8');
 }
 
 export function readAllBaseline(): string {
   return BASELINE_FILES.map((_, index) => readBaseline(index as 0 | 1 | 2 | 3 | 4)).join('\n');
 }
 
 export function stripSqlComments(sql: string): string {
   return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
 }
+
