## Task 3: Add a production verifier that cleans up only its own data

**Files:**
- Create: `scripts/selftest-wp21.mjs`

**Interfaces:**
- Consumes: `.env.local` service-role credentials, `exec_query`, `exec_sql`, M15/M16 objects.
- Produces: console evidence for preflight distribution, historical coverage, conditional runtime behavior, and cleanup completion.

- [ ] **Step 1: Write a verifier test plan into the script as executable assertions**

The script accepts `--preflight` and must stop before mutation unless all target
preconditions pass. In this mode it queries only M20 objects already present in
production (`visit`, `kunjungan`, and `tiket_antrean`) so it can run before M15
creates `buku_tamu`:

```js
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
        has_schema_privilege('PUBLIC', 'public', 'CREATE') AS public_can_create`,
});
if (targets.error) throw new Error(targets.error.message);
if (targets.data[0].kunjungan_count !== 0 || targets.data[0].tiket_count !== 0) {
  throw new Error('WP-21 dihentikan: target WP-20 tidak kosong');
}
console.log('PUBLIC dapat CREATE di public (harus false setelah M16):', targets.data[0].public_can_create);
```

It must next print and assert these historical queries:

```sql
SELECT count(*)::int AS visit_count FROM public.visit;
SELECT count(*)::int AS linked_kunjungan
FROM public.visit v JOIN public.kunjungan k ON k.legacy_visit_id = v.id
WHERE v.tujuan = 'loket';
SELECT count(*)::int AS orphan_kunjungan
FROM public.kunjungan k
LEFT JOIN public.visit v ON v.id = k.legacy_visit_id
WHERE k.legacy_visit_id IS NOT NULL AND v.id IS NULL;
SELECT count(*)::int AS counter_behind
FROM (
  SELECT t.layanan_id, t.tanggal, max(t.nomor) AS ticket_max,
         max(c.nomor_terakhir) AS counter_max
  FROM public.tiket_antrean t
  LEFT JOIN public.antrean_counter c USING (layanan_id, tanggal)
  GROUP BY t.layanan_id, t.tanggal
) x WHERE counter_max IS NULL OR counter_max < ticket_max;
```

- [ ] **Step 2: Exercise both trigger branches with identifiable temporary records**

Use a cryptographically random `runId`, a `SELFTEST_WP21_<runId>` name, and a
reservation dated to the next open day returned by `jadwal_berikutnya`. Create
one loket reservation, assert one linked `kunjungan` and zero tickets, then
update it to `menunggu` with `waktu_scan=now()` and assert exactly one ticket.
Repeat the same update and assert the ticket count remains one. Update it to
`dilayani` and `selesai`, then assert ticket status/timestamps equal the visit.

Create a second `bertemu_seseorang` reservation with the same unique run ID;
assert no `buku_tamu` before scan, update it to `menunggu`, then assert exactly
one `buku_tamu.legacy_visit_id` row. Never call a route or browser client for
this verification; use service-role SQL only.

- [ ] **Step 3: Make cleanup deterministic and guarded**

The script must delete child records before their source visits:

```sql
DELETE FROM public.tiket_antrean
WHERE kunjungan_id IN (
  SELECT id FROM public.kunjungan WHERE legacy_visit_id IN (
    SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%'
  )
);
DELETE FROM public.kunjungan
WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%');
DELETE FROM public.buku_tamu
WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%');
DELETE FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%';
```

Before restoring or deleting an affected `antrean_counter` row, query that its
current value is exactly the saved pre-test value plus the verifier’s own ticket
count. If not, throw and leave the counter unchanged; this prevents overwriting
a concurrent real ticket. Print a final query proving no `SELFTEST_WP21_` row
remains.

- [ ] **Step 4: Run syntax and focused project checks**

Run: `node --check scripts/selftest-wp21.mjs; npm test -- supabase/migrations/kunjungan_dual_write.test.ts`

Expected: both commands exit 0.

