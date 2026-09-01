# Rekapitulasi Per Layanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-layanan rekapitulasi (recap) tab at `/admin/rekap` that lists completed tickets, supports free-text search, view full detail in a side panel, and exports to Excel.

**Architecture:** Extend existing `/admin/rekap` page with a new tab "Rekap Per Layanan" backed by three new API route handlers (list, options, export). Server uses cookie-based Supabase client + RLS for access scoping; export uses `exceljs` in Node runtime. Petugas are auto-scoped to their own `layanan_id`; admin/FO can pick any layanan or "Semua Layanan".

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase JS, `exceljs` (new dependency), zod, vitest + @testing-library/react.

**Reference spec:** `docs/superpowers/specs/2026-09-01-rekap-layanan-design.md`

## Global Constraints

- **Next.js 16** App Router; this codebase is **NOT** standard Next.js — read `node_modules/next/dist/docs/` for relevant guides before writing route handlers or modifying `app/` layout.
- **react-hooks/set-state-in-effect** and **react-hooks/immutability** ESLint rules are enforced; use `useCallback`/`useEffect` correctly, never mutate arrays/objects in render.
- **`@next/next/no-img-element`** enforced; use `<img>` only when necessary.
- **All UI copy in Bahasa Indonesia** unless existing file shows otherwise.
- **Indonesian field naming** for new code (camelCase for vars, snake_case for DB columns).
- **Run gates** after each task cluster: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **Git workflow**: existing remote uses Doppler secret `GHTOKEN_DPMPTSP` via `gh auth token --user dpmptsplampung`. **Do not push** unless explicitly requested. Commit locally at end of each task.
- **Do not print secrets**, do not modify `.env`, do not modify `proxy.ts` route protection logic.
- **All date formatting** uses `id-ID` locale (`Intl.DateTimeFormat('id-ID', ...)`).
- **No placeholder content**: every code block is complete; every test code is real, not pseudo.

---

## File Structure

```
src/
├── app/
│   ├── admin/
│   │   └── rekap/
│   │       ├── page.tsx                          # MODIFIED: add new tab + update tab count
│   │       └── rekap-layanan.test.tsx            # NEW
│   └── api/
│       └── admin/
│           └── rekap/
│               ├── tickets/route.ts              # NEW
│               ├── tickets.test.ts               # NEW
│               ├── export/route.ts               # NEW
│               ├── export.test.ts                # NEW
│               ├── layanan-options/route.ts      # NEW
│               └── layanan-options.test.ts       # NEW
├── components/
│   └── admin/
│       ├── RekapLayananTable.tsx                 # NEW
│       ├── RekapLayananTable.test.tsx            # NEW
│       ├── RekapTiketDetailPanel.tsx             # NEW
│       └── RekapTiketDetailPanel.test.tsx        # NEW
└── lib/
    └── rekap/
        ├── schemas.ts                            # NEW (zod)
        ├── query.ts                              # NEW (query builder)
        ├── excel.ts                              # NEW (workbook builder)
        ├── format.ts                             # NEW (date/duration formatters)
        ├── format.test.ts                        # NEW
        ├── query.test.ts                         # NEW
        └── excel.test.ts                         # NEW
package.json                                       # MODIFIED: add exceljs
src/lib/admin-nav.ts                              # MODIFIED: extend Rekap Harian roles
```

---

## Task 1: Add `exceljs` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install exceljs**

Run from project root:
```bash
npm install exceljs
```

- [ ] **Step 2: Verify installation**

Run:
```bash
grep '"exceljs"' package.json
```

Expected: line containing `"exceljs": "^4.4.0"` (or compatible version installed).

- [ ] **Step 3: Verify package loads in Node**

Run:
```bash
node -e "const ExcelJS = require('exceljs'); console.log(typeof ExcelJS.Workbook);"
```

Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): tambah exceljs untuk export rekap"
```

---

## Task 2: Update `admin-nav.ts` to allow petugas to access Rekap Harian

**Files:**
- Modify: `src/lib/admin-nav.ts:37`

- [ ] **Step 1: Update roles list**

In `src/lib/admin-nav.ts`, change line 37 from:
```ts
{ label: 'Rekap Harian', href: '/admin/rekap', iconKey: 'rekap', roles: ['admin', 'front_office'] },
```
to:
```ts
{ label: 'Rekap Harian', href: '/admin/rekap', iconKey: 'rekap', roles: ['admin', 'petugas', 'front_office'] },
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin-nav.ts
git commit -m "feat(rekap): izinkan petugas akses menu Rekap Harian"
```

---

## Task 3: Zod schemas untuk query params

**Files:**
- Create: `src/lib/rekap/schemas.ts`
- Create: `src/lib/rekap/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export const ticketsQuerySchema: z.ZodObject<...>` — validasi `layanan_id` (uuid optional), `q` (string max 100), `dari` (date), `sampai` (date), `page` (int ≥ 0, default 0), `page_size` (int 1-100, default 25)
  - `export const exportQuerySchema: z.ZodObject<...>` — sama tapi tanpa `page`/`page_size`
  - `export const layananOptionsQuerySchema: z.ZodObject<...>` — kosong (no params)

- [ ] **Step 1: Write the failing test**

Create `src/lib/rekap/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ticketsQuerySchema, exportQuerySchema } from './schemas';

describe('rekap schemas', () => {
  describe('ticketsQuerySchema', () => {
    it('accepts empty input with defaults', () => {
      const r = ticketsQuerySchema.safeParse({});
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.page).toBe(0);
        expect(r.data.page_size).toBe(25);
        expect(r.data.q).toBe('');
        expect(r.data.layanan_id).toBeUndefined();
        expect(r.data.dari).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.data.sampai).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('accepts all valid params', () => {
      const r = ticketsQuerySchema.safeParse({
        layanan_id: '550e8400-e29b-41d4-a716-446655440000',
        q: 'budi',
        dari: '2026-08-01',
        sampai: '2026-08-31',
        page: '2',
        page_size: '50',
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.page).toBe(2);
        expect(r.data.page_size).toBe(50);
        expect(r.data.q).toBe('budi');
      }
    });

    it('rejects invalid uuid for layanan_id', () => {
      const r = ticketsQuerySchema.safeParse({ layanan_id: 'not-a-uuid' });
      expect(r.success).toBe(false);
    });

    it('rejects q longer than 100 chars', () => {
      const r = ticketsQuerySchema.safeParse({ q: 'a'.repeat(101) });
      expect(r.success).toBe(false);
    });

    it('rejects page_size > 100', () => {
      const r = ticketsQuerySchema.safeParse({ page_size: '101' });
      expect(r.success).toBe(false);
    });

    it('rejects negative page', () => {
      const r = ticketsQuerySchema.safeParse({ page: '-1' });
      expect(r.success).toBe(false);
    });
  });

  describe('exportQuerySchema', () => {
    it('rejects page and page_size', () => {
      const r = exportQuerySchema.safeParse({ page: '0', page_size: '25' });
      expect(r.success).toBe(false);
    });

    it('accepts valid export params', () => {
      const r = exportQuerySchema.safeParse({
        layanan_id: '550e8400-e29b-41d4-a716-446655440000',
        dari: '2026-08-01',
        sampai: '2026-08-31',
        q: 'budi',
      });
      expect(r.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rekap/schemas.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rekap/schemas.ts`:
```ts
import { z } from 'zod';
import { addDaysWIB, todayWIB } from '@/lib/time';

const uuidSchema = z.string().uuid().optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');
const qSchema = z.string().max(100).default('');

const dateRangeBase = {
  dari: dateSchema.default(() => addDaysWIB(-30)),
  sampai: dateSchema.default(() => todayWIB()),
};

export const ticketsQuerySchema = z.object({
  layanan_id: uuidSchema,
  q: qSchema,
  ...dateRangeBase,
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

export const exportQuerySchema = z.object({
  layanan_id: uuidSchema,
  q: qSchema,
  ...dateRangeBase,
});

export const layananOptionsQuerySchema = z.object({});

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rekap/schemas.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rekap/schemas.ts src/lib/rekap/schemas.test.ts
git commit -m "feat(rekap): tambah zod schemas untuk query params"
```

---

## Task 4: Date/duration formatters

**Files:**
- Create: `src/lib/rekap/format.ts`
- Create: `src/lib/rekap/format.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export function formatTanggalId(date: string): string` — `"2026-08-31"` → `"31/08/2026"`
  - `export function formatWaktuId(iso: string | null): string` — `"2026-08-31T01:05:00Z"` → `"08:05"` (WIB)
  - `export function hitungDurasiMenit(mulai: string | null, selesai: string | null): number | null` — return null jika salah satu null

- [ ] **Step 1: Write failing test**

Create `src/lib/rekap/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from './format';

describe('rekap format', () => {
  it('formatTanggalId converts ISO date to dd/MM/yyyy', () => {
    expect(formatTanggalId('2026-08-31')).toBe('31/08/2026');
    expect(formatTanggalId('2026-01-05')).toBe('05/01/2026');
  });

  it('formatWaktuId converts ISO datetime to HH:mm in WIB', () => {
    // 2026-08-31T01:05:00Z = 08:05 WIB (UTC+7)
    expect(formatWaktuId('2026-08-31T01:05:00Z')).toBe('08:05');
  });

  it('formatWaktuId returns empty string for null', () => {
    expect(formatWaktuId(null)).toBe('');
  });

  it('hitungDurasiMenit returns null when input is null', () => {
    expect(hitungDurasiMenit(null, '2026-08-31T01:20:00Z')).toBeNull();
    expect(hitungDurasiMenit('2026-08-31T01:05:00Z', null)).toBeNull();
  });

  it('hitungDurasiMenit returns minutes difference', () => {
    expect(hitungDurasiMenit('2026-08-31T01:05:00Z', '2026-08-31T01:20:00Z')).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rekap/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement format helpers**

Create `src/lib/rekap/format.ts`:
```ts
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function toWIBDate(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS);
}

export function formatTanggalId(dateStr: string): string {
  // Input YYYY-MM-DD or full ISO
  const d = dateStr.length === 10 ? new Date(`${dateStr}T00:00:00Z`) : new Date(dateStr);
  const wib = toWIBDate(d);
  const dd = String(wib.getUTCDate()).padStart(2, '0');
  const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = wib.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatWaktuId(iso: string | null): string {
  if (!iso) return '';
  const wib = toWIBDate(new Date(iso));
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hitungDurasiMenit(mulai: string | null, selesai: string | null): number | null {
  if (!mulai || !selesai) return null;
  const diffMs = new Date(selesai).getTime() - new Date(mulai).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rekap/format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rekap/format.ts src/lib/rekap/format.test.ts
git commit -m "feat(rekap): tambah format helpers untuk tanggal dan durasi"
```

---

## Task 5: Query builder (server-side Supabase query)

**Files:**
- Create: `src/lib/rekap/query.ts`
- Create: `src/lib/rekap/query.test.ts`

**Interfaces:**
- Consumes: nothing directly (uses Supabase client passed in)
- Produces:
  - `export function buildTicketsQuery(supabase, params: { layananId: string | null; q: string; dari: string; sampai: string; from: number; to: number }): PostgrestQueryBuilder` — chain Supabase query untuk tiket_antrean dengan LEFT JOIN kunjungan/petugas/pelayanan_oss/pelayanan_perizinAN
  - `export function escapeIlikeWildcards(s: string): string` — escape `%` dan `_` untuk ILIKE

- [ ] **Step 1: Write failing test**

Create `src/lib/rekap/query.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { escapeIlikeWildcards } from './query';

describe('escapeIlikeWildcards', () => {
  it('escapes % and _', () => {
    expect(escapeIlikeWildcards('100%')).toBe('100\\%');
    expect(escapeIlikeWildcards('a_b')).toBe('a\\_b');
    expect(escapeIlikeWildcards('a%b_c')).toBe('a\\%b\\_c');
  });

  it('leaves normal chars unchanged', () => {
    expect(escapeIlikeWildcards('budi')).toBe('budi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rekap/query.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement query builder**

Create `src/lib/rekap/query.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export function escapeIlikeWildcards(s: string): string {
  return s.replace(/[%_]/g, '\\$&');
}

interface TicketsQueryParams {
  layananId: string | null;
  q: string;
  dari: string;
  sampai: string;
  from: number;
  to: number;
}

export function buildTicketsQuery(
  supabase: SupabaseClient,
  params: TicketsQueryParams,
) {
  let query = supabase
    .from('tiket_antrean')
    .select(
      `
      id, nomor_display, tanggal, status,
      waktu_terbit, waktu_mulai_layan, waktu_selesai,
      kunjungan:kunjungan_id(nama, asal, qr_token),
      petugas:dilayani_oleh(nama),
      pelayanan_oss:tiket_id(*),
      pelayanan_perizinAN:tiket_id(*)
    `,
      { count: 'exact' },
    )
    .eq('status', 'selesai')
    .gte('tanggal', params.dari)
    .lte('tanggal', params.sampai)
    .order('waktu_selesai', { ascending: false })
    .range(params.from, params.to);

  if (params.layananId) {
    query = query.eq('layanan_id', params.layananId);
  }

  const q = params.q.trim();
  if (q) {
    const escaped = escapeIlikeWildcards(q);
    query = query.or(
      [
        `nomor_display.ilike.%${escaped}%`,
        `kunjungan.nama.ilike.%${escaped}%`,
        `pelayanan_oss.nama_pemohon.ilike.%${escaped}%`,
        `pelayanan_oss.nama_usaha.ilike.%${escaped}%`,
        `pelayanan_perizinAN.nama_pemohon.ilike.%${escaped}%`,
        `pelayanan_perizinAN.nama_perusahaan.ilike.%${escaped}%`,
        `petugas.nama.ilike.%${escaped}%`,
      ].join(','),
    );
  }

  return query;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rekap/query.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors. If TS complains about `SupabaseClient` import, use `import type { SupabaseClient } from '@supabase/supabase-js'`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rekap/query.ts src/lib/rekap/query.test.ts
git commit -m "feat(rekap): tambah query builder untuk tiket_antrean + join pendataan"
```

---

## Task 6: Excel workbook builder

**Files:**
- Create: `src/lib/rekap/excel.ts`
- Create: `src/lib/rekap/excel.test.ts`

**Interfaces:**
- Consumes:
  - `RekapTicketRow[]` (defined in this task as local type)
  - `formatTanggalId`, `formatWaktuId`, `hitungDurasiMenit` from Task 4
- Produces:
  - `export async function buildRekapWorkbook(rows: RekapTicketRow[]): Promise<ExcelJS.Buffer>` — return binary buffer siap di-return ke client

- [ ] **Step 1: Write failing test**

Create `src/lib/rekap/excel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildRekapWorkbook } from './excel';
import type { RekapTicketRow } from './excel';

const baseRow: RekapTicketRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: 'oss',
  pelayanan_oss: {
    id: 'p-1',
    nama_pemohon: 'Budi',
    nama_usaha: 'Usaha A',
    tipe_pelaku_usaha: 'perseorangan',
    status_penanaman_modal: 'PMDN',
    lokasi_usaha: 'Bandar Lampung',
    skala_usaha: 'Mikro',
    sektor_usaha_kbli: '47111',
    tindak_lanjut: 'disposisi',
    uraian_solusi: 'Solusi X',
    catatan_internal: null,
  } as RekapTicketRow['pelayanan_oss'],
  pelayanan_perizinAN: null,
};

describe('buildRekapWorkbook', () => {
  it('returns a valid xlsx buffer', async () => {
    const buf = await buildRekapWorkbook([baseRow]);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // First 4 bytes of xlsx: PK\x03\x04 (zip magic)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('contains headers including OSS and Perizinan columns', async () => {
    const buf = await buildRekapWorkbook([baseRow]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Rekap Layanan') ?? wb.worksheets[0];
    expect(ws).toBeDefined();
    const headerRow = ws!.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain('No Antrian');
    expect(headers).toContain('Nama Pengunjung');
    expect(headers).toContain('Nama Usaha');
    expect(headers).toContain('Nama Perusahaan');
  });

  it('produces empty workbook for empty rows', async () => {
    const buf = await buildRekapWorkbook([]);
    expect(buf.length).toBeGreaterThan(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Rekap Layanan') ?? wb.worksheets[0];
    expect(ws!.rowCount).toBe(1); // only header
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/rekap/excel.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement workbook builder**

Create `src/lib/rekap/excel.ts`:
```ts
import ExcelJS from 'exceljs';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from './format';

export interface RekapPelayananOss {
  id: string;
  nama_pemohon: string;
  nama_usaha: string;
  tipe_pelaku_usaha: string | null;
  status_penanaman_modal: string | null;
  lokasi_usaha: string | null;
  skala_usaha: string | null;
  sektor_usaha_kbli: string | null;
  tindak_lanjut: string;
  uraian_solusi: string;
  catatan_internal: string | null;
}

export interface RekapPelayananPerizin {
  id: string;
  nama_pemohon: string;
  nama_perusahaan: string;
  opd_teknis: string;
  uraian_permohonan: string;
  tindak_lanjut: string;
  catatan_petugas: string | null;
}

export interface RekapTicketRow {
  id: string;
  nomor_display: string;
  tanggal: string;
  waktu_terbit: string;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  status: string;
  kunjungan: { nama: string; asal: string; qr_token: string | null } | null;
  petugas: { nama: string } | null;
  form_type: 'oss' | 'perizinAN' | null;
  pelayanan_oss: RekapPelayananOss | null;
  pelayanan_perizinAN: RekapPelayananPerizin | null;
}

const COLUMNS: Array<{ header: string; key: keyof RekapTicketRow | string; width: number }> = [
  { header: 'Tanggal', key: 'tanggal', width: 12 },
  { header: 'No Antrian', key: 'nomor_display', width: 12 },
  { header: 'Nama Pengunjung', key: 'kunjungan_nama', width: 24 },
  { header: 'Asal', key: 'asal', width: 12 },
  { header: 'Petugas', key: 'petugas_nama', width: 20 },
  { header: 'Waktu Mulai', key: 'mulai', width: 12 },
  { header: 'Waktu Selesai', key: 'selesai', width: 12 },
  { header: 'Durasi (mnt)', key: 'durasi', width: 12 },
  { header: 'Jenis Pendataan', key: 'form_type', width: 16 },
  { header: '[OSS] Nama Pemohon', key: 'oss_nama_pemohon', width: 24 },
  { header: '[OSS] Nama Usaha', key: 'oss_nama_usaha', width: 24 },
  { header: '[OSS] Tipe Pelaku', key: 'oss_tipe', width: 16 },
  { header: '[OSS] Status PM', key: 'oss_status_pm', width: 14 },
  { header: '[OSS] Lokasi', key: 'oss_lokasi', width: 24 },
  { header: '[OSS] Skala', key: 'oss_skala', width: 12 },
  { header: '[OSS] KBLI', key: 'oss_kbli', width: 12 },
  { header: '[OSS] Tindak Lanjut', key: 'oss_tindak', width: 18 },
  { header: '[OSS] Uraian Solusi', key: 'oss_uraian', width: 36 },
  { header: '[OSS] Catatan', key: 'oss_catatan', width: 24 },
  { header: '[PerizinAN] Nama Pemohon', key: 'per_nama_pemohon', width: 24 },
  { header: '[PerizinAN] Nama Perusahaan', key: 'per_nama_perusahaan', width: 24 },
  { header: '[PerizinAN] OPD Teknis', key: 'per_opd', width: 20 },
  { header: '[PerizinAN] Uraian', key: 'per_uraian', width: 36 },
  { header: '[PerizinAN] Tindak Lanjut', key: 'per_tindak', width: 18 },
  { header: '[PerizinAN] Catatan', key: 'per_catatan', width: 24 },
];

function rowToCells(r: RekapTicketRow): Record<string, string | number | null> {
  const o = r.pelayanan_oss;
  const p = r.pelayanan_perizinAN;
  const durasi = hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai);
  return {
    tanggal: formatTanggalId(r.tanggal),
    nomor_display: r.nomor_display,
    kunjungan_nama: r.kunjungan?.nama ?? '',
    asal: r.kunjungan?.asal ?? '',
    petugas_nama: r.petugas?.nama ?? '',
    mulai: formatWaktuId(r.waktu_mulai_layan),
    selesai: formatWaktuId(r.waktu_selesai),
    durasi: durasi ?? '',
    form_type: r.form_type ?? '',
    oss_nama_pemohon: o?.nama_pemohon ?? '',
    oss_nama_usaha: o?.nama_usaha ?? '',
    oss_tipe: o?.tipe_pelaku_usaha ?? '',
    oss_status_pm: o?.status_penanaman_modal ?? '',
    oss_lokasi: o?.lokasi_usaha ?? '',
    oss_skala: o?.skala_usaha ?? '',
    oss_kbli: o?.sektor_usaha_kbli ?? '',
    oss_tindak: o?.tindak_lanjut ?? '',
    oss_uraian: o?.uraian_solusi ?? '',
    oss_catatan: o?.catatan_internal ?? '',
    per_nama_pemohon: p?.nama_pemohon ?? '',
    per_nama_perusahaan: p?.nama_perusahaan ?? '',
    per_opd: p?.opd_teknis ?? '',
    per_uraian: p?.uraian_permohonan ?? '',
    per_tindak: p?.tindak_lanjut ?? '',
    per_catatan: p?.catatan_petugas ?? '',
  };
}

export async function buildRekapWorkbook(rows: RekapTicketRow[]): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();

  const ws = wb.addWorksheet('Rekap Layanan');
  ws.columns = COLUMNS;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Header row styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
  };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  for (const r of rows) {
    ws.addRow(rowToCells(r));
  }

  // Auto-width hint: column.width already set, but ensure cell text doesn't overflow
  for (const col of COLUMNS) {
    const colLetter = ws.getColumn(col.key as string);
    if (colLetter.width) col.width = colLetter.width;
  }

  return wb.xlsx.writeBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/rekap/excel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rekap/excel.ts src/lib/rekap/excel.test.ts
git commit -m "feat(rekap): tambah workbook builder untuk export Excel"
```

---

## Task 7: API route `GET /api/admin/rekap/layanan-options`

**Files:**
- Create: `src/app/api/admin/rekap/layanan-options/route.ts`
- Create: `src/app/api/admin/rekap/layanan-options/layanan-options.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`
- Produces: HTTP route handler returning JSON `{ options, default_layanan_id, is_petugas }`

- [ ] **Step 1: Write failing test**

Create `src/app/api/admin/rekap/layanan-options/layanan-options.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

function makeMock(opts: { role: string; layananId: string | null; layananList: { id: string; nama: string; tipe: string }[] }) {
  const single = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ single });
  const petugasSelect = vi.fn().mockReturnValue({ eq });

  const order = vi.fn().mockResolvedValue({ data: opts.layananList, error: null });
  const layananSelect = vi.fn().mockReturnValue({ order });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    from: vi.fn((t: string) =>
      t === 'petugas' ? { select: petugasSelect } : { select: layananSelect },
    ),
  };
}

describe('GET /api/admin/rekap/layanan-options', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns single option for petugas scoped to their layanan', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMock({
        role: 'petugas',
        layananId: 'svc-oss',
        layananList: [],
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_petugas).toBe(true);
    expect(body.default_layanan_id).toBe('svc-oss');
    expect(body.options).toEqual([]);
  });

  it('returns all layanan for admin', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMock({
        role: 'admin',
        layananId: null,
        layananList: [
          { id: 'svc-oss', nama: 'Helpdesk OSS', tipe: 'konsultatif' },
          { id: 'svc-p4', nama: 'BPJS', tipe: 'mitra' },
        ],
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_petugas).toBe(false);
    expect(body.default_layanan_id).toBeNull();
    expect(body.options).toHaveLength(2);
    expect(body.options[0]).toEqual({
      id: 'svc-oss',
      nama: 'Helpdesk OSS',
      tipe: 'konsultatif',
      jenis_pendataan: 'oss',
    });
  });

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/admin/rekap/layanan-options/layanan-options.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement route**

Create `src/app/api/admin/rekap/layanan-options/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { determineFormType } from '@/lib/pelayanan';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (me.role === 'petugas') {
    return NextResponse.json({
      options: [],
      default_layanan_id: me.layanan_id,
      is_petugas: true,
    });
  }

  // admin or front_office: list all active layanan
  const { data: rows, error } = await supabase
    .from('layanan')
    .select('id, nama, tipe')
    .eq('aktif', true)
    .order('nama');

  if (error) {
    return NextResponse.json({ error: 'Gagal memuat daftar layanan' }, { status: 500 });
  }

  const options = (rows ?? []).map((l) => ({
    id: l.id,
    nama: l.nama,
    tipe: l.tipe,
    jenis_pendataan: determineFormType(l.nama),
  }));

  return NextResponse.json({
    options,
    default_layanan_id: null,
    is_petugas: false,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/admin/rekap/layanan-options/layanan-options.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/rekap/layanan-options/route.ts src/app/api/admin/rekap/layanan-options/layanan-options.test.ts
git commit -m "feat(rekap): tambah endpoint layanan-options"
```

---

## Task 8: API route `GET /api/admin/rekap/tickets`

**Files:**
- Create: `src/app/api/admin/rekap/tickets/route.ts`
- Create: `src/app/api/admin/rekap/tickets/tickets.test.ts`

**Interfaces:**
- Consumes: `ticketsQuerySchema` from Task 3, `buildTicketsQuery` from Task 5
- Produces: HTTP route handler returning `{ total, rows: RekapTicketRow[] }`

- [ ] **Step 1: Write failing test**

Create `src/app/api/admin/rekap/tickets/tickets.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

function buildMock(opts: {
  role: string;
  layananId: string | null;
  rows?: { id: string; nomor_display: string };
}) {
  const total = opts.rows?.length ?? 0;
  const range = vi.fn().mockResolvedValue({
    data: opts.rows ?? [],
    count: total,
    error: null,
  });
  const order = vi.fn().mockReturnValue({ range });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const eq4 = vi.fn().mockReturnValue({ gte });
  const eq3 = vi.fn().mockReturnValue({ eq4 });
  const eq2 = vi.fn().mockReturnValue({ eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq2 });
  const select = vi.fn().mockReturnValue({ eq1 });

  const single = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eqP = vi.fn().mockReturnValue({ single });
  const selectP = vi.fn().mockReturnValue({ eq: eqP });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    from: vi.fn((t: string) =>
      t === 'petugas' ? { select: selectP } : { select },
    ),
  };
}

describe('GET /api/admin/rekap/tickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await GET(new Request('http://localhost/api/admin/rekap/tickets'));
    expect(res.status).toBe(401);
  });

  it('returns rows for admin without layanan_id filter', async () => {
    const mock = buildMock({
      role: 'admin',
      layananId: null,
      rows: [{ id: 't-1', nomor_display: 'A-001' }],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await GET(new Request('http://localhost/api/admin/rekap/tickets'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
  });

  it('forces layanan_id for petugas matching own', async () => {
    const mock = buildMock({
      role: 'petugas',
      layananId: 'svc-oss',
      rows: [],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const url = 'http://localhost/api/admin/rekap/tickets?layanan_id=svc-oss';
    const res = await GET(new Request(url));
    expect(res.status).toBe(200);
  });

  it('returns 403 when petugas passes layanan_id different from own', async () => {
    const mock = buildMock({
      role: 'petugas',
      layananId: 'svc-oss',
      rows: [],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const url = 'http://localhost/api/admin/rekap/tickets?layanan_id=550e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });

  it('returns 422 on invalid q (too long)', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const longQ = 'a'.repeat(101);
    const url = `http://localhost/api/admin/rekap/tickets?q=${longQ}`;
    const res = await GET(new Request(url));
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/admin/rekap/tickets/tickets.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement route**

Create `src/app/api/admin/rekap/tickets/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ticketsQuerySchema } from '@/lib/rekap/schemas';
import { buildTicketsQuery } from '@/lib/rekap/query';
import type { RekapTicketRow } from '@/lib/rekap/excel';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawParams: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((v, k) => {
    rawParams[k] = v;
  });

  const parsed = ticketsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  let effectiveLayananId: string | null;
  if (me.role === 'petugas') {
    if (parsed.data.layanan_id && parsed.data.layanan_id !== me.layanan_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    effectiveLayananId = me.layanan_id ?? null;
  } else {
    effectiveLayananId = parsed.data.layanan_id ?? null;
  }

  const pageSize = parsed.data.page_size;
  const page = parsed.data.page;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const query = buildTicketsQuery(supabase, {
    layananId: effectiveLayananId,
    q: parsed.data.q,
    dari: parsed.data.dari,
    sampai: parsed.data.sampai,
    from,
    to,
  });

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: 'Gagal memuat rekap' }, { status: 500 });
  }

  const rows: RekapTicketRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const oss = r.pelayanan_oss as RekapTicketRow['pelayanan_oss'];
    const per = r.pelayanan_perizinAN as RekapTicketRow['pelayanan_perizinAN'];
    const form_type: RekapTicketRow['form_type'] = oss ? 'oss' : per ? 'perizinAN' : null;
    return {
      id: r.id as string,
      nomor_display: r.nomor_display as string,
      tanggal: r.tanggal as string,
      waktu_terbit: r.waktu_terbit as string,
      waktu_mulai_layan: (r.waktu_mulai_layan as string | null) ?? null,
      waktu_selesai: (r.waktu_selesai as string | null) ?? null,
      status: r.status as string,
      kunjungan: r.kunjungan as RekapTicketRow['kunjungan'],
      petugas: r.petugas as RekapTicketRow['petugas'],
      form_type,
      pelayanan_oss: oss ?? null,
      pelayanan_perizinAN: per ?? null,
    };
  });

  return NextResponse.json({ total: count ?? 0, rows });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/admin/rekap/tickets/tickets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/rekap/tickets/route.ts src/app/api/admin/rekap/tickets/tickets.test.ts
git commit -m "feat(rekap): tambah endpoint tickets dengan filter dan search"
```

---

## Task 9: API route `GET /api/admin/rekap/export`

**Files:**
- Create: `src/app/api/admin/rekap/export/route.ts`
- Create: `src/app/api/admin/rekap/export/export.test.ts`

**Interfaces:**
- Consumes: `exportQuerySchema` from Task 3, `buildTicketsQuery` from Task 5, `buildRekapWorkbook` from Task 6
- Produces: HTTP route handler returning `Response` with binary xlsx body

- [ ] **Step 1: Write failing test**

Create `src/app/api/admin/rekap/export/export.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

function buildMock(opts: { role: string; layananId: string | null; rows: unknown[] }) {
  const range = vi.fn().mockResolvedValue({ data: opts.rows, error: null });
  const order = vi.fn().mockReturnValue({ range });
  const lte = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ lte });
  const eq5 = vi.fn().mockReturnValue({ gte });
  const eq4 = vi.fn().mockReturnValue({ eq5 });
  const eq3 = vi.fn().mockReturnValue({ eq4 });
  const eq2 = vi.fn().mockReturnValue({ eq3 });
  const eq1 = vi.fn().mockReturnValue({ eq2 });
  const limit = vi.fn().mockReturnValue({ eq1 });
  const select = vi.fn().mockReturnValue({ limit });
  const tiketFrom = { select };

  const single = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eqP = vi.fn().mockReturnValue({ single });
  const selectP = vi.fn().mockReturnValue({ eq: eqP });
  const petugasFrom = { select: selectP };

  const insert = vi.fn().mockResolvedValue({ error: null });
  const auditFrom = { insert };

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    from: vi.fn((t: string) => {
      if (t === 'petugas') return petugasFrom;
      if (t === 'audit_log') return auditFrom;
      return tiketFrom;
    }),
  };
}

describe('GET /api/admin/rekap/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await GET(new Request('http://localhost/api/admin/rekap/export'));
    expect(res.status).toBe(401);
  });

  it('returns xlsx for admin with empty rows', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await GET(new Request('http://localhost/api/admin/rekap/export'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('returns 403 for petugas accessing other layanan', async () => {
    const mock = buildMock({ role: 'petugas', layananId: 'svc-oss', rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const url = 'http://localhost/api/admin/rekap/export?layanan_id=550e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new Request(url));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/admin/rekap/export/export.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement route**

Create `src/app/api/admin/rekap/export/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exportQuerySchema } from '@/lib/rekap/schemas';
import { buildTicketsQuery } from '@/lib/rekap/query';
import { buildRekapWorkbook, type RekapTicketRow } from '@/lib/rekap/excel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ROWS = 50000;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawParams: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((v, k) => {
    rawParams[k] = v;
  });

  const parsed = exportQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let effectiveLayananId: string | null;
  let layananNama = 'semua-layanan';
  if (me.role === 'petugas') {
    if (parsed.data.layanan_id && parsed.data.layanan_id !== me.layanan_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    effectiveLayananId = me.layanan_id ?? null;
    if (effectiveLayananId) {
      const { data: l } = await supabase.from('layanan').select('nama').eq('id', effectiveLayananId).maybeSingle();
      layananNama = l?.nama ? slugify(l.nama) : 'layanan';
    }
  } else {
    effectiveLayananId = parsed.data.layanan_id ?? null;
    if (effectiveLayananId) {
      const { data: l } = await supabase.from('layanan').select('nama').eq('id', effectiveLayananId).maybeSingle();
      layananNama = l?.nama ? slugify(l.nama) : 'layanan';
    }
  }

  const baseQuery = buildTicketsQuery(supabase, {
    layananId: effectiveLayananId,
    q: parsed.data.q,
    dari: parsed.data.dari,
    sampai: parsed.data.sampai,
    from: 0,
    to: MAX_ROWS - 1,
  });

  const { data, error } = await baseQuery;
  if (error) {
    return new Response(JSON.stringify({ error: 'Gagal memuat rekap' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows: RekapTicketRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const oss = r.pelayanan_oss as RekapTicketRow['pelayanan_oss'];
    const per = r.pelayanan_perizinAN as RekapTicketRow['pelayanan_perizinAN'];
    const form_type: RekapTicketRow['form_type'] = oss ? 'oss' : per ? 'perizinAN' : null;
    return {
      id: r.id as string,
      nomor_display: r.nomor_display as string,
      tanggal: r.tanggal as string,
      waktu_terbit: r.waktu_terbit as string,
      waktu_mulai_layan: (r.waktu_mulai_layan as string | null) ?? null,
      waktu_selesai: (r.waktu_selesai as string | null) ?? null,
      status: r.status as string,
      kunjungan: r.kunjungan as RekapTicketRow['kunjungan'],
      petugas: r.petugas as RekapTicketRow['petugas'],
      form_type,
      pelayanan_oss: oss ?? null,
      pelayanan_perizinAN: per ?? null,
    };
  });

  const truncated = rows.length >= MAX_ROWS;
  const buf = await buildRekapWorkbook(rows);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_role: me.role,
    aksi: 'export_xlsx',
    entitas: 'rekap_pelayanan',
    detail: {
      layanan_id: effectiveLayananId,
      dari: parsed.data.dari,
      sampai: parsed.data.sampai,
      q: parsed.data.q,
      total_rows: rows.length,
      truncated,
    },
  });

  const filename = `rekap-${layananNama}-${parsed.data.dari}-sd-${parsed.data.sampai}.xlsx`;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Rekap-Truncated': truncated ? 'true' : 'false',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/admin/rekap/export/export.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/rekap/export/route.ts src/app/api/admin/rekap/export/export.test.ts
git commit -m "feat(rekap): tambah endpoint export Excel dengan audit log"
```

---

## Task 10: Side panel component untuk detail tiket

**Files:**
- Create: `src/components/admin/RekapTiketDetailPanel.tsx`
- Create: `src/components/admin/RekapTiketDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `RekapTicketRow` from `@/lib/rekap/excel`
- Produces: React component `<RekapTiketDetailPanel tiket={row} onClose={() => void} />`

- [ ] **Step 1: Write failing test**

Create `src/components/admin/RekapTiketDetailPanel.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RekapTiketDetailPanel from './RekapTiketDetailPanel';
import type { RekapTicketRow } from '@/lib/rekap/excel';

const baseRow: RekapTicketRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: 'oss',
  pelayanan_oss: {
    id: 'p-1',
    nama_pemohon: 'Budi',
    nama_usaha: 'Usaha A',
    tipe_pelaku_usaha: 'perseorangan',
    status_penanaman_modal: 'PMDN',
    lokasi_usaha: 'Bandar Lampung',
    skala_usaha: 'Mikro',
    sektor_usaha_kbli: '47111',
    tindak_lanjut: 'disposisi',
    uraian_solusi: 'Solusi X',
    catatan_internal: null,
  },
  pelayanan_perizinAN: null,
};

describe('RekapTiketDetailPanel', () => {
  afterEach(() => cleanup());

  it('renders nothing when tiket is null', () => {
    const { container } = render(<RekapTiketDetailPanel tiket={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tiket header and basic fields', () => {
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={() => {}} />);
    expect(screen.getByText(/A-001/)).toBeInTheDocument();
    expect(screen.getByText(/Budi/)).toBeInTheDocument();
    expect(screen.getByText(/Andi/)).toBeInTheDocument();
  });

  it('renders OSS section when form_type is oss', () => {
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={() => {}} />);
    expect(screen.getByText(/Usaha A/)).toBeInTheDocument();
    expect(screen.getByText(/PMDN/)).toBeInTheDocument();
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /tutup/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn();
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "tidak ada pendataan" when no form_type', () => {
    const row: RekapTicketRow = { ...baseRow, form_type: null, pelayanan_oss: null, pelayanan_perizinAN: null };
    render(<RekapTiketDetailPanel tiket={row} onClose={() => {}} />);
    expect(screen.getByText(/tidak memiliki data pendataan/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/admin/RekapTiketDetailPanel.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement panel**

Create `src/components/admin/RekapTiketDetailPanel.tsx`:
```tsx
'use client';

import { useEffect } from 'react';
import { X, FileText, User, Clock, Briefcase } from 'lucide-react';
import type { RekapTicketRow } from '@/lib/rekap/excel';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from '@/lib/rekap/format';

interface Props {
  tiket: RekapTicketRow | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginTop: 2 }}>
        {value || '—'}
      </div>
    </div>
  );
}

export default function RekapTiketDetailPanel({ tiket, onClose }: Props) {
  useEffect(() => {
    if (!tiket) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tiket, onClose]);

  if (!tiket) return null;

  const durasi = hitungDurasiMenit(tiket.waktu_mulai_layan, tiket.waktu_selesai);
  const o = tiket.pelayanan_oss;
  const p = tiket.pelayanan_perizinAN;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detail tiket ${tiket.nomor_display}`}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(440px, 92vw)',
            background: '#ffffff',
            boxShadow: '-4px 0 20px rgba(15, 23, 42, 0.12)',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}
        >
          <header style={{
            padding: 'var(--space-5)',
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                Detail Tiket
              </div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-primary-700)' }}>
                {tiket.nomor_display}
              </div>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup">
              <X size={18} />
            </button>
          </header>

          <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <User size={14} /> Identitas Pengunjung
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Field label="Nama" value={tiket.kunjungan?.nama} />
                <Field label="Asal" value={tiket.kunjungan?.asal} />
                <Field label="Tanggal" value={formatTanggalId(tiket.tanggal)} />
                <Field label="QR Token" value={tiket.kunjungan?.qr_token} />
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} /> Tiket
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <Field label="Waktu Terbit" value={formatWaktuId(tiket.waktu_terbit)} />
                <Field label="Waktu Mulai" value={formatWaktuId(tiket.waktu_mulai_layan)} />
                <Field label="Waktu Selesai" value={formatWaktuId(tiket.waktu_selesai)} />
                <Field label="Durasi" value={durasi != null ? `${durasi} menit` : null} />
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Briefcase size={14} /> Petugas
              </h3>
              <Field label="Nama Petugas" value={tiket.petugas?.nama} />
            </section>

            {tiket.form_type === 'oss' && o && (
              <section>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> Pendataan OSS
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <Field label="Nama Pemohon" value={o.nama_pemohon} />
                  <Field label="Nama Usaha" value={o.nama_usaha} />
                  <Field label="Tipe Pelaku" value={o.tipe_pelaku_usaha} />
                  <Field label="Status PM" value={o.status_penanaman_modal} />
                  <Field label="Lokasi" value={o.lokasi_usaha} />
                  <Field label="Skala" value={o.skala_usaha} />
                  <Field label="Sektor KBLI" value={o.sektor_usaha_kbli} />
                  <Field label="Tindak Lanjut" value={o.tindak_lanjut} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Uraian Solusi" value={o.uraian_solusi} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Catatan Internal" value={o.catatan_internal} />
                  </div>
                </div>
              </section>
            )}

            {tiket.form_type === 'perizinAN' && p && (
              <section>
                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={14} /> Pendataan PerizinAN
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <Field label="Nama Pemohon" value={p.nama_pemohon} />
                  <Field label="Nama Perusahaan" value={p.nama_perusahaan} />
                  <Field label="OPD Teknis" value={p.opd_teknis} />
                  <Field label="Tindak Lanjut" value={p.tindak_lanjut} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Uraian Permohonan" value={p.uraian_permohonan} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Catatan Petugas" value={p.catatan_petugas} />
                  </div>
                </div>
              </section>
            )}

            {!tiket.form_type && (
              <section>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', textAlign: 'center', padding: 'var(--space-4)' }}>
                  Tiket ini tidak memiliki data pendataan.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/admin/RekapTiketDetailPanel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/RekapTiketDetailPanel.tsx src/components/admin/RekapTiketDetailPanel.test.tsx
git commit -m "feat(rekap): tambah side panel detail tiket read-only"
```

---

## Task 11: Tabel rekapitulasi component (filter, search, pagination)

**Files:**
- Create: `src/components/admin/RekapLayananTable.tsx`
- Create: `src/components/admin/RekapLayananTable.test.tsx`

**Interfaces:**
- Consumes: `RekapTicketRow` from `@/lib/rekap/excel`
- Produces: React component `<RekapLayananTable isPetugas={boolean} initialLayananId={string | null} onLayananOptionsLoad={function} />` (parent page supplies layananOptions separately via fetch)

- [ ] **Step 1: Write failing test**

Create `src/components/admin/RekapLayananTable.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import RekapLayananTable from './RekapLayananTable';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@/components/Pagination', () => ({
  default: ({ onPageChange }: { onPageChange: (p: number) => void }) => (
    <div>
      <button onClick={() => onPageChange(1)}>next-page</button>
    </div>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const sampleRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: null,
  pelayanan_oss: null,
  pelayanan_perizinAN: null,
};

describe('RekapLayananTable', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 1, rows: [sampleRow] }),
    });
  });
  afterEach(() => cleanup());

  it('renders filter form and initial fetch', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('shows empty state when total is 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, rows: [] }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/tidak ada tiket selesai/i)).toBeInTheDocument();
    });
  });

  it('renders rows with formatted fields', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/A-001/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Budi/)).toBeInTheDocument();
    expect(screen.getByText(/Andi/)).toBeInTheDocument();
  });

  it('disables export when no rows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total: 0, rows: [] }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      const exportBtn = screen.getByRole('button', { name: /download excel/i });
      expect(exportBtn).toBeDisabled();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/coba lagi/i)).toBeInTheDocument();
    });
  });

  it('opens detail panel on row click', async () => {
    render(<RekapLayananTable isPetugas={false} initialLayananId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/A-001/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /lihat detail/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/admin/RekapLayananTable.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement table component**

Create `src/components/admin/RekapLayananTable.tsx`:
```tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Download, RefreshCw, AlertCircle, Loader2, Eye, X } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { useToast } from '@/components/Toast';
import RekapTiketDetailPanel from '@/components/admin/RekapTiketDetailPanel';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from '@/lib/rekap/format';
import type { RekapTicketRow } from '@/lib/rekap/excel';

interface LayananOption {
  id: string;
  nama: string;
}

const PAGE_SIZE = 25;

interface Props {
  isPetugas: boolean;
  initialLayananId: string | null;
}

export default function RekapLayananTable({ isPetugas, initialLayananId }: Props) {
  const { toast } = useToast();
  const [options, setOptions] = useState<LayananOption[]>([]);
  const [layananId, setLayananId] = useState<string>(initialLayananId ?? '');
  const [dari, setDari] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [sampai, setSampai] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<RekapTicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RekapTicketRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load options (only for admin/FO; petugas already has fixed layanan)
  useEffect(() => {
    if (isPetugas) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/rekap/layanan-options');
        const body = await res.json();
        if (!cancelled && res.ok) {
          setOptions(body.options ?? []);
        }
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPetugas]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (layananId) params.set('layanan_id', layananId);
      if (q.trim()) params.set('q', q.trim());
      params.set('dari', dari);
      params.set('sampai', sampai);
      params.set('page', String(page));
      params.set('page_size', String(PAGE_SIZE));
      const res = await fetch(`/api/admin/rekap/tickets?${params}`);
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          toast('Anda tidak punya akses ke layanan ini', 'error');
        } else {
          toast(body.error ?? 'Gagal memuat rekap', 'error');
        }
        setError(body.error ?? 'Gagal memuat rekap');
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(body.rows ?? []);
      setTotal(body.total ?? 0);
    } catch {
      setError('Tidak ada koneksi');
      toast('Tidak ada koneksi', 'error');
    } finally {
      setLoading(false);
    }
  }, [layananId, q, dari, sampai, page, toast]);

  // Initial fetch + on filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchRows();
    }, q ? 300 : 0); // debounce only on search
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchRows, q]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (layananId) params.set('layanan_id', layananId);
      if (q.trim()) params.set('q', q.trim());
      params.set('dari', dari);
      params.set('sampai', sampai);
      const res = await fetch(`/api/admin/rekap/export?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? 'Gagal mengekspor Excel', 'error');
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'rekap.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (res.headers.get('X-Rekap-Truncated') === 'true') {
        toast('Data terpotong ke 50.000 baris. Persempit rentang tanggal.', 'warning');
      } else {
        toast('Berkas Excel berhasil diunduh', 'success');
      }
    } catch {
      toast('Gagal mengekspor Excel', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end',
        padding: 'var(--space-4)', background: '#ffffff', borderRadius: 'var(--radius-lg, 12px)',
        border: '1px solid var(--border-default, #e2e8f0)', marginBottom: 'var(--space-4)',
      }}>
        <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
          <label className="form-label">Layanan</label>
          <select
            className="form-input"
            value={layananId}
            onChange={(e) => { setLayananId(e.target.value); setPage(0); }}
            disabled={isPetugas}
          >
            {!isPetugas && <option value="">Semua Layanan</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.nama}</option>
            ))}
            {isPetugas && initialLayananId && (
              <option value={initialLayananId}>{options.find(o => o.id === initialLayananId)?.nama ?? initialLayananId}</option>
            )}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Dari</label>
          <input type="date" className="form-input" value={dari} onChange={(e) => { setDari(e.target.value); setPage(0); }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Sampai</label>
          <input type="date" className="form-input" value={sampai} onChange={(e) => { setSampai(e.target.value); setPage(0); }} />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label className="form-label">Cari</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Nama, nomor, usaha..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => { setPage(0); fetchRows(); }} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button className="btn btn--primary btn--sm" onClick={handleExport} disabled={loading || exporting || rows.length === 0}>
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {' '}Download Excel
        </button>
      </div>

      {/* Stats */}
      <div className="grid-stats" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat-card">
          <span className="stat-card__value">{total}</span>
          <span className="stat-card__label">Total Selesai (rentang)</span>
        </div>
        <div className="stat-card">
          <span className="stat-card__value">
            {rows.length > 0
              ? Math.round(
                  rows.reduce((s, r) => s + (hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai) ?? 0), 0) /
                    rows.filter(r => hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai) != null).length,
                ) || 0
              : 0}
          </span>
          <span className="stat-card__label">Rata-rata Durasi (mnt, halaman ini)</span>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        {loading ? (
          <table className="table" aria-hidden="true">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={10}><div className="skeleton" style={{ height: 20, width: '100%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-danger-700)' }}>
            <AlertCircle size={32} style={{ margin: '0 auto var(--space-3)' }} />
            <p>{error}</p>
            <button className="btn btn--primary btn--sm" onClick={fetchRows} style={{ marginTop: 'var(--space-3)' }}>
              Coba Lagi
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-tertiary)' }}>
            <p>Tidak ada tiket selesai dalam rentang tanggal ini.</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>No Antrian</th>
                <th>Nama Pengunjung</th>
                <th>Asal</th>
                <th>Petugas</th>
                <th>Mulai</th>
                <th>Selesai</th>
                <th>Durasi</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dur = hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai);
                return (
                  <tr key={r.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTanggalId(r.tanggal)}</td>
                    <td style={{ fontWeight: 700, color: 'var(--color-primary-700)' }}>{r.nomor_display}</td>
                    <td>{r.kunjungan?.nama ?? '—'}</td>
                    <td><span className="badge badge--draft">{r.kunjungan?.asal ?? '—'}</span></td>
                    <td>{r.petugas?.nama ?? '—'}</td>
                    <td>{formatWaktuId(r.waktu_mulai_layan)}</td>
                    <td>{formatWaktuId(r.waktu_selesai)}</td>
                    <td>{dur != null ? `${dur} mnt` : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setSelected(r)}
                        aria-label="Lihat Detail"
                      >
                        <Eye size={14} /> Lihat
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <RekapTiketDetailPanel tiket={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/admin/RekapLayananTable.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/RekapLayananTable.tsx src/components/admin/RekapLayananTable.test.tsx
git commit -m "feat(rekap): tambah tabel rekap dengan filter, search, dan pagination"
```

---

## Task 12: Extend `src/app/admin/rekap/page.tsx` dengan tab "Rekap Per Layanan"

**Files:**
- Modify: `src/app/admin/rekap/page.tsx` (add tab + render `RekapLayananTable`)

- [ ] **Step 1: Update type dan state**

In `src/app/admin/rekap/page.tsx`, change line 77:
```ts
type TabType = 'umum' | 'oss' | 'perizinan';
```
to:
```ts
type TabType = 'umum' | 'oss' | 'perizinan' | 'layanan';
```

- [ ] **Step 2: Add tab button in nav**

Find the tab nav block (lines 247-276). Add a fourth button after the perizinan tab (before the closing `</div>` of the nav):
```tsx
<button
  className={`btn ${activeTab === 'layanan' ? 'btn--primary' : 'btn--ghost'} btn--sm`}
  onClick={() => setActiveTab('layanan')}
  style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
>
  <BarChart2 size={16} /> Rekap Per Layanan
</button>
```

- [ ] **Step 3: Add tab content**

Find the closing `)}` of the perizinan tab block (just before the `Download CSV Button` div at line 530). Insert before the download CSV button:
```tsx
{/* TAB 4: REKAP PER LAYANAN */}
{activeTab === 'layanan' && (
  <RekapLayananTable isPetugas={false} initialLayananId={null} />
)}
```

- [ ] **Step 4: Add import and conditional CSV button**

Add to the imports near top of file:
```tsx
import RekapLayananTable from '@/components/admin/RekapLayananTable';
```

Change the `handleExportCsv` filename/csv building for `activeTab === 'layanan'` — add a branch:
```tsx
if (activeTab === 'layanan') {
  // Tab ini punya tombol download sendiri, skip CSV
  return;
}
```

Add this branch as the FIRST check inside `handleExportCsv` (before the `if (activeTab === 'umum')`). Also update the CSV button label:
```tsx
{activeTab !== 'layanan' && (
  <button className="btn btn--ghost btn--sm" onClick={handleExportCsv}>
    <Download size={14} /> Unduh CSV (
    {activeTab === 'umum'
      ? 'Rekap Umum'
      : activeTab === 'oss'
      ? `OSS - ${ossRows.length} baris`
      : `Perizinan - ${perizinanRows.length} baris`}
    )
  </button>
)}
```

- [ ] **Step 5: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev` and visit `http://localhost:3000/admin/rekap` → click tab "Rekap Per Layanan" → confirm filter form renders.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/rekap/page.tsx
git commit -m "feat(rekap): tambah tab Rekap Per Layanan di halaman admin rekap"
```

---

## Task 13: Page integration test

**Files:**
- Create: `src/app/admin/rekap/rekap-layanan.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/app/admin/rekap/rekap-layanan.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/admin/RekapLayananTable', () => ({
  default: ({ isPetugas, initialLayananId }: { isPetugas: boolean; initialLayananId: string | null }) => (
    <div data-testid="rekap-table">{`isPetugas=${isPetugas};layananId=${initialLayananId ?? 'null'}`}</div>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        gte: vi.fn(() => ({
          lte: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      })),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
  })),
}));

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import AdminRekapPage from './page';

describe('Admin rekap page - new tab', () => {
  it('renders all 4 tab buttons', async () => {
    render(<AdminRekapPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: /rekap umum harian/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pendataan helpdesk oss/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pendataan perizinan dpmptsp/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rekap per layanan/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/admin/rekap/rekap-layanan.test.tsx`
Expected: FAIL (mocked component not found OR tab button missing).

- [ ] **Step 3: Verify test passes after Task 12 was implemented**

Run: `npm test -- src/app/admin/rekap/rekap-layanan.test.tsx`
Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Run all gates**

Run:
```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: 0 errors, all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/rekap/rekap-layanan.test.tsx
git commit -m "test(rekap): tambah integration test untuk tab Rekap Per Layanan"
```

---

## Self-Review

After all tasks done, verify:

1. **Spec coverage**: Run `grep -c "Rekap Layanan\|layanan-options\|export.*xlsx\|RekapLayananTable" docs/superpowers/specs/2026-09-01-rekap-layanan-design.md` — should match tasks.
2. **Placeholder scan**: No "TODO" or "TBD" in plan.
3. **Type consistency**: `RekapTicketRow` defined in `src/lib/rekap/excel.ts` is imported by `RekapLayananTable`, `RekapTiketDetailPanel`, and both routes. Same shape used everywhere.
4. **Lint clean**: `npm run lint` with `--max-warnings=0` passes.
5. **Build clean**: `npm run build` succeeds.

---

## Final Wrap-up

- [ ] **Step 1: Run full verify baseline**

Run: `npm run verify:baseline`
Expected: 0 errors, all tests pass, build succeeds.

- [ ] **Step 2: Show summary to user**

Output: list of 13 commits + summary of what was built. Tell user the plan is complete and ask if they want to push to GitHub (do NOT push automatically per AGENTS.md).

---


---


---


---


---


---


---


---

