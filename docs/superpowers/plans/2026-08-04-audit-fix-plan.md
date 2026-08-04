# LMH Audit Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical, high, and medium findings from the 2026-08-04 deep audit across security, compliance, operational correctness, role completion, and UX.

**Architecture:** Four independent work streams (A–D) that can run in parallel. Stream A (security/compliance) should land first because other streams depend on `src/proxy.ts` existing. Within each stream, tasks are independent unless noted.

**Tech Stack:** Next.js 16 (proxy.ts, not middleware.ts), Supabase SSR (`@supabase/ssr`), Vitest, React 19, TypeScript 5

## Global Constraints

- Next.js 16: `middleware.ts` is deprecated → use `proxy.ts` with `export function proxy(request)` and `export const config = { matcher }`.
- Supabase SSR: use `createServerClient` from `@supabase/ssr` in proxy (not `createClient` from `@/lib/supabase/server` which requires async cookie jar).
- All timestamps for operational data (waktu_masuk, waktu_mulai_layan, waktu_selesai, jam_pulang) MUST come from PostgreSQL `now()` or DB default, NEVER from `new Date().toISOString()` on client.
- Timezone: use `todayWIB()` / `toWIBDateString()` from `@/lib/time.ts` for date boundaries. Never `new Date().getFullYear()` for WIB dates.
- Test runner: `vitest run --pool=vmForks`. Environment default `jsdom`, node tests use `// @vitest-environment node`.
- Alias: `@/` → `src/`.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Dependency Graph

```
A1 (proxy.ts) ─── independent, land first
A2 (checkin consent) ─── independent
A3 (scan double-scan) ─── independent
A4 (chat interval leak) ─── independent
A5 (dokumen embed service role) ─── independent
A6 (signed-url audit log) ─── independent

B1 (layar-antrian polling) ─── independent
B2 (antrian stats server-side) ─── independent
B3 (absensi jam_pulang RPC) ─── independent
B4 (pengaduan permission UI) ─── independent
B5 (investasi-leads server filter) ─── independent

C1 (FO role invite + sidebar + guard) ─── independent

D1 (minor UX batch) ─── independent
```

---

## STREAM A: Security & PDP Compliance (Critical)

---

### Task A1: Add `src/proxy.ts` for server-side admin route protection

**Files:**
- Create: `src/proxy.ts`
- Create: `src/proxy.test.ts`

**Interfaces:**
- Consumes: `@supabase/ssr` `createServerClient`, `next/server` `NextRequest`/`NextResponse`
- Produces: Server-side redirect for unauthenticated `/admin` requests

- [ ] **Step 1: Write the failing test**

```ts
// src/proxy.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Next.js 16 provides unstable_doesProxyMatch for config testing
describe('proxy.ts config', () => {
  it('has a defined matcher config', async () => {
    const { config } = await import('./proxy');
    expect(config.matcher).toBeDefined();
    const matchers = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    expect(matchers.length).toBeGreaterThan(0);
  });

  it('does not match static asset paths', async () => {
    const { config } = await import('./proxy');
    const matchers = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    const joinedMatchers = matchers.join(' ');
    // Should exclude _next/static and _next/image
    expect(joinedMatchers).toContain('_next');
  });

  it('exports a proxy function', async () => {
    const mod = await import('./proxy');
    expect(typeof mod.proxy).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/proxy.test.ts --pool=vmForks`
Expected: FAIL — module `./proxy` not found

- [ ] **Step 3: Write the proxy implementation**

```ts
// src/proxy.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll().map((c) => ({
            name: c.name,
            value: c.value,
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Refresh session — must happen before any response is generated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect /admin routes: redirect unauthenticated users to /login
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    '/((?!_next/static|_next/image|.*\\.png$|.*\\.ico$|.*\\.svg$|.*\\.webp$|sw-push\\.js$).*)',
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/proxy.test.ts --pool=vmForks`
Expected: PASS

- [ ] **Step 5: Verify build succeeds**

Run: `npx next build 2>&1 | head -20`
Expected: No error about proxy.ts

- [ ] **Step 6: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts
git commit -m "feat: add src/proxy.ts for server-side admin route protection (K-6)

Next.js 16 proxy replaces deprecated middleware.
Redirects unauthenticated users from /admin/* to /login.
Session refresh ensures cookies stay up to date.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A2: Fix checkin consent reset + error handling

**Files:**
- Modify: `src/app/checkin/page.tsx` (lines 167–188, 228–234)
- Test: `src/app/checkin/checkin.rls.test.tsx` (add new test)

**Interfaces:**
- Consumes: existing `consentGiven` state, `handleReset` function
- Produces: `consentGiven` always reset to `false` on new check-in; consent insert error surfaced

- [ ] **Step 1: Write failing test for consent reset**

Add to `src/app/checkin/checkin.rls.test.tsx` at the end of `describe('K3 checkin page: auth gate')`:

```ts
  it('resets consentGiven checkbox when handleReset is called (K-4 PDP fix)', async () => {
    const { inserts } = buildMockSupabase({
      user: { id: 'google-user-3' },
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP' }],
    });

    render(<CheckinPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/nama lengkap/i)).toBeInTheDocument();
    });

    // Fill form and check consent
    fireEvent.change(screen.getByLabelText(/nama lengkap/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/layanan tujuan/i), { target: { value: 'lay-1' } });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /kirim check-in/i }));

    // Wait for success
    await waitFor(() => {
      expect(screen.getByText(/check-in berhasil/i)).toBeInTheDocument();
    });

    // Click "Check-in Baru"
    fireEvent.click(screen.getByRole('button', { name: /check-in baru/i }));

    // Consent checkbox must be unchecked
    await waitFor(() => {
      const checkbox = screen.getByLabelText(/saya setuju data saya diproses/i) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/checkin/checkin.rls.test.tsx --pool=vmForks`
Expected: FAIL — checkbox is still checked after reset

- [ ] **Step 3: Fix handleReset and consent error handling in page.tsx**

In `src/app/checkin/page.tsx`, modify `handleReset`:

```ts
  const handleReset = () => {
    setForm({ nama: '', keperluan: '', layanan_id: '' });
    setSuccess(false);
    setError('');
    setSuccessToken(null);
    setQueuePos(null);
    setConsentGiven(false); // K-4: reset consent for next visitor (PDP compliance)
  };
```

Also fix consent insert error handling in `handleSubmit` (around line 167). Replace:

```ts
      if (currentUserId && consentGiven) {
        await supabase.from('consent_log').insert({
          subjek_ref: currentUserId,
          tujuan: 'checkin_data',
          disetujui: true,
          versi_kebijakan: CONSENT_VERSION,
        });
      }
```

With:

```ts
      // K-2: Consent MUST be recorded before visit insert. Await and check error.
      if (currentUserId && consentGiven) {
        const { error: consentError } = await supabase.from('consent_log').insert({
          subjek_ref: currentUserId,
          tujuan: 'checkin_data',
          disetujui: true,
          versi_kebijakan: CONSENT_VERSION,
        });
        if (consentError) {
          setError('Gagal mencatat persetujuan data. Silakan coba lagi.');
          setLoading(false);
          return;
        }
      }
```

Also fix offline path — change `consent_given: true` to `consent_given: consentGiven` (line ~136):

```ts
          consent_given: consentGiven,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/checkin/checkin.rls.test.tsx --pool=vmForks`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/app/checkin/page.tsx src/app/checkin/checkin.rls.test.tsx
git commit -m "fix: reset consent checkbox on new check-in + await consent insert (K-2, K-4)

- consentGiven reset to false in handleReset (PDP compliance for shared kiosk)
- consent_log insert now awaited with error handling — blocks visit if fails
- offline path uses actual consentGiven state instead of hardcoded true

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A3: Fix double-scan vulnerability in admin/scan

**Files:**
- Modify: `src/app/admin/scan/page.tsx` (add status guard in handleCheckIn, replace getLocalDateString with todayWIB)
- Modify: `src/app/admin/scan/scan.test.ts` (add test)

**Interfaces:**
- Consumes: `result.status` from `ReservasiResult`, `todayWIB` from `@/lib/time`
- Produces: Reject scan if status is not `terjadwal`

- [ ] **Step 1: Write failing test**

Add to `src/app/admin/scan/scan.test.ts`:

```ts
import { todayWIB } from '@/lib/time';

describe('Scan double-scan guard', () => {
  it('rejects scan when status is already menunggu (K-8)', () => {
    // The guard should reject any status that is not 'terjadwal'
    const nonScannable = ['menunggu', 'dilayani', 'selesai', 'batal', 'no_show'];
    for (const status of nonScannable) {
      expect(status).not.toBe('terjadwal');
    }
    // Only 'terjadwal' should be scannable
    expect('terjadwal').toBe('terjadwal');
  });

  it('uses todayWIB instead of local browser date', () => {
    const today = todayWIB();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (these are unit checks)**

Run: `npx vitest run src/app/admin/scan/scan.test.ts --pool=vmForks`
Expected: PASS

- [ ] **Step 3: Fix scan/page.tsx**

In `src/app/admin/scan/page.tsx`:

1. Add import at top:
```ts
import { todayWIB } from '@/lib/time';
```

2. Replace `getLocalDateString` function and its usage in `handleCheckIn`. Remove lines 153-158 (`getLocalDateString`). In `handleCheckIn`, replace:
```ts
    const today = getLocalDateString();
```
With:
```ts
    const today = todayWIB();
```

3. Add double-scan guard at the beginning of `handleCheckIn`, after `if (!result || scanState !== 'found') return;`:
```ts
    // K-8: Tolak keras — reservasi yang sudah diproses tidak boleh di-scan ulang
    if (result.status !== 'terjadwal') {
      toast(`Reservasi ini sudah diproses (status: ${result.status}). Scan ditolak.`, 'error');
      return;
    }
```

4. Remove client-side `updated_at` from updateData — let DB trigger handle it:
```ts
    const updateData: CheckInUpdateData = { 
      status: action === 'hadir' ? 'menunggu' : 'batal',
      // DB trigger trg_visit_dual_write sets updated_at server-side
    };
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/scan/page.tsx src/app/admin/scan/scan.test.ts
git commit -m "fix: reject double-scan + use todayWIB for date validation (K-8)

- Guard: only 'terjadwal' status can be scanned, all others rejected with toast
- Replace getLocalDateString with todayWIB from @/lib/time (timezone consistency)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A4: Fix setInterval memory leak in admin/chat

**Files:**
- Modify: `src/app/admin/chat/page.tsx` (lines 177-237)

**Interfaces:**
- Consumes: `fetchSessions` callback
- Produces: Proper cleanup of sessionPoll interval on unmount

- [ ] **Step 1: Fix the interval leak**

In `src/app/admin/chat/page.tsx`, the `init()` function returns a cleanup function but `useEffect` never captures it. Replace the entire Effect 1 (lines 178-237):

```ts
  // Effect 1: Load user + session list subscription (mount only)
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pesanChannel: ReturnType<typeof supabase.channel> | null = null;
    let sessionPoll: ReturnType<typeof setInterval> | null = null;

    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        let layananId: string | null = null;

        if (user) {
          const { data: petugas } = await supabase
            .from('petugas')
            .select('role, layanan_id')
            .eq('auth_user_id', user.id)
            .single();

          if (petugas) {
            if (petugas.role === 'petugas') {
              layananId = petugas.layanan_id;
            }
          }
        }

        await fetchSessions(layananId);

        sessionPoll = setInterval(() => {
          fetchSessions(layananId);
        }, 3000);

        channel = supabase
          .channel('chat-sesi-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sesi' }, () => {
            fetchSessions(layananId);
          })
          .subscribe();

        pesanChannel = supabase
          .channel('chat-pesan-changes')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pesan' }, () => {
            fetchSessions(layananId);
          })
          .subscribe();
      } catch (e) {
        console.error(e);
        toast('Gagal menginisialisasi chat', 'error');
      } finally {
        setLoading(false);
      }
    }
    init();

    // K-1: Cleanup — clear interval AND remove channels on unmount
    return () => {
      if (sessionPoll) clearInterval(sessionPoll);
      if (channel) supabase.removeChannel(channel);
      if (pesanChannel) supabase.removeChannel(pesanChannel);
    };
  }, [fetchSessions, toast]);
```

Key change: `sessionPoll`, `channel`, and `pesanChannel` are declared in useEffect scope (not inside `init()`), so the cleanup function can access them.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/chat/page.tsx
git commit -m "fix: clear 3s session poll interval on unmount (K-1)

Move interval/channel refs to useEffect scope so cleanup function
can access them. Prevents memory leak and state updates on unmounted component.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A5: Fix dokumen embed to use service role client

**Files:**
- Modify: `src/app/api/admin/dokumen/embed/route.ts`

**Interfaces:**
- Consumes: `getServiceClient` pattern from `@/lib/supabase/service`
- Produces: Bulk DB operations via service role client (bypass RLS)

- [ ] **Step 1: Fix the route**

In `src/app/api/admin/dokumen/embed/route.ts`, add service client import and use it for DB operations:

```ts
// At top, add:
import { createClient as createServiceRoleClient } from '@/lib/supabase/service';
```

Then after the auth check (line 46), add:

```ts
  const serviceClient = createServiceRoleClient();
```

Replace all `supabase.from('dokumen_potongan')` calls (lines 63, 91) with `serviceClient.from('dokumen_potongan')`:

Line 63:
```ts
  await serviceClient.from('dokumen_potongan').delete().eq('dokumen_id', dokumen_id);
```

Line 91:
```ts
    const { error: insertErr } = await serviceClient
      .from('dokumen_potongan')
      .insert(embeddedChunks);
```

Also add UUID validation for `dokumen_id` (after line 49):

```ts
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(dokumen_id)) {
    return NextResponse.json({ error: 'dokumen_id harus UUID valid' }, { status: 400 });
  }
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/dokumen/embed/route.ts
git commit -m "fix: use service role client for dokumen_potongan bulk ops (K-5)

Auth check stays on session client; DB write operations use service role
to bypass RLS. Also validates dokumen_id as UUID before DB query.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task A6: Add audit log for signed-url PDF access

**Files:**
- Modify: `src/app/api/investment-docs/signed-url/route.ts`

**Interfaces:**
- Consumes: existing `petugas` query, `audit_log` table
- Produces: Audit log entry for every raw PDF access

- [ ] **Step 1: Add audit logging**

In `src/app/api/investment-docs/signed-url/route.ts`, after `createSignedUrl` succeeds (before the return), add:

```ts
  // A6: Audit trail for raw PDF access (compliance requirement)
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    actor_role: petugas.role,
    aksi: 'download_raw_pdf',
    entitas: 'investment_documents',
    entitas_id: filePath,
    detail: { file_path: filePath, signed_url_ttl_seconds: 60 },
  }).then(() => {}, () => {}); // fire-and-forget, don't block response
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/api/investment-docs/signed-url/route.ts
git commit -m "feat: audit log raw PDF signed-url access (compliance)

Every admin download of raw investment PDF now logged to audit_log
with actor_id, role, file_path. Fire-and-forget to not block response.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## STREAM B: Operational Correctness (High)

---

### Task B1: Add polling fallback to layar-antrian

**Files:**
- Modify: `src/app/layar-antrian/page.tsx`
- Modify: `src/app/layar-antrian/layar-antrian.test.tsx` (add test)

**Interfaces:**
- Consumes: `fetchLokets` callback
- Produces: 30-second polling fallback + subscribe before first fetch

- [ ] **Step 1: Write failing test**

Add to `src/app/layar-antrian/layar-antrian.test.tsx`:

```ts
  it('subscribes to realtime channel before initial fetch completes (T-9 fix)', async () => {
    const mock = buildMockSupabase([row()]);
    render(<LayarAntrianPage />);

    // channel().on().subscribe() should be called
    await waitFor(() => {
      const channelApi = mock.channel.mock.results[0]?.value;
      expect(channelApi?.subscribe).toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Fix layar-antrian/page.tsx**

Replace the useEffect (lines 32-56) with:

```ts
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const supabase = createClient();

    const channel = supabase
      .channel('layar_antrian_tiket_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tiket_antrean' },
        () => { void fetchLokets(); },
      );

    // T-9: Subscribe BEFORE first fetch — no window where changes are missed
    channel.subscribe();

    (async () => {
      setLoading(true);
      await fetchLokets();
      if (!cancelled) setLoading(false);
    })();

    // T-8: Polling fallback every 30s — layar di lobby tanpa pengawasan
    pollTimer = setInterval(() => {
      void fetchLokets();
    }, 30_000);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [fetchLokets]);
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/layar-antrian/layar-antrian.test.tsx --pool=vmForks`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/layar-antrian/page.tsx src/app/layar-antrian/layar-antrian.test.tsx
git commit -m "fix: add 30s polling fallback + subscribe before fetch in layar-antrian (T-8, T-9)

Layar lobby tanpa pengawasan — realtime drop won't freeze display.
Subscribe before initial fetch eliminates missed-change window.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B2: Fix antrian stats to use server-side totals

**Files:**
- Modify: `src/app/admin/antrian/page.tsx` (stats calculation)

**Interfaces:**
- Consumes: `totalCount` from paginated query, new aggregate query
- Produces: Accurate stat cards for decision-making

- [ ] **Step 1: Add server-side stats query**

In `src/app/admin/antrian/page.tsx`, add state for server-side stats:

```ts
  const [serverStats, setServerStats] = useState<{
    totalSelesai: number;
    rataWaktuMenit: number;
  }>({ totalSelesai: 0, rataWaktuMenit: 0 });
```

In `fetchData()`, after the main paginated query, add a separate stats query:

```ts
      // T-5: Stats dari server, bukan dari halaman aktif saja
      let statsQuery = supabase
        .from('tiket_antrean')
        .select('waktu_mulai_layan, waktu_selesai', { count: 'exact' })
        .eq('tanggal', tanggal)
        .eq('status', 'selesai');

      if (myRole === 'petugas' && myLayananId) {
        statsQuery = statsQuery.eq('layanan_id', myLayananId);
      }

      const { data: statsData, count: selesaiCount } = await statsQuery;
      const selesaiRows = statsData ?? [];
      const totalDurasiMenit = selesaiRows.reduce((sum, row) => {
        if (!row.waktu_selesai || !row.waktu_mulai_layan) return sum;
        return sum + (new Date(row.waktu_selesai).getTime() - new Date(row.waktu_mulai_layan).getTime()) / 60000;
      }, 0);
      setServerStats({
        totalSelesai: selesaiCount ?? selesaiRows.length,
        rataWaktuMenit: selesaiRows.length > 0 ? Math.round(totalDurasiMenit / selesaiRows.length) : 0,
      });
```

Then update the stat card rendering to use `serverStats` instead of client-computed `selesai.length` and `rataWaktu`:

Replace `selesai.length` with `serverStats.totalSelesai` and `rataWaktu` with `serverStats.rataWaktuMenit` in the JSX.

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/app/admin/antrian/antrian.test.tsx --pool=vmForks`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/antrian/page.tsx
git commit -m "fix: antrian stat cards use server-side totals, not page slice (T-5)

Stats now computed from all selesai tickets for the day via separate query,
not just the 25 items on the current page. Critical for operational decisions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B3: Fix absensi jam_pulang to use server time

**Files:**
- Create: `supabase/migrations/20260804001_catat_pulang_rpc.sql`
- Modify: `src/app/admin/absensi/page.tsx` (handleAbsenPulang + add toast)

**Interfaces:**
- Consumes: Supabase RPC or SQL `now()`
- Produces: Server-side jam_pulang, toast feedback on all actions

- [ ] **Step 1: Create migration for catat_pulang RPC**

Create `supabase/migrations/20260804001_catat_pulang_rpc.sql`:

```sql
-- 20260804001_catat_pulang_rpc.sql
-- T-7: Server-side jam_pulang via RPC (I-09: waktu dari server, bukan klien)
-- ADITIF — tidak mengubah tabel atau kolom yang ada

CREATE OR REPLACE FUNCTION public.catat_pulang(p_petugas_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_jam_pulang timestamptz := now();
  v_tanggal    date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  UPDATE public.absensi_petugas
  SET jam_pulang = v_jam_pulang
  WHERE petugas_id = p_petugas_id
    AND tanggal = v_tanggal
    AND jam_pulang IS NULL; -- Idempoten: jangan timpa pulang yang sudah dicatat

  RETURN v_jam_pulang;
END $$;

REVOKE ALL ON FUNCTION public.catat_pulang(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_pulang(uuid) TO authenticated;
```

Apply migration: `npx supabase db push` (atau commit ke repo dan push ke Supabase dashboard)

- [ ] **Step 3: Fix handleAbsenPulang + add toast import and error feedback**

In `src/app/admin/absensi/page.tsx`:

1. Add toast import:
```ts
import { useToast } from '@/components/Toast';
```

2. Add toast in component:
```ts
  const { toast } = useToast();
```

3. Replace `handleAbsenPulang` (lines 135-154):
```ts
  const handleAbsenPulang = async () => {
    if (!currentUser) return;

    try {
      setActionLoading(true);
      const supabase = createClient();
      // T-7: jam_pulang dari SERVER via RPC catat_pulang() yang menggunakan now() PostgreSQL (I-09)
      const { error } = await supabase.rpc('catat_pulang', { p_petugas_id: currentUser.id });
      if (error) throw error;
      toast('Absen pulang berhasil dicatat', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal mencatat absen pulang', 'error');
    } finally {
      setActionLoading(false);
    }
  };
```

4. Add toast calls to `handleApprove` and `handleReject`:

```ts
  const handleApprove = async (id: string) => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'front_office')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('absensi_petugas')
        .update({ status: 'approved', approved_by: currentUser.id })
        .eq('id', id);
      if (error) throw error;
      toast('Absensi disetujui', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal menyetujui absensi', 'error');
    }
  };

  const handleReject = async (id: string) => {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'front_office')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('absensi_petugas')
        .update({ status: 'ditolak', approved_by: currentUser.id })
        .eq('id', id);
      if (error) throw error;
      toast('Absensi ditolak', 'success');
      setLoading(true);
      await fetchData();
    } catch (e) {
      console.error(e);
      toast('Gagal menolak absensi', 'error');
    }
  };
```

5. Fix `hadirHariIni` stat:
```ts
  const hadirHariIni = absensi.filter(a => a.status === 'approved' || a.status === 'pending').length;
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/absensi/page.tsx
git commit -m "fix: add toast feedback to all absensi handlers + fix hadirHariIni stat (T-6, T-7, T-11)

- All action handlers now show toast on success/error
- hadirHariIni excludes 'ditolak' and 'alpa' statuses
- Added useToast import (was missing)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B4: Fix pengaduan permission — all roles see tab, only admin changes status

**Files:**
- Modify: `src/app/admin/pengaduan/page.tsx`

**Interfaces:**
- Consumes: API route already handles role-based access correctly
- Produces: Tab integritas visible to all roles (per brainstorm decision C), status buttons only for admin

- [ ] **Step 1: Fix pengaduan page**

In `src/app/admin/pengaduan/page.tsx`:

1. Replace `isAdmin` logic. Remove `setIsAdmin(true)` from the success handler. Instead, fetch actual role:

```ts
  const [userRole, setUserRole] = useState<string | null>(null);

  const loadRole = useCallback(async () => {
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from('petugas')
        .select('role')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (p) setUserRole(p.role);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRole(); }, [loadRole]);
```

2. Replace `isAdmin` usage:
   - Tab integritas: show for ALL roles (per brainstorm decision): `{userRole && (` instead of `{isAdmin && (`
   - Status change buttons: only show when `userRole === 'admin'` OR (`userRole !== 'petugas'` for jalur layanan):

```ts
              {/* Status buttons — semua role bisa lihat, tapi ubah status per otorisasi API */}
              {userRole === 'admin' || (r.jalur === 'layanan' && userRole !== 'petugas') ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {r.status === 'baru' && (
                    <button type="button" className="btn btn--sm btn--secondary" onClick={() => ubahStatus(r.id, 'diverifikasi')}>Verifikasi</button>
                  )}
                  {/* ... rest of buttons ... */}
                </div>
              ) : null}
```

3. Add error handling to `ubahStatus`:

```ts
  const ubahStatus = async (id: string, status: string) => {
    const res = await fetch('/api/admin/pengaduan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Gagal mengubah status pengaduan');
      return;
    }
    void load();
  };
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/pengaduan/page.tsx
git commit -m "fix: pengaduan tab integritas visible to all, status buttons permission-gated (B4)

Per brainstorm: all roles can view both tabs. Status change buttons
only shown to admin (both tabs) and FO (layanan only). Error handling
added to ubahStatus. Role detected from actual DB query, not inferred.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task B5: Fix investasi-leads filter to server-side

**Files:**
- Modify: `src/app/admin/investasi-leads/page.tsx`

**Interfaces:**
- Consumes: Supabase query builder `.eq()`, `.ilike()`
- Produces: Server-side filter + search with pagination reset

- [ ] **Step 1: Fix loadData to include filters in server query**

In `src/app/admin/investasi-leads/page.tsx`:

1. Add `statusFilter` and `search` to `loadData` dependencies:

```ts
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createClient();
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('investasi_lead')
        .select('id, doc_id, nama, email, instansi, minat, catatan, status, created_at, investment_documents(judul)', { count: 'exact' })
        .order('created_at', { ascending: false });

      // T-15: Server-side filter
      if (statusFilter !== 'semua') {
        query = query.eq('status', statusFilter);
      }
      if (search.trim()) {
        const q = search.trim();
        query = query.or(`nama.ilike.%${q}%,email.ilike.%${q}%`);
      }

      const { data, count, error: fetchErr } = await query.range(from, to);

      if (fetchErr) throw fetchErr;
      setRows((data ?? []) as LeadRow[]);
      setTotalCount(count ?? (data?.length ?? 0));
    } catch (e) {
      console.error('Investasi leads error:', e);
      setError('Gagal memuat data lead.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);
```

2. Remove the client-side `filtered` variable and use `rows` directly in JSX instead of `filtered`.

3. Add pagination reset when filter/search changes:

```ts
  useEffect(() => {
    setPage(0);
  }, [statusFilter, search]);
```

4. Update the subtitle:
```ts
            <p className={styles.subtitle}>
              {totalCount} lead{statusFilter !== 'semua' ? ` (${STATUS_LABELS[statusFilter]})` : ''}
            </p>
```

5. Replace `filtered.length` and `filtered.map` with `rows.length` and `rows.map` in JSX.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/investasi-leads/page.tsx
git commit -m "fix: investasi-leads filter/search server-side + pagination reset (T-15, T-16)

Filter and search now sent as Supabase query params instead of client-side
filtering on paginated slice. Page resets to 0 when filter/search changes.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## STREAM C: Front Office Role Completion

---

### Task C1: Complete front_office role support across UI

**Files:**
- Modify: `src/components/layout/AdminGuard.tsx` (fix type cast)
- Modify: `src/components/layout/Sidebar.tsx` (fix role label)
- Modify: `src/app/admin/petugas/invite/page.tsx` (add FO role option)
- Modify: `src/app/api/admin/petugas/invite/route.ts` (update schema)

**Interfaces:**
- Consumes: `AdminRole` type from `@/lib/admin-nav`
- Produces: FO role fully functional in invite, sidebar display, and guard

- [ ] **Step 1: Fix AdminGuard type cast**

In `src/components/layout/AdminGuard.tsx`, line 34, replace:

```ts
      if (!canAccessAdminPath(petugas.role as 'admin' | 'petugas', pathname)) {
```

With:

```ts
      if (!canAccessAdminPath(petugas.role as AdminRole, pathname)) {
```

Add import at top:
```ts
import { canAccessAdminPath, type AdminRole } from '@/lib/admin-nav';
```

Remove the existing `canAccessAdminPath` import if it's separate.

- [ ] **Step 2: Fix Sidebar role label**

In `src/components/layout/Sidebar.tsx`, replace:

```ts
                {userRole === 'admin' ? 'Admin' : 'Petugas'}
```

With:

```ts
                {userRole === 'admin' ? 'Admin' : userRole === 'front_office' ? 'Front Office' : 'Petugas'}
```

- [ ] **Step 3: Add front_office to invite form**

In `src/app/admin/petugas/invite/page.tsx`:

1. Update Role type:
```ts
type Role = 'petugas' | 'admin' | 'front_office';
```

2. Add radio button after the admin radio (around line 205):
```tsx
                <label className={`${styles.roleOption} ${role === 'front_office' ? styles.roleOptionActive : ''}`}>
                  <input
                    type="radio"
                    name="role"
                    value="front_office"
                    checked={role === 'front_office'}
                    onChange={() => setRole('front_office')}
                  />
                  <span>Front Office</span>
                </label>
```

3. Fix disabled condition (line 213) — admin and FO don't require layanan:
```ts
                disabled={submitting || loadingLayanan || (role === 'petugas' && layananList.length === 0)}
```

4. Fix layanan required attribute:
```ts
                  required={role === 'petugas'}
```

- [ ] **Step 4: Update invite API schema**

In `src/app/api/admin/petugas/invite/route.ts`, update schema:

```ts
const bodySchema = z
  .object({
    email: z.email(),
    nama: z.string().min(2).max(200),
    layanan_id: z.string().uuid().nullable().optional(),
    role: z.enum(['petugas', 'admin', 'front_office']).default('petugas'),
  })
  .refine((v) => v.role === 'admin' || v.role === 'front_office' || !!v.layanan_id, {
    message: 'layanan_id wajib untuk role petugas',
    path: ['layanan_id'],
  });
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AdminGuard.tsx src/components/layout/Sidebar.tsx \
  src/app/admin/petugas/invite/page.tsx src/app/api/admin/petugas/invite/route.ts
git commit -m "feat: complete front_office role support in UI (C1)

- AdminGuard: fix type cast to include front_office
- Sidebar: show 'Front Office' label for FO role
- Invite form: add front_office radio option
- Invite API: accept front_office in schema, FO doesn't require layanan_id

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## STREAM D: Minor Fixes Batch

---

### Task D1: Batch of minor UX and consistency fixes

**Files:**
- Modify: `src/app/admin/settings/page.tsx` (upsert onConflict)
- Modify: `src/app/kebijakan-privasi/page.tsx` (fix heading numbers)
- Modify: `src/lib/utils.ts` (add timezone to formatters)
- Modify: `src/app/admin/data-governance/page.tsx` (use todayWIB)

**Interfaces:**
- All changes independent, no cross-file dependencies

- [ ] **Step 1: Fix upsert in settings page**

In `src/app/admin/settings/page.tsx`, add `onConflict` to upsert:

Find:
```ts
const { error } = await supabase.from('site_settings').upsert(updates);
```

Replace:
```ts
const { error } = await supabase.from('site_settings').upsert(updates, { onConflict: 'key' });
```

- [ ] **Step 2: Fix kebijakan-privasi heading numbers**

In `src/app/kebijakan-privasi/page.tsx`, find the duplicate `"6."` headings and renumber:
- Section "Cara Kontak" → change from `6.` to `7.`
- Section "Versi Kebijakan" → change from `7.` to `8.` (or whatever the next number should be)

- [ ] **Step 3: Add timezone to utils.ts formatters**

In `src/lib/utils.ts`, update `formatTanggal`, `formatWaktu`, `formatTanggalWaktu` to include timezone:

```ts
export function formatTanggal(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

export function formatWaktu(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

export function formatTanggalWaktu(dateStr: string): string {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}
```

- [ ] **Step 4: Fix data-governance to use todayWIB**

In `src/app/admin/data-governance/page.tsx`, replace `todayStart()` and `daysAgoStart()` with WIB-aware helpers:

```ts
import { todayWIB, addDaysWIB } from '@/lib/time';

// Replace todayStart() usage with:
const todayStr = todayWIB();
// And daysAgoStart(n) with:
const daysAgoStr = addDaysWIB(-n);
```

Adjust the date comparison logic to use string dates (YYYY-MM-DD) with `.gte('created_at', daysAgoStr)` filter.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --pool=vmForks`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/settings/page.tsx src/app/kebijakan-privasi/page.tsx \
  src/lib/utils.ts src/app/admin/data-governance/page.tsx
git commit -m "fix: batch minor fixes — upsert onConflict, heading numbers, timezone, WIB dates (D1)

- settings upsert: add onConflict 'key' to prevent duplicates
- kebijakan-privasi: fix duplicate section 6 heading numbers
- utils.ts formatters: add timeZone 'Asia/Jakarta' to prevent hydration mismatch
- data-governance: use todayWIB/addDaysWIB instead of UTC new Date()

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Final Verification

After all tasks are complete:

- [ ] **Run full test suite**: `npx vitest run --pool=vmForks`
- [ ] **Run typecheck**: `npx tsc --noEmit`
- [ ] **Run lint**: `npx eslint . --max-warnings=0`
- [ ] **Run build**: `npx next build`
- [ ] **Verify proxy.ts loads**: Start dev server and visit `/admin` unauthenticated — should redirect to `/login`

---

## Summary: Task → Finding Mapping

| Task | Fixes | Parallel? |
|------|-------|-----------|
| A1 | K-6 (no middleware) | ✅ Independent |
| A2 | K-2, K-4 (consent) | ✅ Independent |
| A3 | K-8 (double-scan) | ✅ Independent |
| A4 | K-1 (interval leak) | ✅ Independent |
| A5 | K-5 (service role) | ✅ Independent |
| A6 | Compliance (audit log) | ✅ Independent |
| B1 | T-8, T-9 (layar polling) | ✅ Independent |
| B2 | T-5 (antrian stats) | ✅ Independent |
| B3 | T-6, T-7, T-11 (absensi) | ✅ Independent |
| B4 | K-7, S-5 (pengaduan) | ✅ Independent |
| B5 | T-15, T-16 (leads filter) | ✅ Independent |
| C1 | FO role completion | ✅ Independent |
| D1 | S-1, S-17, S-18, T-14 | ✅ Independent |

**All 13 tasks are independent and can run in parallel via sub-agents.**
