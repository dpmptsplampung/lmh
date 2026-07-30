## Task 2: Add the traceable backfill and atomic dual-write trigger

**Files:**
- Create: `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql`
- Modify: `supabase/migrations/kunjungan_dual_write.test.ts`
- Modify: `supabase/migrations/migration-test-utils.ts:14-37`

**Interfaces:**
- Consumes: M15, `public.visit`, `public.kunjungan`, `public.tiket_antrean`, `public.terbit_tiket(uuid, uuid)`, and `public.antrean_counter`.
- Produces: `kunjungan.legacy_visit_id`, `wp21_backfill_ledger`, `sync_visit_dual_write()`, and trigger `trg_visit_dual_write`.

- [ ] **Step 1: Extend the failing static test for M16**

```ts
it('uses an idempotent, secured trigger instead of client-side sequential writes', () => {
  const sql = readMigration('202607300015_backfill_kunjungan_dual_write.sql');
  expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+legacy_visit_id\s+uuid/i);
  expect(sql).toMatch(/ADD\s+CONSTRAINT\s+kunjungan_legacy_visit_id_key\s+UNIQUE\s*\(legacy_visit_id\)/i);
  expect(sql).toMatch(/CREATE\s+TABLE\s+public\.wp21_backfill_ledger/i);
  expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)/i);
  expect(sql).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i);
  expect(sql).toMatch(/PERFORM\s+public\.terbit_tiket\s*\(/i);
  expect(sql).toMatch(/ON\s+CONFLICT\s*\(legacy_visit_id\)\s+DO\s+NOTHING/i);
  expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_visit_dual_write\s+AFTER\s+INSERT\s+OR\s+UPDATE/i);
  expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
  expect(sql).toMatch(/REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i);
  expect(sql).not.toMatch(/(?:DELETE\s+FROM|DROP\s+TABLE)\s+public\.visit\b/i);
});
```

- [ ] **Step 2: Run the test to verify it fails because M16 is absent**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts`

Expected: FAIL with `ENOENT` for `202607300015_backfill_kunjungan_dual_write.sql`.

- [ ] **Step 3: Implement M16 in one transaction**

The migration must use this order and behavior:

```sql
BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER TABLE public.kunjungan
  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
ALTER TABLE public.kunjungan
  DROP CONSTRAINT IF EXISTS kunjungan_legacy_visit_id_key;
ALTER TABLE public.kunjungan
  ADD CONSTRAINT kunjungan_legacy_visit_id_key UNIQUE (legacy_visit_id);

CREATE INDEX IF NOT EXISTS idx_kunjungan_legacy_visit_id
  ON public.kunjungan(legacy_visit_id) WHERE legacy_visit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wp21_backfill_ledger (
  visit_id uuid PRIMARY KEY REFERENCES public.visit(id) ON DELETE RESTRICT,
  kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE RESTRICT,
  tiket_id uuid REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  buku_tamu_id uuid REFERENCES public.buku_tamu(id) ON DELETE RESTRICT,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kunjungan_id IS NOT NULL AND buku_tamu_id IS NULL)
    OR (kunjungan_id IS NULL AND tiket_id IS NULL AND buku_tamu_id IS NOT NULL)
  )
);
ALTER TABLE public.wp21_backfill_ledger ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.wp21_backfill_ledger TO authenticated;
DROP POLICY IF EXISTS wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger;
CREATE POLICY wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger
  FOR SELECT TO authenticated USING (public.get_my_role() = 'admin');
```

Before inserting any historical row, abort if the WP-20 target tables or the
ledger are non-empty. The successful `INSERT` must create `kunjungan` from
every source `visit` whose `tujuan = 'loket'`; map `tanggal` as
`COALESCE(v.tanggal_rencana, (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
(v.created_at AT TIME ZONE 'Asia/Jakarta')::date)`. For each source row,
preserve `pengunjung_id`, `nama`, `kontak_hp`, `asal`, `qr_token`, `status`,
`waktu_masuk`, `created_at`, and `updated_at`.

Create a ticket only for a walk-in, or for a reservation that is already past
`terjadwal`. Assign ticket values with this exact window expression and copy
the source lifecycle timestamps:

```sql
ROW_NUMBER() OVER (
  PARTITION BY v.layanan_id, k.tanggal
  ORDER BY COALESCE(v.waktu_masuk, v.created_at), v.id
)::int AS nomor
```

`nomor_display` must be `COALESCE(l.prefiks_antrean, upper(substr(l.nama, 1, 1))) || '-' || lpad(nomor::text, 3, '0')`.
Insert the same source IDs and generated target IDs in `wp21_backfill_ledger`,
then repair every affected counter with:

```sql
INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
SELECT layanan_id, tanggal, max(nomor)
FROM public.tiket_antrean
GROUP BY layanan_id, tanggal
ON CONFLICT (layanan_id, tanggal) DO UPDATE
  SET nomor_terakhir = GREATEST(
    public.antrean_counter.nomor_terakhir,
    EXCLUDED.nomor_terakhir
  );
```

Define `public.sync_visit_dual_write()` as `SECURITY DEFINER` with fixed
`search_path`, revoke direct execution, and attach it to `INSERT OR UPDATE` on
`public.visit`. On UPDATE, its first guard returns immediately unless at least
one of `status`, `waktu_masuk`, `waktu_scan`, `waktu_mulai_layan`, or
`waktu_selesai` changed. This avoids PostgreSQL's invalid column-qualified
multi-event trigger form while retaining the intended scope. Its insert control
flow is:

```plpgsql
IF TG_OP = 'INSERT' AND NEW.tujuan = 'loket' THEN
  INSERT INTO public.kunjungan (
    legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
    tanggal, waktu_masuk, status, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.pengunjung_id, NEW.nama, NEW.kontak_hp, NEW.asal, NEW.qr_token,
    COALESCE(NEW.tanggal_rencana,
      (COALESCE(NEW.waktu_masuk, NEW.created_at) AT TIME ZONE 'Asia/Jakarta')::date),
    COALESCE(NEW.waktu_masuk, NEW.created_at), NEW.status, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (legacy_visit_id) DO NOTHING
  RETURNING id INTO v_kunjungan_id;

  SELECT id INTO v_kunjungan_id
  FROM public.kunjungan WHERE legacy_visit_id = NEW.id;

  IF NEW.asal = 'walk_in' AND NEW.status <> 'terjadwal' THEN
    PERFORM public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
  END IF;
END IF;
```

For every relevant loket update, lock and find the linked `kunjungan`; raise
`'Kunjungan dual-write tidak ditemukan untuk visit %'` if it is absent; update
its status, `waktu_masuk`, and `updated_at`. When an unscanned reservasi first
becomes `menunggu`, call `terbit_tiket` only if no ticket exists for that
kunjungan. Update the resulting ticket’s status, `waktu_mulai_layan`,
`waktu_selesai`, and `updated_at` without creating a second ticket. If an
existing ticket would be changed back to `terjadwal`, raise an exception because
that state is invalid for `tiket_antrean`.

For `bertemu_seseorang`, insert into `buku_tamu` only when a meeting visit first
becomes `menunggu`; use `NEW.nama`, `NEW.asal_instansi`, `NEW.kontak_hp`,
`NEW.nama_yang_ditemui`, `NEW.keperluan`, and
`COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())`. A later scan/update updates
the existing row’s `waktu_masuk` rather than adding a second guest-book row.

Close the migration with `COMMIT;`, then append
`'202607300015_backfill_kunjungan_dual_write.sql'` after M15 in
`FORWARD_MIGRATION_FILES`. Before recreating the trigger, use
`DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;` so the forward
migration is safely rerunnable by the controlled runner.

- [ ] **Step 4: Run focused regression tests**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts supabase/migrations/visit_spine.test.ts`

Expected: PASS; the old baseline remains immutable, both forward migrations are registered, and the new trigger contract is present.

