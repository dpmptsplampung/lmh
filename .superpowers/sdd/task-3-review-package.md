# Task 3 Review Package
## Verifier
diff --git a/scripts/selftest-wp21.mjs b/scripts/selftest-wp21.mjs
new file mode 100644
index 0000000..23cb65b
--- /dev/null
+++ b/scripts/selftest-wp21.mjs
@@ -0,0 +1,449 @@
+import { randomBytes } from 'node:crypto';
+import { readFileSync } from 'node:fs';
+import { dirname, join } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import { createClient } from '@supabase/supabase-js';
+
+const root = join(dirname(fileURLToPath(import.meta.url)), '..');
+const env = Object.fromEntries(
+  readFileSync(join(root, '.env.local'), 'utf8').split('\n')
+    .filter((line) => line && !line.startsWith('#') && line.includes('='))
+    .map((line) => {
+      const index = line.indexOf('=');
+      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
+    }),
+);
+const url = env.NEXT_PUBLIC_SUPABASE_URL;
+const key = env.SUPABASE_SERVICE_ROLE_KEY;
+
+if (!url || !key) {
+  throw new Error('Kredensial Supabase tidak lengkap di .env.local');
+}
+
+const args = process.argv.slice(2);
+if (args.some((arg) => arg !== '--preflight')) {
+  throw new Error('Pemakaian: node scripts/selftest-wp21.mjs [--preflight]');
+}
+
+const preflightOnly = args.includes('--preflight');
+const s = createClient(url, key, { auth: { persistSession: false } });
+const SELFTEST_PREFIX = 'SELFTEST_WP21_';
+// Keep the requested LIKE evidence while starts_with makes underscores literal.
+const selftestVisitWhere = "nama LIKE 'SELFTEST_WP21_%' AND starts_with(nama, 'SELFTEST_WP21_')";
+
+function assert(condition, message) {
+  if (!condition) throw new Error(message);
+}
+
+function sqlLiteral(value) {
+  return `'${String(value).replaceAll("'", "''")}'`;
+}
+
+function onlyRow(rows, context) {
+  assert(Array.isArray(rows) && rows.length === 1, `${context}: tepat satu baris diperlukan`);
+  return rows[0];
+}
+
+function asInt(value, context) {
+  const number = Number(value);
+  assert(Number.isInteger(number), `${context}: nilai integer tidak valid`);
+  return number;
+}
+
+async function query(q) {
+  const result = await s.rpc('exec_query', { q });
+  if (result.error) throw new Error(`exec_query gagal: ${result.error.message}`);
+  return result.data ?? [];
+}
+
+async function exec(q) {
+  const result = await s.rpc('exec_sql', { q });
+  if (result.error) throw new Error(`exec_sql gagal: ${result.error.message}`);
+  return result.data;
+}
+
+async function runPreflight() {
+  // M20-only reads: safe before M15 creates buku_tamu.
+  const preflight = await s.rpc('exec_query', {
+    q: `SELECT tujuan, asal, status, count(*)::int AS n
+        FROM public.visit
+        GROUP BY tujuan, asal, status ORDER BY tujuan, asal, status`,
+  });
+  if (preflight.error) throw new Error(preflight.error.message);
+  console.log('distribusi visit:', JSON.stringify(preflight.data));
+
+  const targets = await s.rpc('exec_query', {
+    q: `SELECT
+          (SELECT count(*)::int FROM public.kunjungan) AS kunjungan_count,
+          (SELECT count(*)::int FROM public.tiket_antrean) AS tiket_count,
+          has_schema_privilege('PUBLIC', 'public', 'CREATE') AS public_can_create`,
+  });
+  if (targets.error) throw new Error(targets.error.message);
+  const target = onlyRow(targets.data, 'preflight target WP-20');
+  if (asInt(target.kunjungan_count, 'kunjungan_count') !== 0
+    || asInt(target.tiket_count, 'tiket_count') !== 0) {
+    throw new Error('WP-21 dihentikan: target WP-20 tidak kosong');
+  }
+  console.log('PUBLIC dapat CREATE di public (harus false setelah M16):', target.public_can_create);
+  console.log('preflight WP-21 selesai: target WP-20 kosong; tidak ada mutasi dilakukan.');
+}
+
+async function assertM16Ready() {
+  const readiness = onlyRow(await query(`
+    SELECT
+      to_regclass('public.buku_tamu') IS NOT NULL AS buku_tamu_exists,
+      EXISTS (
+        SELECT 1 FROM information_schema.columns
+        WHERE table_schema = 'public' AND table_name = 'kunjungan'
+          AND column_name = 'legacy_visit_id'
+      ) AS kunjungan_legacy_exists,
+      EXISTS (
+        SELECT 1 FROM information_schema.columns
+        WHERE table_schema = 'public' AND table_name = 'tiket_antrean'
+          AND column_name = 'legacy_visit_id'
+      ) AS tiket_legacy_exists,
+      EXISTS (
+        SELECT 1 FROM pg_trigger
+        WHERE tgrelid = 'public.visit'::regclass
+          AND tgname = 'trg_visit_dual_write'
+          AND NOT tgisinternal
+      ) AS dual_write_trigger_exists,
+      has_schema_privilege('PUBLIC', 'public', 'CREATE') AS public_can_create
+  `), 'kesiapan M15/M16');
+
+  assert(readiness.buku_tamu_exists === true, 'M15 belum siap: public.buku_tamu tidak ada');
+  assert(readiness.kunjungan_legacy_exists === true, 'M16 belum siap: kunjungan.legacy_visit_id tidak ada');
+  assert(readiness.tiket_legacy_exists === true, 'M16 belum siap: tiket_antrean.legacy_visit_id tidak ada');
+  assert(readiness.dual_write_trigger_exists === true, 'M16 belum siap: trg_visit_dual_write tidak ada');
+  assert(readiness.public_can_create === false, 'M16 belum siap: PUBLIC masih dapat CREATE pada schema public');
+  console.log('kesiapan M15/M16:', JSON.stringify(readiness));
+}
+
+async function assertNoPriorSelftestRows() {
+  const prior = onlyRow(await query(`
+    SELECT count(*)::int AS n FROM public.visit WHERE ${selftestVisitWhere}
+  `), 'baris selftest sebelumnya');
+  assert(asInt(prior.n, 'baris selftest sebelumnya') === 0,
+    'selftest dihentikan: masih ada baris SELFTEST_WP21_ dari eksekusi sebelumnya');
+}
+
+async function assertHistoricalCoverage() {
+  const visitCount = onlyRow(await query(`
+    SELECT count(*)::int AS visit_count FROM public.visit;
+  `), 'visit_count');
+  const linkedKunjungan = onlyRow(await query(`
+    SELECT count(*)::int AS linked_kunjungan
+    FROM public.visit v JOIN public.kunjungan k ON k.legacy_visit_id = v.id
+    WHERE v.tujuan = 'loket';
+  `), 'linked_kunjungan');
+  const orphanKunjungan = onlyRow(await query(`
+    SELECT count(*)::int AS orphan_kunjungan
+    FROM public.kunjungan k
+    LEFT JOIN public.visit v ON v.id = k.legacy_visit_id
+    WHERE k.legacy_visit_id IS NOT NULL AND v.id IS NULL;
+  `), 'orphan_kunjungan');
+  const counterBehind = onlyRow(await query(`
+    SELECT count(*)::int AS counter_behind
+    FROM (
+      SELECT t.layanan_id, t.tanggal, max(t.nomor) AS ticket_max,
+             max(c.nomor_terakhir) AS counter_max
+      FROM public.tiket_antrean t
+      LEFT JOIN public.antrean_counter c USING (layanan_id, tanggal)
+      GROUP BY t.layanan_id, t.tanggal
+    ) x WHERE counter_max IS NULL OR counter_max < ticket_max;
+  `), 'counter_behind');
+  const loketCount = onlyRow(await query(`
+    SELECT count(*)::int AS loket_count FROM public.visit WHERE tujuan = 'loket';
+  `), 'loket_count');
+  console.log('historis visit_count:', JSON.stringify(visitCount));
+  console.log('historis linked_kunjungan:', JSON.stringify(linkedKunjungan));
+  console.log('historis orphan_kunjungan:', JSON.stringify(orphanKunjungan));
+  console.log('historis counter_behind:', JSON.stringify(counterBehind));
+
+  assert(asInt(visitCount.visit_count, 'visit_count') >= 0,
+    'cakupan historis gagal: visit_count tidak valid');
+  assert(asInt(linkedKunjungan.linked_kunjungan, 'linked_kunjungan')
+    === asInt(loketCount.loket_count, 'loket_count'),
+  'cakupan historis gagal: setiap visit loket harus memiliki kunjungan terkait');
+  assert(asInt(orphanKunjungan.orphan_kunjungan, 'orphan_kunjungan') === 0,
+    'cakupan historis gagal: ditemukan kunjungan legacy yatim');
+  assert(asInt(counterBehind.counter_behind, 'counter_behind') === 0,
+    'cakupan historis gagal: antrean_counter tertinggal dari tiket');
+}
+
+async function findRuntimeTarget() {
+  const rows = await query(`
+    SELECT l.id, l.nama,
+           public.jadwal_berikutnya(
+             l.id,
+             (now() AT TIME ZONE 'Asia/Jakarta')::date
+           ) AS tanggal
+    FROM public.layanan AS l
+    WHERE l.aktif = true
+      AND l.punya_antrean = true
+      AND public.jadwal_berikutnya(
+        l.id,
+        (now() AT TIME ZONE 'Asia/Jakarta')::date
+      ) IS NOT NULL
+    ORDER BY l.nama
+    LIMIT 1;
+  `);
+  return rows[0] ?? null;
+}
+
+async function getCounterSnapshot(layananId, tanggal) {
+  const rows = await query(`
+    SELECT nomor_terakhir
+    FROM public.antrean_counter
+    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+      AND tanggal = ${sqlLiteral(tanggal)}::date;
+  `);
+  assert(rows.length <= 1, 'snapshot counter: lebih dari satu baris ditemukan');
+  return rows.length === 0 ? null : asInt(rows[0].nomor_terakhir, 'snapshot nomor_terakhir');
+}
+
+async function countOwnTickets(layananId, tanggal) {
+  const result = onlyRow(await query(`
+    SELECT count(*)::int AS n
+    FROM public.tiket_antrean AS t
+    JOIN public.visit AS v ON v.id = t.legacy_visit_id
+    WHERE ${selftestVisitWhere}
+      AND t.layanan_id = ${sqlLiteral(layananId)}::uuid
+      AND t.tanggal = ${sqlLiteral(tanggal)}::date;
+  `), 'jumlah tiket selftest');
+  return asInt(result.n, 'jumlah tiket selftest');
+}
+
+async function assertReservationState(visitId, expectedStatus, expectedTicketCount) {
+  const state = onlyRow(await query(`
+    SELECT
+      (SELECT count(*)::int FROM public.kunjungan WHERE legacy_visit_id = ${sqlLiteral(visitId)}::uuid) AS kunjungan_count,
+      (SELECT count(*)::int FROM public.tiket_antrean WHERE legacy_visit_id = ${sqlLiteral(visitId)}::uuid) AS tiket_count,
+      (SELECT status FROM public.visit WHERE id = ${sqlLiteral(visitId)}::uuid) AS visit_status;
+  `), 'status reservasi selftest');
+  assert(asInt(state.kunjungan_count, 'kunjungan_count selftest') === 1,
+    'reservasi selftest harus menghasilkan tepat satu kunjungan');
+  assert(asInt(state.tiket_count, 'tiket_count selftest') === expectedTicketCount,
+    `reservasi selftest harus memiliki ${expectedTicketCount} tiket`);
+  assert(state.visit_status === expectedStatus,
+    `status visit selftest harus ${expectedStatus}`);
+}
+
+async function exerciseTriggers({ layananId, tanggal, baseName }) {
+  await exec(`
+    INSERT INTO public.visit (
+      nama, asal, layanan_id, tujuan, status, tanggal_rencana, created_at, updated_at
+    ) VALUES (
+      ${sqlLiteral(baseName)}, 'reservasi', ${sqlLiteral(layananId)}::uuid,
+      'loket', 'terjadwal', ${sqlLiteral(tanggal)}::date, now(), now()
+    );
+  `);
+  const loket = onlyRow(await query(`
+    SELECT id FROM public.visit WHERE nama = ${sqlLiteral(baseName)}
+  `), 'visit loket selftest');
+
+  await assertReservationState(loket.id, 'terjadwal', 0);
+
+  await exec(`
+    UPDATE public.visit
+    SET status = 'menunggu', waktu_scan = now(), waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
+    WHERE id = ${sqlLiteral(loket.id)}::uuid;
+  `);
+  await assertReservationState(loket.id, 'menunggu', 1);
+
+  await exec(`
+    UPDATE public.visit
+    SET status = 'menunggu', waktu_scan = now(), waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
+    WHERE id = ${sqlLiteral(loket.id)}::uuid;
+  `);
+  await assertReservationState(loket.id, 'menunggu', 1);
+
+  await exec(`
+    UPDATE public.visit
+    SET status = 'dilayani', waktu_mulai_layan = now(), updated_at = now()
+    WHERE id = ${sqlLiteral(loket.id)}::uuid;
+  `);
+  await exec(`
+    UPDATE public.visit
+    SET status = 'selesai', waktu_selesai = now(), updated_at = now()
+    WHERE id = ${sqlLiteral(loket.id)}::uuid;
+  `);
+  const lifecycle = onlyRow(await query(`
+    SELECT
+      t.status = v.status AS status_equal,
+      t.waktu_mulai_layan IS NOT DISTINCT FROM v.waktu_mulai_layan AS mulai_equal,
+      t.waktu_selesai IS NOT DISTINCT FROM v.waktu_selesai AS selesai_equal
+    FROM public.tiket_antrean AS t
+    JOIN public.visit AS v ON v.id = t.legacy_visit_id
+    WHERE v.id = ${sqlLiteral(loket.id)}::uuid;
+  `), 'sinkronisasi lifecycle tiket');
+  assert(lifecycle.status_equal === true && lifecycle.mulai_equal === true && lifecycle.selesai_equal === true,
+    'lifecycle tiket tidak sama dengan lifecycle visit');
+  console.log('reservation/scan/lifecycle:', JSON.stringify(lifecycle));
+
+  const meetingName = `${baseName}_TAMU`;
+  await exec(`
+    INSERT INTO public.visit (
+      nama, asal, layanan_id, tujuan, nama_yang_ditemui, keperluan,
+      status, tanggal_rencana, created_at, updated_at
+    ) VALUES (
+      ${sqlLiteral(meetingName)}, 'reservasi', ${sqlLiteral(layananId)}::uuid,
+      'bertemu_seseorang', ${sqlLiteral(`SELFTEST penerima ${baseName}`)}, 'Selftest WP-21',
+      'terjadwal', ${sqlLiteral(tanggal)}::date, now(), now()
+    );
+  `);
+  const meeting = onlyRow(await query(`
+    SELECT id FROM public.visit WHERE nama = ${sqlLiteral(meetingName)}
+  `), 'visit meeting selftest');
+  const beforeScan = onlyRow(await query(`
+    SELECT count(*)::int AS n FROM public.buku_tamu
+    WHERE legacy_visit_id = ${sqlLiteral(meeting.id)}::uuid;
+  `), 'buku_tamu sebelum scan');
+  assert(asInt(beforeScan.n, 'buku_tamu sebelum scan') === 0,
+    'reservasi bertemu tidak boleh membuat buku_tamu sebelum scan');
+
+  await exec(`
+    UPDATE public.visit
+    SET status = 'menunggu', waktu_scan = now(), waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
+    WHERE id = ${sqlLiteral(meeting.id)}::uuid;
+  `);
+  const afterScan = onlyRow(await query(`
+    SELECT count(*)::int AS n FROM public.buku_tamu
+    WHERE legacy_visit_id = ${sqlLiteral(meeting.id)}::uuid;
+  `), 'buku_tamu setelah scan');
+  assert(asInt(afterScan.n, 'buku_tamu setelah scan') === 1,
+    'reservasi bertemu harus membuat tepat satu buku_tamu setelah scan');
+  console.log('guest-book branch:', JSON.stringify(afterScan));
+}
+
+async function restoreCounterIfSafe({ layananId, tanggal, savedCounter, ownTicketCount }) {
+  if (ownTicketCount === 0) return;
+
+  const expected = (savedCounter ?? 0) + ownTicketCount;
+  const currentRows = await query(`
+    SELECT nomor_terakhir
+    FROM public.antrean_counter
+    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+      AND tanggal = ${sqlLiteral(tanggal)}::date;
+  `);
+  const current = currentRows.length === 0
+    ? null
+    : asInt(onlyRow(currentRows, 'counter saat cleanup').nomor_terakhir, 'counter saat cleanup');
+  if (current !== expected) {
+    throw new Error(`counter tidak disentuh: nilai ${current ?? 'NULL'} bukan nilai aman ${expected}`);
+  }
+
+  if (savedCounter === null) {
+    await exec(`
+      DELETE FROM public.antrean_counter
+      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+        AND tanggal = ${sqlLiteral(tanggal)}::date
+        AND nomor_terakhir = ${expected};
+    `);
+    const after = await query(`
+      SELECT nomor_terakhir FROM public.antrean_counter
+      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+        AND tanggal = ${sqlLiteral(tanggal)}::date;
+    `);
+    assert(after.length === 0,
+      'counter tidak dihapus: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
+  } else {
+    await exec(`
+      UPDATE public.antrean_counter
+      SET nomor_terakhir = ${savedCounter}
+      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+        AND tanggal = ${sqlLiteral(tanggal)}::date
+        AND nomor_terakhir = ${expected};
+    `);
+    const after = onlyRow(await query(`
+      SELECT nomor_terakhir FROM public.antrean_counter
+      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
+        AND tanggal = ${sqlLiteral(tanggal)}::date;
+    `), 'counter setelah restore');
+    assert(asInt(after.nomor_terakhir, 'counter setelah restore') === savedCounter,
+      'counter tidak dipulihkan: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
+  }
+  console.log('counter dipulihkan dengan guard konkurensi: OK');
+}
+
+async function cleanup({ layananId, tanggal, savedCounter }) {
+  const ownTicketCount = await countOwnTickets(layananId, tanggal);
+
+  // Children are always removed before their source visits.
+  await exec(`
+    DELETE FROM public.tiket_antrean
+    WHERE kunjungan_id IN (
+      SELECT id FROM public.kunjungan WHERE legacy_visit_id IN (
+        SELECT id FROM public.visit WHERE ${selftestVisitWhere}
+      )
+    );
+  `);
+  await exec(`
+    DELETE FROM public.kunjungan
+    WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE ${selftestVisitWhere});
+  `);
+  await exec(`
+    DELETE FROM public.buku_tamu
+    WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE ${selftestVisitWhere});
+  `);
+  await exec(`DELETE FROM public.visit WHERE ${selftestVisitWhere};`);
+
+  const finalRows = onlyRow(await query(`
+    SELECT count(*)::int AS n FROM public.visit WHERE ${selftestVisitWhere};
+  `), 'baris selftest akhir');
+  console.log('baris SELFTEST_WP21_ tersisa (harus 0):', JSON.stringify(finalRows));
+  assert(asInt(finalRows.n, 'baris selftest akhir') === 0,
+    'cleanup gagal: masih ada visit SELFTEST_WP21_');
+
+  await restoreCounterIfSafe({ layananId, tanggal, savedCounter, ownTicketCount });
+  console.log('cleanup WP-21 selesai.');
+}
+
+async function runFull() {
+  await assertM16Ready();
+  await assertNoPriorSelftestRows();
+  await assertHistoricalCoverage();
+
+  const target = await findRuntimeTarget();
+  if (!target) {
+    console.log('uji runtime WP-21 dilewati: tidak ada layanan aktif dengan hari buka berikutnya.');
+    return;
+  }
+  assert(target.id && target.tanggal, 'target runtime WP-21 tidak lengkap');
+  console.log('target runtime:', JSON.stringify({ layanan: target.nama, tanggal: target.tanggal }));
+
+  const savedCounter = await getCounterSnapshot(target.id, target.tanggal);
+  const baseName = `${SELFTEST_PREFIX}${randomBytes(16).toString('hex')}`;
+  let exerciseError;
+  try {
+    await exerciseTriggers({ layananId: target.id, tanggal: target.tanggal, baseName });
+  } catch (error) {
+    exerciseError = error;
+  }
+
+  let cleanupError;
+  try {
+    await cleanup({ layananId: target.id, tanggal: target.tanggal, savedCounter });
+  } catch (error) {
+    cleanupError = error;
+  }
+
+  if (exerciseError && cleanupError) {
+    throw new AggregateError([exerciseError, cleanupError], 'uji runtime dan cleanup WP-21 gagal');
+  }
+  if (exerciseError) throw exerciseError;
+  if (cleanupError) throw cleanupError;
+}
+
+async function main() {
+  if (preflightOnly) {
+    await runPreflight();
+    return;
+  }
+  await runFull();
+}
+
+main().catch((error) => {
+  console.error(`selftest-wp21 gagal: ${error.message}`);
+  process.exitCode = 1;
+});

## M16 dependency
diff --git a/supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql b/supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql
new file mode 100644
index 0000000..074a7b3
--- /dev/null
+++ b/supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql
@@ -0,0 +1,384 @@
+-- WP-21 / OPS-02: traceable one-time backfill and atomic visit dual-write.
+-- `visit` remains the transition source of truth; this migration never mutates it.
+
+BEGIN;
+
+REVOKE CREATE ON SCHEMA public FROM PUBLIC;
+
+ALTER TABLE public.kunjungan
+  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
+ALTER TABLE public.kunjungan
+  DROP CONSTRAINT IF EXISTS kunjungan_legacy_visit_id_key;
+ALTER TABLE public.kunjungan
+  ADD CONSTRAINT kunjungan_legacy_visit_id_key UNIQUE (legacy_visit_id);
+
+CREATE INDEX IF NOT EXISTS idx_kunjungan_legacy_visit_id
+  ON public.kunjungan(legacy_visit_id) WHERE legacy_visit_id IS NOT NULL;
+
+ALTER TABLE public.tiket_antrean
+  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
+ALTER TABLE public.tiket_antrean
+  DROP CONSTRAINT IF EXISTS tiket_antrean_legacy_visit_id_key;
+ALTER TABLE public.tiket_antrean
+  ADD CONSTRAINT tiket_antrean_legacy_visit_id_key UNIQUE (legacy_visit_id);
+
+DO $$
+BEGIN
+  IF to_regclass('public.wp21_backfill_ledger') IS NULL THEN
+    CREATE TABLE public.wp21_backfill_ledger (
+      visit_id uuid PRIMARY KEY REFERENCES public.visit(id) ON DELETE RESTRICT,
+      kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE RESTRICT,
+      tiket_id uuid REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
+      buku_tamu_id uuid REFERENCES public.buku_tamu(id) ON DELETE RESTRICT,
+      backed_up_at timestamptz NOT NULL DEFAULT now(),
+      CHECK (
+        (kunjungan_id IS NOT NULL AND buku_tamu_id IS NULL)
+        OR (kunjungan_id IS NULL AND tiket_id IS NULL AND buku_tamu_id IS NOT NULL)
+      )
+    );
+  END IF;
+END $$;
+
+ALTER TABLE public.wp21_backfill_ledger ENABLE ROW LEVEL SECURITY;
+GRANT SELECT ON TABLE public.wp21_backfill_ledger TO authenticated;
+DROP POLICY IF EXISTS wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger;
+CREATE POLICY wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger
+  FOR SELECT TO authenticated USING (public.get_my_role() = 'admin');
+
+-- Block concurrent source/target writes so the source snapshot and trigger handoff
+-- cannot leave a visit between the backfill and dual-write phases.
+LOCK TABLE public.visit, public.kunjungan, public.tiket_antrean, public.buku_tamu,
+  public.wp21_backfill_ledger IN SHARE ROW EXCLUSIVE MODE;
+
+-- This is deliberately all-or-nothing: a partially populated target cannot be
+-- distinguished from a completed backfill without violating traceability.
+DO $$
+BEGIN
+  IF EXISTS (SELECT 1 FROM public.kunjungan)
+    OR EXISTS (SELECT 1 FROM public.tiket_antrean)
+    OR EXISTS (SELECT 1 FROM public.buku_tamu)
+    OR EXISTS (SELECT 1 FROM public.wp21_backfill_ledger) THEN
+    RAISE EXCEPTION 'WP-21 backfill requires empty kunjungan, tiket_antrean, buku_tamu, and ledger tables';
+  END IF;
+END $$;
+
+DO $$
+BEGIN
+  IF EXISTS (
+    SELECT 1 FROM public.visit
+    WHERE tujuan = 'loket' AND layanan_id IS NULL
+  ) THEN
+    RAISE EXCEPTION 'WP-21 tidak dapat memetakan visit loket tanpa layanan_id';
+  END IF;
+
+  IF EXISTS (
+    SELECT 1 FROM public.visit
+    WHERE tujuan = 'bertemu_seseorang'
+      AND waktu_scan IS NOT NULL
+      AND nama_yang_ditemui IS NULL
+  ) THEN
+    RAISE EXCEPTION 'WP-21 tidak dapat memetakan kedatangan tamu tanpa nama_yang_ditemui';
+  END IF;
+END $$;
+
+INSERT INTO public.kunjungan (
+  legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
+  tanggal, waktu_masuk, status, created_at, updated_at
+)
+SELECT
+  v.id,
+  v.pengunjung_id,
+  v.nama,
+  v.kontak_hp,
+  v.asal,
+  v.qr_token,
+  COALESCE(
+    v.tanggal_rencana,
+    (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
+    (v.created_at AT TIME ZONE 'Asia/Jakarta')::date
+  ),
+  COALESCE(v.waktu_masuk, v.created_at),
+  v.status,
+  v.created_at,
+  v.updated_at
+FROM public.visit AS v
+WHERE v.tujuan = 'loket'
+ORDER BY v.id
+ON CONFLICT (legacy_visit_id) DO NOTHING;
+
+INSERT INTO public.buku_tamu (
+  legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan,
+  waktu_masuk, created_at
+)
+SELECT
+  v.id,
+  v.nama,
+  v.asal_instansi,
+  v.kontak_hp,
+  v.nama_yang_ditemui,
+  v.keperluan,
+  COALESCE(v.waktu_scan, v.waktu_masuk, v.created_at),
+  v.created_at
+FROM public.visit AS v
+WHERE v.tujuan = 'bertemu_seseorang'
+  AND v.waktu_scan IS NOT NULL
+ORDER BY v.id
+ON CONFLICT (legacy_visit_id) DO NOTHING;
+
+WITH historical_tickets AS (
+  SELECT
+    v.id AS visit_id,
+    k.id AS kunjungan_id,
+    v.layanan_id,
+    k.tanggal,
+    v.status,
+    COALESCE(v.waktu_scan, v.waktu_masuk, v.created_at) AS waktu_terbit,
+    v.waktu_mulai_layan,
+    v.waktu_selesai,
+    v.created_at,
+    v.updated_at,
+    ROW_NUMBER() OVER (
+      PARTITION BY v.layanan_id, k.tanggal
+      ORDER BY COALESCE(v.waktu_masuk, v.created_at), v.id
+    )::int AS nomor
+  FROM public.visit AS v
+  INNER JOIN public.kunjungan AS k ON k.legacy_visit_id = v.id
+  WHERE v.tujuan = 'loket'
+    AND v.status <> 'terjadwal'
+    AND (
+      v.asal = 'walk_in'
+      OR (v.asal = 'reservasi' AND v.status <> 'terjadwal')
+    )
+)
+INSERT INTO public.tiket_antrean (
+  legacy_visit_id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status,
+  waktu_terbit, waktu_mulai_layan, waktu_selesai, created_at, updated_at
+)
+SELECT
+  h.visit_id,
+  h.kunjungan_id,
+  h.layanan_id,
+  h.tanggal,
+  h.nomor,
+  COALESCE(l.prefiks_antrean, upper(substr(l.nama, 1, 1)))
+    || '-' || lpad(h.nomor::text, 3, '0'),
+  h.status,
+  h.waktu_terbit,
+  h.waktu_mulai_layan,
+  h.waktu_selesai,
+  h.created_at,
+  h.updated_at
+FROM historical_tickets AS h
+INNER JOIN public.layanan AS l ON l.id = h.layanan_id
+ORDER BY h.layanan_id, h.tanggal, h.nomor;
+
+INSERT INTO public.wp21_backfill_ledger (
+  visit_id, kunjungan_id, tiket_id, buku_tamu_id
+)
+SELECT
+  v.id,
+  k.id,
+  t.id,
+  NULL
+FROM public.visit AS v
+INNER JOIN public.kunjungan AS k ON k.legacy_visit_id = v.id
+LEFT JOIN public.tiket_antrean AS t ON t.legacy_visit_id = v.id
+WHERE v.tujuan = 'loket'
+UNION ALL
+SELECT
+  v.id,
+  NULL,
+  NULL,
+  b.id
+FROM public.visit AS v
+INNER JOIN public.buku_tamu AS b ON b.legacy_visit_id = v.id
+WHERE v.tujuan = 'bertemu_seseorang';
+
+INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
+SELECT layanan_id, tanggal, max(nomor)
+FROM public.tiket_antrean
+GROUP BY layanan_id, tanggal
+ON CONFLICT (layanan_id, tanggal) DO UPDATE
+  SET nomor_terakhir = GREATEST(
+    public.antrean_counter.nomor_terakhir,
+    EXCLUDED.nomor_terakhir
+  );
+
+CREATE OR REPLACE FUNCTION public.sync_visit_dual_write()
+RETURNS trigger
+LANGUAGE plpgsql
+SECURITY DEFINER
+SET search_path = pg_catalog, public
+AS $$
+DECLARE
+  v_kunjungan_id uuid;
+  v_tiket_id uuid;
+  v_buku_tamu_id uuid;
+BEGIN
+  IF TG_OP = 'UPDATE'
+    AND NOT (
+      NEW.status IS DISTINCT FROM OLD.status
+      OR NEW.waktu_masuk IS DISTINCT FROM OLD.waktu_masuk
+      OR NEW.waktu_scan IS DISTINCT FROM OLD.waktu_scan
+      OR NEW.waktu_mulai_layan IS DISTINCT FROM OLD.waktu_mulai_layan
+      OR NEW.waktu_selesai IS DISTINCT FROM OLD.waktu_selesai
+    ) THEN
+    RETURN NEW;
+  END IF;
+
+  IF NEW.tujuan = 'loket' THEN
+    IF NEW.layanan_id IS NULL THEN
+      RAISE EXCEPTION 'Kunjungan dual-write membutuhkan layanan_id untuk visit %', NEW.id;
+    END IF;
+
+    IF TG_OP = 'INSERT' THEN
+      INSERT INTO public.kunjungan (
+        legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
+        tanggal, waktu_masuk, status, created_at, updated_at
+      ) VALUES (
+        NEW.id, NEW.pengunjung_id, NEW.nama, NEW.kontak_hp, NEW.asal, NEW.qr_token,
+        COALESCE(
+          NEW.tanggal_rencana,
+          (COALESCE(NEW.waktu_masuk, NEW.created_at) AT TIME ZONE 'Asia/Jakarta')::date
+        ),
+        COALESCE(NEW.waktu_masuk, NEW.created_at),
+        NEW.status,
+        NEW.created_at,
+        NEW.updated_at
+      ) ON CONFLICT (legacy_visit_id) DO NOTHING
+      RETURNING id INTO v_kunjungan_id;
+
+      SELECT id INTO v_kunjungan_id
+      FROM public.kunjungan WHERE legacy_visit_id = NEW.id;
+
+      IF NEW.asal = 'walk_in'
+        AND NEW.status <> 'terjadwal'
+        AND NOT EXISTS (
+          SELECT 1
+          FROM public.tiket_antrean AS t
+          WHERE t.legacy_visit_id = NEW.id
+        ) THEN
+        v_tiket_id := public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
+        UPDATE public.tiket_antrean
+        SET legacy_visit_id = NEW.id
+        WHERE id = v_tiket_id;
+      END IF;
+    ELSE
+      SELECT k.id INTO v_kunjungan_id
+      FROM public.kunjungan AS k
+      WHERE k.legacy_visit_id = NEW.id
+      FOR UPDATE;
+
+      IF NOT FOUND THEN
+        RAISE EXCEPTION 'Kunjungan dual-write tidak ditemukan untuk visit %', NEW.id;
+      END IF;
+
+      UPDATE public.kunjungan
+      SET status = NEW.status,
+          waktu_masuk = COALESCE(NEW.waktu_masuk, public.kunjungan.waktu_masuk),
+          updated_at = NEW.updated_at
+      WHERE id = v_kunjungan_id;
+
+      IF (
+        (
+          NEW.asal = 'walk_in'
+          AND OLD.status = 'terjadwal'
+          AND NEW.status = 'menunggu'
+        )
+        OR (
+          NEW.asal = 'reservasi'
+          AND OLD.status = 'terjadwal'
+          AND NEW.status = 'menunggu'
+          AND OLD.waktu_scan IS NULL
+          AND NEW.waktu_scan IS NOT NULL
+        )
+      )
+        AND NOT EXISTS (
+          SELECT 1
+          FROM public.tiket_antrean AS t
+          WHERE t.legacy_visit_id = NEW.id
+        ) THEN
+        v_tiket_id := public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
+        UPDATE public.tiket_antrean
+        SET legacy_visit_id = NEW.id
+        WHERE id = v_tiket_id;
+      END IF;
+
+      SELECT t.id INTO v_tiket_id
+      FROM public.tiket_antrean AS t
+      WHERE t.legacy_visit_id = NEW.id
+      FOR UPDATE;
+
+      IF FOUND THEN
+        IF NEW.status = 'terjadwal' THEN
+          RAISE EXCEPTION 'Tiket antrean tidak dapat kembali ke status terjadwal untuk visit %', NEW.id;
+        END IF;
+
+        UPDATE public.tiket_antrean
+        SET status = NEW.status,
+            waktu_mulai_layan = NEW.waktu_mulai_layan,
+            waktu_selesai = NEW.waktu_selesai,
+            updated_at = NEW.updated_at
+        WHERE id = v_tiket_id;
+      END IF;
+    END IF;
+  ELSIF NEW.tujuan = 'bertemu_seseorang' THEN
+    IF NEW.waktu_scan IS NOT NULL AND NEW.nama_yang_ditemui IS NULL THEN
+      RAISE EXCEPTION 'Buku tamu dual-write membutuhkan nama_yang_ditemui untuk visit %', NEW.id;
+    END IF;
+
+    IF TG_OP = 'INSERT' AND NEW.status = 'menunggu' AND NEW.waktu_scan IS NOT NULL THEN
+      INSERT INTO public.buku_tamu (
+        legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk
+      ) VALUES (
+        NEW.id,
+        NEW.nama,
+        NEW.asal_instansi,
+        NEW.kontak_hp,
+        NEW.nama_yang_ditemui,
+        NEW.keperluan,
+        COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
+      ) ON CONFLICT (legacy_visit_id) DO UPDATE
+      SET waktu_masuk = EXCLUDED.waktu_masuk
+      RETURNING id INTO v_buku_tamu_id;
+    ELSIF TG_OP = 'UPDATE' THEN
+      SELECT b.id INTO v_buku_tamu_id
+      FROM public.buku_tamu AS b
+      WHERE b.legacy_visit_id = NEW.id
+      FOR UPDATE;
+
+      IF FOUND THEN
+        UPDATE public.buku_tamu
+        SET waktu_masuk = COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
+        WHERE id = v_buku_tamu_id;
+      ELSIF OLD.status IS DISTINCT FROM 'menunggu'
+        AND NEW.status = 'menunggu'
+        AND NEW.waktu_scan IS NOT NULL THEN
+        INSERT INTO public.buku_tamu (
+          legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk
+        ) VALUES (
+          NEW.id,
+          NEW.nama,
+          NEW.asal_instansi,
+          NEW.kontak_hp,
+          NEW.nama_yang_ditemui,
+          NEW.keperluan,
+          COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
+        ) ON CONFLICT (legacy_visit_id) DO UPDATE
+        SET waktu_masuk = EXCLUDED.waktu_masuk
+        RETURNING id INTO v_buku_tamu_id;
+      END IF;
+    END IF;
+  END IF;
+
+  RETURN NEW;
+END $$;
+
+REVOKE EXECUTE ON FUNCTION public.sync_visit_dual_write() FROM PUBLIC, anon, authenticated;
+
+DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;
+CREATE TRIGGER trg_visit_dual_write
+AFTER INSERT OR UPDATE ON public.visit
+FOR EACH ROW EXECUTE FUNCTION public.sync_visit_dual_write();
+
+COMMIT;
