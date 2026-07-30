import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Kredensial Supabase tidak lengkap di .env.local');
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--preflight')) {
  throw new Error('Pemakaian: node scripts/selftest-wp21.mjs [--preflight]');
}

const preflightOnly = args.includes('--preflight');
const s = createClient(url, key, { auth: { persistSession: false } });
const SELFTEST_PREFIX = 'SELFTEST_WP21_';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function onlyRow(rows, context) {
  assert(Array.isArray(rows) && rows.length === 1, `${context}: tepat satu baris diperlukan`);
  return rows[0];
}

function asInt(value, context) {
  const number = Number(value);
  assert(Number.isInteger(number), `${context}: nilai integer tidak valid`);
  return number;
}

// Returns an exact IN predicate matching only the two named visits owned by
// this run. Never uses a wildcard prefix so concurrent runs cannot interfere
// with each other's rows.
function ownedWhere(ownedNames) {
  return `nama IN (${ownedNames.map(sqlLiteral).join(', ')})`;
}

async function query(q) {
  // exec_query uses EXECUTE inside plpgsql which rejects trailing semicolons.
  const result = await s.rpc('exec_query', { q: q.replace(/;\s*$/, '') });
  if (result.error) throw new Error(`exec_query gagal: ${result.error.message}`);
  return result.data ?? [];
}

async function exec(q) {
  const result = await s.rpc('exec_sql', { q });
  if (result.error) throw new Error(`exec_sql gagal: ${result.error.message}`);
  return result.data;
}

async function runPreflight() {
  // M20-only reads: safe before M15 creates buku_tamu.
  const preflight = await s.rpc('exec_query', {
    q: `SELECT tujuan, asal, status, count(*)::int AS n
        FROM public.visit
        GROUP BY tujuan, asal, status ORDER BY tujuan, asal, status`,
  });
  if (preflight.error) throw new Error(preflight.error.message);
  console.log('distribusi visit:', JSON.stringify(preflight.data));

  const targets = await s.rpc('exec_query', {
    q: `SELECT
          (SELECT count(*)::int FROM public.kunjungan) AS kunjungan_count,
          (SELECT count(*)::int FROM public.tiket_antrean) AS tiket_count,
          has_schema_privilege(0, 'public', 'CREATE') AS public_can_create`,
  });
  if (targets.error) throw new Error(targets.error.message);
  const target = onlyRow(targets.data, 'preflight target WP-20');
  if (asInt(target.kunjungan_count, 'kunjungan_count') !== 0
    || asInt(target.tiket_count, 'tiket_count') !== 0) {
    throw new Error('WP-21 dihentikan: target WP-20 tidak kosong');
  }
  console.log('PUBLIC dapat CREATE di public (harus false setelah M16):', target.public_can_create);
  console.log('preflight WP-21 selesai: target WP-20 kosong; tidak ada mutasi dilakukan.');
}

async function assertM16Ready() {
  const readiness = onlyRow(await query(`
    SELECT
      to_regclass('public.buku_tamu') IS NOT NULL AS buku_tamu_exists,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kunjungan'
          AND column_name = 'legacy_visit_id'
      ) AS kunjungan_legacy_exists,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tiket_antrean'
          AND column_name = 'legacy_visit_id'
      ) AS tiket_legacy_exists,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.visit'::regclass
          AND tgname = 'trg_visit_dual_write'
          AND NOT tgisinternal
      ) AS dual_write_trigger_exists,
      has_schema_privilege(0, 'public', 'CREATE') AS public_can_create
  `), 'kesiapan M15/M16');

  assert(readiness.buku_tamu_exists === true, 'M15 belum siap: public.buku_tamu tidak ada');
  assert(readiness.kunjungan_legacy_exists === true, 'M16 belum siap: kunjungan.legacy_visit_id tidak ada');
  assert(readiness.tiket_legacy_exists === true, 'M16 belum siap: tiket_antrean.legacy_visit_id tidak ada');
  assert(readiness.dual_write_trigger_exists === true, 'M16 belum siap: trg_visit_dual_write tidak ada');
  assert(readiness.public_can_create === false, 'M16 belum siap: PUBLIC masih dapat CREATE pada schema public');
  console.log('kesiapan M15/M16:', JSON.stringify(readiness));
}

// Checks that neither of the two names owned by this run already exist.
// Using exact names instead of a prefix wildcard prevents false positives
// from concurrent runs and real visitors with similar names.
async function assertNoPriorSelftestRows(ownedNames) {
  const prior = onlyRow(await query(`
    SELECT count(*)::int AS n FROM public.visit WHERE ${ownedWhere(ownedNames)}
  `), 'baris selftest sebelumnya');
  assert(asInt(prior.n, 'baris selftest sebelumnya') === 0,
    'selftest dihentikan: nama run ini sudah ada di visit (kemungkinan tabrakan ID; coba ulang)');
}

async function assertHistoricalCoverage() {
  // 1. Every loket visit must have exactly one kunjungan.
  const loketCount = onlyRow(await query(`
    SELECT count(*)::int AS loket_count FROM public.visit WHERE tujuan = 'loket';
  `), 'loket_count');
  const linkedKunjungan = onlyRow(await query(`
    SELECT count(*)::int AS linked_kunjungan
    FROM public.visit v
    JOIN public.kunjungan k ON k.legacy_visit_id = v.id
    WHERE v.tujuan = 'loket';
  `), 'linked_kunjungan');
  assert(
    asInt(linkedKunjungan.linked_kunjungan, 'linked_kunjungan')
      === asInt(loketCount.loket_count, 'loket_count'),
    'cakupan historis gagal: setiap visit loket harus memiliki tepat satu kunjungan',
  );

  // 2. No kunjungan orphans.
  const orphanKunjungan = onlyRow(await query(`
    SELECT count(*)::int AS orphan_kunjungan
    FROM public.kunjungan k
    LEFT JOIN public.visit v ON v.id = k.legacy_visit_id
    WHERE k.legacy_visit_id IS NOT NULL AND v.id IS NULL;
  `), 'orphan_kunjungan');
  assert(asInt(orphanKunjungan.orphan_kunjungan, 'orphan_kunjungan') === 0,
    'cakupan historis gagal: ditemukan kunjungan legacy yatim');

  // 3. Loket visits eligible under M16 ticket predicate each have exactly one
  //    ticket; ineligible scheduled reservations have zero tickets.
  const eligibleWithoutTicket = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.visit v
    INNER JOIN public.kunjungan k ON k.legacy_visit_id = v.id
    WHERE v.tujuan = 'loket'
      AND v.status <> 'terjadwal'
      AND (v.asal = 'walk_in' OR (v.asal = 'reservasi' AND v.status <> 'terjadwal'))
      AND NOT EXISTS (
        SELECT 1 FROM public.tiket_antrean t WHERE t.legacy_visit_id = v.id
      );
  `), 'eligible_without_ticket');
  assert(asInt(eligibleWithoutTicket.n, 'eligible_without_ticket') === 0,
    'cakupan historis gagal: visit loket eligible tanpa tiket ditemukan');

  const ineligibleWithTicket = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.visit v
    WHERE v.tujuan = 'loket'
      AND v.status = 'terjadwal'
      AND EXISTS (
        SELECT 1 FROM public.tiket_antrean t WHERE t.legacy_visit_id = v.id
      );
  `), 'ineligible_with_ticket');
  assert(asInt(ineligibleWithTicket.n, 'ineligible_with_ticket') === 0,
    'cakupan historis gagal: reservasi terjadwal tidak boleh memiliki tiket');

  // 4. Only scanned meeting visits map to buku_tamu; no buku_tamu orphans.
  const scannedMeetingWithoutBukuTamu = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.visit v
    WHERE v.tujuan = 'bertemu_seseorang'
      AND v.waktu_scan IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.buku_tamu b WHERE b.legacy_visit_id = v.id
      );
  `), 'scanned_meeting_without_buku_tamu');
  assert(asInt(scannedMeetingWithoutBukuTamu.n, 'scanned_meeting_without_buku_tamu') === 0,
    'cakupan historis gagal: kedatangan tamu terscan tanpa buku_tamu ditemukan');

  const bukuTamuOrphan = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.buku_tamu b
    WHERE b.legacy_visit_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.visit v
        WHERE v.id = b.legacy_visit_id AND v.waktu_scan IS NOT NULL
      );
  `), 'buku_tamu_orphan');
  assert(asInt(bukuTamuOrphan.n, 'buku_tamu_orphan') === 0,
    'cakupan historis gagal: buku_tamu yatim atau dari kunjungan tidak terscan ditemukan');

  // 5. No ledger orphans; every ledger row points to the correct source visit.
  const ledgerOrphan = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.wp21_backfill_ledger l
    WHERE
      (l.kunjungan_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.kunjungan k WHERE k.id = l.kunjungan_id
      ))
      OR (l.tiket_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.tiket_antrean t WHERE t.id = l.tiket_id
      ))
      OR (l.buku_tamu_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.buku_tamu b WHERE b.id = l.buku_tamu_id
      ));
  `), 'ledger_orphan');
  assert(asInt(ledgerOrphan.n, 'ledger_orphan') === 0,
    'cakupan historis gagal: ledger yatim ditemukan');

  const ledgerSourceMismatch = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.wp21_backfill_ledger l
    LEFT JOIN public.kunjungan k ON k.id = l.kunjungan_id
    LEFT JOIN public.tiket_antrean t ON t.id = l.tiket_id
    LEFT JOIN public.buku_tamu b ON b.id = l.buku_tamu_id
    WHERE
      (k.id IS NOT NULL AND k.legacy_visit_id <> l.visit_id)
      OR (t.id IS NOT NULL AND t.legacy_visit_id <> l.visit_id)
      OR (b.id IS NOT NULL AND b.legacy_visit_id <> l.visit_id);
  `), 'ledger_source_mismatch');
  assert(asInt(ledgerSourceMismatch.n, 'ledger_source_mismatch') === 0,
    'cakupan historis gagal: ledger tidak mengarah ke sumber visit yang benar');

  // 6. antrean_counter must not lag behind any ticket.
  const counterBehind = onlyRow(await query(`
    SELECT count(*)::int AS counter_behind
    FROM (
      SELECT t.layanan_id, t.tanggal, max(t.nomor) AS ticket_max,
             max(c.nomor_terakhir) AS counter_max
      FROM public.tiket_antrean t
      LEFT JOIN public.antrean_counter c USING (layanan_id, tanggal)
      GROUP BY t.layanan_id, t.tanggal
    ) x WHERE counter_max IS NULL OR counter_max < ticket_max;
  `), 'counter_behind');
  assert(asInt(counterBehind.counter_behind, 'counter_behind') === 0,
    'cakupan historis gagal: antrean_counter tertinggal dari tiket');

  console.log('cakupan historis: OK');
}

async function findRuntimeTarget() {
  const rows = await query(`
    SELECT l.id, l.nama,
           public.jadwal_berikutnya(
             l.id,
             (now() AT TIME ZONE 'Asia/Jakarta')::date
           ) AS tanggal
    FROM public.layanan AS l
    WHERE l.aktif = true
      AND l.punya_antrean = true
      AND public.jadwal_berikutnya(
        l.id,
        (now() AT TIME ZONE 'Asia/Jakarta')::date
      ) IS NOT NULL
    ORDER BY l.nama
    LIMIT 1;
  `);
  return rows[0] ?? null;
}

async function getCounterSnapshot(layananId, tanggal) {
  const rows = await query(`
    SELECT nomor_terakhir
    FROM public.antrean_counter
    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
      AND tanggal = ${sqlLiteral(tanggal)}::date;
  `);
  assert(rows.length <= 1, 'snapshot counter: lebih dari satu baris ditemukan');
  return rows.length === 0 ? null : asInt(rows[0].nomor_terakhir, 'snapshot nomor_terakhir');
}

// Snapshot skm_response_rate for (layananId, today) before the lifecycle
// exercise so we can restore the aggregate after cleanup.
// The WP-08 trigger uses (now() AT TIME ZONE 'Asia/Jakarta')::date for the
// aggregate key, so we match that timezone here.
async function getSkmSnapshot(layananId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const rows = await query(`
    SELECT dilayani, mengisi
    FROM public.skm_response_rate
    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
      AND tanggal = ${sqlLiteral(today)}::date;
  `);
  assert(rows.length <= 1, 'snapshot SKM: lebih dari satu baris ditemukan');
  return {
    tanggal: today,
    existed: rows.length > 0,
    dilayani: rows.length > 0 ? asInt(rows[0].dilayani, 'snapshot skm dilayani') : 0,
    mengisi: rows.length > 0 ? asInt(rows[0].mengisi, 'snapshot skm mengisi') : 0,
  };
}

async function countOwnTickets(layananId, tanggal, ownedNames) {
  const result = onlyRow(await query(`
    SELECT count(*)::int AS n
    FROM public.tiket_antrean AS t
    JOIN public.visit AS v ON v.id = t.legacy_visit_id
    WHERE ${ownedWhere(ownedNames)}
      AND t.layanan_id = ${sqlLiteral(layananId)}::uuid
      AND t.tanggal = ${sqlLiteral(tanggal)}::date;
  `), 'jumlah tiket selftest');
  return asInt(result.n, 'jumlah tiket selftest');
}

async function assertReservationState(visitId, expectedStatus, expectedTicketCount) {
  const state = onlyRow(await query(`
    SELECT
      (SELECT count(*)::int FROM public.kunjungan
        WHERE legacy_visit_id = ${sqlLiteral(visitId)}::uuid) AS kunjungan_count,
      (SELECT count(*)::int FROM public.tiket_antrean
        WHERE legacy_visit_id = ${sqlLiteral(visitId)}::uuid) AS tiket_count,
      (SELECT status FROM public.visit
        WHERE id = ${sqlLiteral(visitId)}::uuid) AS visit_status;
  `), 'status reservasi selftest');
  assert(asInt(state.kunjungan_count, 'kunjungan_count selftest') === 1,
    'reservasi selftest harus menghasilkan tepat satu kunjungan');
  assert(asInt(state.tiket_count, 'tiket_count selftest') === expectedTicketCount,
    `reservasi selftest harus memiliki ${expectedTicketCount} tiket`);
  assert(state.visit_status === expectedStatus,
    `status visit selftest harus ${expectedStatus}`);
}

async function exerciseTriggers({ layananId, tanggal, baseName, meetingName }) {
  await exec(`
    INSERT INTO public.visit (
      nama, asal, layanan_id, tujuan, status, tanggal_rencana, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(baseName)}, 'reservasi', ${sqlLiteral(layananId)}::uuid,
      'loket', 'terjadwal', ${sqlLiteral(tanggal)}::date, now(), now()
    );
  `);
  const loket = onlyRow(await query(`
    SELECT id FROM public.visit WHERE nama = ${sqlLiteral(baseName)}
  `), 'visit loket selftest');

  await assertReservationState(loket.id, 'terjadwal', 0);

  await exec(`
    UPDATE public.visit
    SET status = 'menunggu', waktu_scan = now(),
        waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
    WHERE id = ${sqlLiteral(loket.id)}::uuid;
  `);
  await assertReservationState(loket.id, 'menunggu', 1);

  // Idempotency check: second scan must not create a second ticket.
  await exec(`
    UPDATE public.visit
    SET status = 'menunggu', waktu_scan = now(),
        waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
    WHERE id = ${sqlLiteral(loket.id)}::uuid;
  `);
  await assertReservationState(loket.id, 'menunggu', 1);

  await exec(`
    UPDATE public.visit
    SET status = 'dilayani', waktu_mulai_layan = now(), updated_at = now()
    WHERE id = ${sqlLiteral(loket.id)}::uuid;
  `);
  await exec(`
    UPDATE public.visit
    SET status = 'selesai', waktu_selesai = now(), updated_at = now()
    WHERE id = ${sqlLiteral(loket.id)}::uuid;
  `);
  const lifecycle = onlyRow(await query(`
    SELECT
      t.status = v.status AS status_equal,
      t.waktu_mulai_layan IS NOT DISTINCT FROM v.waktu_mulai_layan AS mulai_equal,
      t.waktu_selesai IS NOT DISTINCT FROM v.waktu_selesai AS selesai_equal
    FROM public.tiket_antrean AS t
    JOIN public.visit AS v ON v.id = t.legacy_visit_id
    WHERE v.id = ${sqlLiteral(loket.id)}::uuid;
  `), 'sinkronisasi lifecycle tiket');
  assert(
    lifecycle.status_equal === true
      && lifecycle.mulai_equal === true
      && lifecycle.selesai_equal === true,
    'lifecycle tiket tidak sama dengan lifecycle visit',
  );
  console.log('reservation/scan/lifecycle:', JSON.stringify(lifecycle));

  // Guest-book branch: meeting visit must not appear in buku_tamu before scan.
  await exec(`
    INSERT INTO public.visit (
      nama, asal, layanan_id, tujuan, nama_yang_ditemui, keperluan,
      status, tanggal_rencana, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(meetingName)}, 'reservasi', ${sqlLiteral(layananId)}::uuid,
      'bertemu_seseorang', ${sqlLiteral('SELFTEST penerima ' + baseName)}, 'Selftest WP-21',
      'terjadwal', ${sqlLiteral(tanggal)}::date, now(), now()
    );
  `);
  const meeting = onlyRow(await query(`
    SELECT id FROM public.visit WHERE nama = ${sqlLiteral(meetingName)}
  `), 'visit meeting selftest');
  const beforeScan = onlyRow(await query(`
    SELECT count(*)::int AS n FROM public.buku_tamu
    WHERE legacy_visit_id = ${sqlLiteral(meeting.id)}::uuid;
  `), 'buku_tamu sebelum scan');
  assert(asInt(beforeScan.n, 'buku_tamu sebelum scan') === 0,
    'reservasi bertemu tidak boleh membuat buku_tamu sebelum scan');

  await exec(`
    UPDATE public.visit
    SET status = 'menunggu', waktu_scan = now(),
        waktu_masuk = COALESCE(waktu_masuk, now()), updated_at = now()
    WHERE id = ${sqlLiteral(meeting.id)}::uuid;
  `);
  const afterScan = onlyRow(await query(`
    SELECT count(*)::int AS n FROM public.buku_tamu
    WHERE legacy_visit_id = ${sqlLiteral(meeting.id)}::uuid;
  `), 'buku_tamu setelah scan');
  assert(asInt(afterScan.n, 'buku_tamu setelah scan') === 1,
    'reservasi bertemu harus membuat tepat satu buku_tamu setelah scan');
  console.log('guest-book branch:', JSON.stringify(afterScan));
}

async function restoreCounterIfSafe({ layananId, tanggal, savedCounter, ownTicketCount }) {
  if (ownTicketCount === 0) return;

  const expected = (savedCounter ?? 0) + ownTicketCount;
  const currentRows = await query(`
    SELECT nomor_terakhir
    FROM public.antrean_counter
    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
      AND tanggal = ${sqlLiteral(tanggal)}::date;
  `);
  const current = currentRows.length === 0
    ? null
    : asInt(onlyRow(currentRows, 'counter saat cleanup').nomor_terakhir, 'counter saat cleanup');
  if (current !== expected) {
    throw new Error(
      `counter tidak disentuh: nilai ${current ?? 'NULL'} bukan nilai aman ${expected}`,
    );
  }

  if (savedCounter === null) {
    await exec(`
      DELETE FROM public.antrean_counter
      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
        AND tanggal = ${sqlLiteral(tanggal)}::date
        AND nomor_terakhir = ${expected};
    `);
    const after = await query(`
      SELECT nomor_terakhir FROM public.antrean_counter
      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
        AND tanggal = ${sqlLiteral(tanggal)}::date;
    `);
    assert(after.length === 0,
      'counter tidak dihapus: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
  } else {
    await exec(`
      UPDATE public.antrean_counter
      SET nomor_terakhir = ${savedCounter}
      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
        AND tanggal = ${sqlLiteral(tanggal)}::date
        AND nomor_terakhir = ${expected};
    `);
    const after = onlyRow(await query(`
      SELECT nomor_terakhir FROM public.antrean_counter
      WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
        AND tanggal = ${sqlLiteral(tanggal)}::date;
    `), 'counter setelah restore');
    assert(asInt(after.nomor_terakhir, 'counter setelah restore') === savedCounter,
      'counter tidak dipulihkan: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
  }
  console.log('counter dipulihkan dengan guard konkurensi: OK');
}

// Restore skm_response_rate.dilayani to its pre-selftest value using a
// compare-before-write guard identical to restoreCounterIfSafe.
//
// The WP-08 trigger (trg_visit_selesai_rr) increments dilayani by 1 when
// visit.status transitions to 'selesai'. We must undo that increment after
// cleanup removes the selftest visit row. This function is always called from
// cleanup, even when the lifecycle exercise failed.
//
// Guard logic:
//   current dilayani !== savedSkm.dilayani + 1  ->  concurrent change; throw
//   !existed AND mengisi === 0                  ->  row created by us; DELETE
//   otherwise                                   ->  UPDATE dilayani = snapshot
async function restoreSkmIfSafe({ layananId, savedSkm }) {
  const expectedDilayani = savedSkm.dilayani + 1;
  const currentRows = await query(`
    SELECT dilayani, mengisi
    FROM public.skm_response_rate
    WHERE layanan_id = ${sqlLiteral(layananId)}::uuid
      AND tanggal = ${sqlLiteral(savedSkm.tanggal)}::date;
  `);

  if (currentRows.length === 0) {
    throw new Error(
      'SKM aggregate hilang saat cleanup: baris untuk layanan ini pada '
      + savedSkm.tanggal + ' tidak ditemukan setelah siklus selftest',
    );
  }

  const currentDilayani = asInt(currentRows[0].dilayani, 'skm dilayani saat cleanup');
  const currentMengisi = asInt(currentRows[0].mengisi, 'skm mengisi saat cleanup');

  if (currentDilayani !== expectedDilayani) {
    throw new Error(
      'SKM aggregate tidak aman dipulihkan: dilayani saat ini ' + currentDilayani
      + ', diharapkan ' + expectedDilayani
      + ' (snapshot ' + savedSkm.dilayani + ' + 1); kemungkinan perubahan bersamaan',
    );
  }

  if (!savedSkm.existed && currentMengisi === 0) {
    // Row was created entirely by the selftest and mengisi is untouched:
    // safe to delete the whole row.
    await exec(
      'DELETE FROM public.skm_response_rate'
      + ' WHERE layanan_id = ' + sqlLiteral(layananId) + '::uuid'
      + ' AND tanggal = ' + sqlLiteral(savedSkm.tanggal) + '::date'
      + ' AND dilayani = ' + expectedDilayani
      + ' AND mengisi = 0;',
    );
    const afterDel = await query(
      'SELECT dilayani FROM public.skm_response_rate'
      + ' WHERE layanan_id = ' + sqlLiteral(layananId) + '::uuid'
      + ' AND tanggal = ' + sqlLiteral(savedSkm.tanggal) + '::date;',
    );
    assert(afterDel.length === 0,
      'SKM row tidak terhapus: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
  } else {
    // Row existed before or mengisi changed concurrently: decrement dilayani
    // back to the snapshot value with a compare-before-write guard.
    await exec(
      'UPDATE public.skm_response_rate'
      + ' SET dilayani = ' + savedSkm.dilayani + ', updated_at = now()'
      + ' WHERE layanan_id = ' + sqlLiteral(layananId) + '::uuid'
      + ' AND tanggal = ' + sqlLiteral(savedSkm.tanggal) + '::date'
      + ' AND dilayani = ' + expectedDilayani + ';',
    );
    const afterUpd = onlyRow(
      await query(
        'SELECT dilayani FROM public.skm_response_rate'
        + ' WHERE layanan_id = ' + sqlLiteral(layananId) + '::uuid'
        + ' AND tanggal = ' + sqlLiteral(savedSkm.tanggal) + '::date;',
      ),
      'SKM setelah restore',
    );
    assert(asInt(afterUpd.dilayani, 'SKM dilayani setelah restore') === savedSkm.dilayani,
      'SKM tidak dipulihkan: perubahan bersamaan terdeteksi setelah pemeriksaan aman');
  }
  console.log('SKM aggregate dipulihkan dengan guard konkurensi: OK');
}

async function cleanup({ layananId, tanggal, savedCounter, savedSkm, ownedNames }) {
  const ownTicketCount = await countOwnTickets(layananId, tanggal, ownedNames);
  const where = ownedWhere(ownedNames);

  // Children are always removed before their source visits.
  await exec(
    'DELETE FROM public.tiket_antrean WHERE kunjungan_id IN ('
    + 'SELECT id FROM public.kunjungan WHERE legacy_visit_id IN ('
    + 'SELECT id FROM public.visit WHERE ' + where + '));',
  );
  await exec(
    'DELETE FROM public.kunjungan WHERE legacy_visit_id IN ('
    + 'SELECT id FROM public.visit WHERE ' + where + ');',
  );
  await exec(
    'DELETE FROM public.buku_tamu WHERE legacy_visit_id IN ('
    + 'SELECT id FROM public.visit WHERE ' + where + ');',
  );
  await exec('DELETE FROM public.visit WHERE ' + where + ';');

  // Verify only the exact owned rows were removed.
  const finalRows = onlyRow(
    await query('SELECT count(*)::int AS n FROM public.visit WHERE ' + where + ';'),
    'baris selftest akhir',
  );
  assert(asInt(finalRows.n, 'baris selftest akhir') === 0,
    'cleanup gagal: masih ada visit dari run ini');

  await restoreCounterIfSafe({ layananId, tanggal, savedCounter, ownTicketCount });
  await restoreSkmIfSafe({ layananId, savedSkm });
  console.log('cleanup WP-21 selesai.');
}

async function runFull() {
  // Generate owned names before any DB check so assertNoPriorSelftestRows
  // can verify the exact names rather than a global prefix wildcard.
  const baseName = SELFTEST_PREFIX + randomBytes(16).toString('hex');
  const meetingName = baseName + '_TAMU';
  const ownedNames = [baseName, meetingName];

  await assertM16Ready();
  await assertNoPriorSelftestRows(ownedNames);
  await assertHistoricalCoverage();

  const target = await findRuntimeTarget();
  if (!target) {
    throw new Error(
      'uji runtime WP-21 gagal: tidak ada layanan aktif dengan jadwal berikutnya; '
      + 'full mode memerlukan minimal satu layanan aktif dengan punya_antrean=true',
    );
  }
  assert(target.id && target.tanggal, 'target runtime WP-21 tidak lengkap');
  console.log('target runtime:', JSON.stringify({ layanan: target.nama, tanggal: target.tanggal }));

  const savedCounter = await getCounterSnapshot(target.id, target.tanggal);
  // Snapshot SKM before lifecycle so we can restore dilayani after cleanup.
  const savedSkm = await getSkmSnapshot(target.id);

  let exerciseError;
  try {
    await exerciseTriggers({
      layananId: target.id,
      tanggal: target.tanggal,
      baseName,
      meetingName,
    });
  } catch (err) {
    exerciseError = err;
  }

  let cleanupError;
  try {
    await cleanup({
      layananId: target.id,
      tanggal: target.tanggal,
      savedCounter,
      savedSkm,
      ownedNames,
    });
  } catch (err) {
    cleanupError = err;
  }

  // Report both failure messages without leaking the connection URL or key.
  if (exerciseError && cleanupError) {
    throw new Error(
      'uji runtime dan cleanup WP-21 gagal:'
      + '\n  [exercise] ' + exerciseError.message
      + '\n  [cleanup] ' + cleanupError.message,
    );
  }
  if (exerciseError) throw exerciseError;
  if (cleanupError) throw cleanupError;
}

async function main() {
  if (preflightOnly) {
    await runPreflight();
    return;
  }
  await runFull();
}

main().catch((error) => {
  console.error('selftest-wp21 gagal: ' + error.message);
  process.exitCode = 1;
});
