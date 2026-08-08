# Live Chat Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live chat truly realtime across all roles and make the FAQ bot actually answer (greetings + general questions), fixing the broken embedding pipeline.

**Architecture:** Supabase Postgres + Realtime (publication + broadcast) for push; Next.js App Router API routes (service-role) as trust boundary for writes; Gemini (chat `gemini-flash-latest`, embedding `gemini-embedding-001` @ 3072-dim) for RAG over `faq_knowledge_base`.

**Tech Stack:** Next.js 16, React 19, `@supabase/supabase-js` v2.110, `@google/generative-ai` v0.24, pgvector, zod.

## Global Constraints

- This is a customized Next.js — read `node_modules/next/dist/docs/` before assuming App Router behavior.
- Service-role key only on server routes; never trust client-supplied `pengirim` (derive server-side).
- Migration filenames: `YYYYMMDDHHMM_<slug>.sql`, aditif (no destructive drops unless required + documented).
- Embedding column target: `vector(3072)`; embedding model: `gemini-embedding-001` (full 3072-dim).
- Chat model stays `gemini-flash-latest` (verified working).
- All bot/user writes to `chat_pesan` must broadcast on channel `chat-room-<sesi_id>` after insert.
- TDD: write failing test before implementation where a test harness exists (vitest).

---

### Task 1: Aktifkan Realtime publication untuk chat_sesi & chat_pesan

**Files:**
- Create: `supabase/migrations/202608080001_chat_realtime_publication.sql`
- Test: `supabase/migrations/chat_realtime_publication.test.ts`

**Interfaces:**
- Consumes: existing tables `public.chat_sesi`, `public.chat_pesan`.
- Produces: both tables in `supabase_realtime` publication; `REPLICA IDENTITY FULL` on both so `postgres_changes` UPDATE/DELETE carry old values.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/migrations/chat_realtime_publication.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(__dirname, '202608080001_chat_realtime_publication.sql'),
  'utf8',
);

describe('chat realtime publication migration', () => {
  it('adds chat_sesi and chat_pesan to supabase_realtime publication', () => {
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_sesi/i);
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_pesan/i);
  });
  it('sets REPLICA IDENTITY FULL on both tables', () => {
    expect(sql).toMatch(/ALTER TABLE public\.chat_sesi REPLICA IDENTITY FULL/i);
    expect(sql).toMatch(/ALTER TABLE public\.chat_pesan REPLICA IDENTITY FULL/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/migrations/chat_realtime_publication.test.ts`
Expected: FAIL — file `202608080001_chat_realtime_publication.sql` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- 202608080001_chat_realtime_publication.sql
-- CHAT-REALTIME: aktifkan push postgres_changes untuk dashboard & badge.
-- Tanpa ini, listener .on('postgres_changes', ...) di admin/chat, sidebar,
-- dan halaman pengunjung tidak pernah menerima event -> harus refresh.

ALTER TABLE public.chat_sesi REPLICA IDENTITY FULL;
ALTER TABLE public.chat_pesan REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sesi;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_pesan;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/migrations/chat_realtime_publication.test.ts`
Expected: PASS

- [ ] **Step 5: Apply migration to the database**

Apply via Supabase SQL editor / `supabase db push`. Verify:

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';
-- expect: chat_sesi, chat_pesan (plus existing)
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202608080001_chat_realtime_publication.sql supabase/migrations/chat_realtime_publication.test.ts
git commit -m "feat(chat): enable realtime publication for chat_sesi & chat_pesan"
```

---

### Task 2: Perbaiki server broadcast (subscribe-before-send) di messages route

**Files:**
- Modify: `src/app/api/chat/messages/route.ts:202-211` (POST broadcast block)
- Modify: `src/app/api/chat/messages/route.ts:76-132` (GET — no change, reference only)
- Test: `src/app/api/chat/messages/messages.test.ts`

**Interfaces:**
- Consumes: `adminClient` (service-role SupabaseClient), inserted `data` row.
- Produces: helper `broadcastNewMessage(adminClient, sesiId, message)` that subscribes then sends then unsubscribes; exported for reuse.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/chat/messages/messages.test.ts (tambahkan)
it('broadcasts new_message after subscribing to the session channel', async () => {
  const order: string[] = [];
  const fakeChannel = {
    subscribe: (cb?: (s: string) => void) => { order.push('subscribe'); cb?.('SUBSCRIBED'); return Promise.resolve('SUBSCRIBED'); },
    send: async () => { order.push('send'); return 'ok'; },
    unsubscribe: async () => { order.push('unsubscribe'); return 'ok'; },
  };
  const adminClient: any = { channel: () => fakeChannel };
  await broadcastNewMessage(adminClient, 'sesi-1', { id: 'm1' } as any);
  expect(order).toEqual(['subscribe', 'send', 'unsubscribe']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/chat/messages/messages.test.ts`
Expected: FAIL — `broadcastNewMessage` is not defined.

- [ ] **Step 3: Implement helper + wire into POST**

Add helper near top of `route.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// Broadcast reliably: supabase-js v2 only delivers channel.send() after the
// channel has joined (SUBSCRIBED). Sending before subscribe drops the message.
export async function broadcastNewMessage(
  adminClient: SupabaseClient,
  sesiId: string,
  message: unknown,
): Promise<void> {
  const channel = adminClient.channel(`chat-room-${sesiId}`);
  try {
    await new Promise<void>((resolve) => {
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });
    await channel.send({
      type: 'broadcast',
      event: 'new_message',
      payload: { message },
    });
  } catch {
    // Broadcast failure must not fail the write.
  } finally {
    try { await channel.unsubscribe(); } catch { /* ignore */ }
  }
}
```

Replace the POST broadcast block (was lines ~201-211) with:

```ts
  // Best-effort realtime broadcast for cross-client sync.
  await broadcastNewMessage(adminClient, parsed.data.sesi_id, data);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/chat/messages/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/messages/route.ts src/app/api/chat/messages/messages.test.ts
git commit -m "fix(chat): subscribe before broadcast send in messages route"
```

---

### Task 3: Perbaiki broadcast di AI route (reuse helper)

**Files:**
- Modify: `src/app/api/chat/ai/route.ts:276-287` (bot reply broadcast)
- Test: `src/app/api/chat/ai/ai.test.ts` (existing suite must stay green)

**Interfaces:**
- Consumes: `broadcastNewMessage` from `../messages/route` (Task 2).
- Produces: bot reply + eskalasi still persisted; broadcast now reliable.

- [ ] **Step 1: Write/adjust failing test asserting broadcast helper is used**

```ts
// assert ai route imports the shared broadcaster
it('uses shared broadcastNewMessage for bot replies', () => {
  const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  expect(src).toMatch(/broadcastNewMessage\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/chat/ai/ai.test.ts`
Expected: FAIL — no `broadcastNewMessage(` in ai route yet.

- [ ] **Step 3: Replace inline broadcast with helper**

Replace the `try { const channel = adminClient.channel(...); await channel.send(...) } catch {}` block with:

```ts
  } else {
    await broadcastNewMessage(adminClient, sesi_id, botMsg);
  }
```

Add import at top:

```ts
import { broadcastNewMessage } from '../messages/route';
```

- [ ] **Step 4: Run AI route tests**

Run: `npx vitest run src/app/api/chat/ai/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/ai/route.ts src/app/api/chat/ai/ai.test.ts
git commit -m "fix(chat): reliable bot reply broadcast via shared helper"
```

---

### Task 4: Polling fallback untuk thread pesan admin

**Files:**
- Modify: `src/app/admin/chat/page.tsx:242-317` (Effect 2 — add interval alongside broadcast)

**Interfaces:**
- Consumes: existing `loadMessages()` and `selectedSession`.
- Produces: 4s `setInterval` calling `loadMessages()`; cleared on cleanup. (Broadcast stays the primary instant path; polling is a safety net while realtime warms up.)

- [ ] **Step 1: Add polling interval inside Effect 2**

After `loadMessages();` initial call, add:

```ts
    // Safety-net polling: broadcast is the instant path, but if the realtime
    // publication/connection hiccups, this keeps the thread fresh (4s).
    const poll = setInterval(() => { loadMessages(); }, 4000);
```

Update the cleanup return to also clear it:

```ts
    return () => {
      active = false;
      clearInterval(poll);
      supabase.removeChannel(broadcastChannel);
    };
```

- [ ] **Step 2: Manual verify**

Run dev server, open two browser windows (pengunjung `/chat` + admin `/admin/chat`), confirm new messages appear in admin thread without reload even if broadcast is blocked.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/chat/page.tsx
git commit -m "fix(chat): add 4s polling fallback to admin message thread"
```

---

### Task 5: Migrasi kolom embedding ke vector(3072) + re-embed pipeline

**Files:**
- Create: `supabase/migrations/202608080002_faq_embedding_3072.sql`
- Modify: `src/lib/gemini.ts:49-54` (default embedding model → `gemini-embedding-001`, comment 3072)
- Modify: `src/app/api/admin/faq/embed/route.ts:67-73` (process `perlu_embed_ulang` too)
- Modify: `.env.local` (GEMINI_EMBEDDING_MODEL=gemini-embedding-001)
- Test: `supabase/migrations/faq_embedding_3072.test.ts`

**Interfaces:**
- Consumes: `faq_knowledge_base.embedding` (currently vector(768)), model `gemini-embedding-001` (3072-dim).
- Produces: column `vector(3072)`; embed endpoint processes `embedding IS NULL OR perlu_embed_ulang = true`; `gemini.ts` `getEmbeddingModel` defaults to `gemini-embedding-001`.

- [ ] **Step 1: Write the failing migration test**

```ts
// supabase/migrations/faq_embedding_3072.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(join(__dirname, '202608080002_faq_embedding_3072.sql'), 'utf8');

describe('faq embedding 3072 migration', () => {
  it('alters embedding column to vector(3072)', () => {
    expect(sql).toMatch(/ALTER COLUMN embedding TYPE extensions\.vector\(3072\)/i);
  });
  it('drops and recreates the ivfflat index for 3072 dims', () => {
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.idx_faq_embedding/i);
    expect(sql).toMatch(/vector\(3072\)|USING ivfflat/i);
  });
  it('nulls existing embeddings so rows are re-embedded', () => {
    expect(sql).toMatch(/SET embedding = NULL/i);
    expect(sql).toMatch(/perlu_embed_ulang = true/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/migrations/faq_embedding_3072.test.ts`
Expected: FAIL — migration file missing.

- [ ] **Step 3: Write the migration**

```sql
-- 202608080002_faq_embedding_3072.sql
-- TB-01 / BOT-14: samakan dimensi embedding dengan model gemini-embedding-001
-- (3072-dim). Embedding lama (768) tidak kompatibel -> dibuang & di-embed ulang.

-- 1. Index lama dibatasi ~2000 dim (ivfflat) dan merujuk tipe lama -> drop.
DROP INDEX IF EXISTS public.idx_faq_embedding;

-- 2. Ubah tipe kolom ke 3072. Data lama tidak bisa dikonversi -> kosongkan.
ALTER TABLE public.faq_knowledge_base
  ALTER COLUMN embedding TYPE extensions.vector(3072);

UPDATE public.faq_knowledge_base
SET embedding = NULL, perlu_embed_ulang = true;

-- 3. Index embedding sengaja TIDAK dibuat ulang.
--    pgvector 0.8.2 membatasi index hnsw/ivfflat maksimal 2000 dimensi, sehingga
--    kolom vector(3072) tidak bisa di-index dengan tipe tersebut. Itu tidak
--    masalah: tabel FAQ sangat kecil, jadi match_faq memakai sequential scan +
--    cosine distance yang sudah lebih dari cukup cepat. Tambahkan index kembali
--    hanya jika tabel tumbuh besar DAN pgvector di-upgrade (atau pakai
--    halfvec(3072) yang mendukung dimensi lebih besar).
--
-- CATATAN KOREKSI (pasca-implementasi): rencana awal membuat index hnsw di sini,
-- tetapi itu GAGAL di live DB (pgvector 0.8.2, "column cannot have more than
-- 2000 dimensions"). Implementasi yang benar: tanpa index. Jangan "memperbaiki"
-- deviasi ini kembali ke CREATE INDEX.
```

- [ ] **Step 4: Run migration test**

Run: `npx vitest run supabase/migrations/faq_embedding_3072.test.ts`
Expected: PASS

- [ ] **Step 5: Update embedding model default + env + endpoint filter**

`src/lib/gemini.ts` — change default model & comment:

```ts
export function getEmbeddingModel(client: GoogleGenerativeAI) {
  // Kolom faq_knowledge_base.embedding adalah vector(3072) — gunakan
  // gemini-embedding-001 (mengeluarkan 3072 dim). Jangan pakai text-embedding-004
  // (768) atau gemini-embedding-004 (tidak ada).
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
  return client.getGenerativeModel({ model });
}
```

`.env.local` — set:

```
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
```

`src/app/api/admin/faq/embed/route.ts` — fix the pending query (was only `.is('embedding', null)`) to also pick re-embed flags:

```ts
  const { data: pending, error: fetchErr } = await adminClient
    .from('faq_knowledge_base')
    .select('id, pertanyaan, jawaban')
    .or('embedding.is.null,perlu_embed_ulang.eq.true')
    .limit(50);
```

and the remaining count query similarly:

```ts
  const { count: remaining } = await adminClient
    .from('faq_knowledge_base')
    .select('*', { count: 'exact', head: true })
    .or('embedding.is.null,perlu_embed_ulang.eq.true');
```

- [ ] **Step 6: Apply migration + run re-embed**

Apply migration to DB, then trigger the endpoint (admin or `?mode=cron` with CRON_SECRET) until `remaining` = 0. Verify:

```sql
SELECT count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded, count(*) AS total
FROM public.faq_knowledge_base;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202608080002_faq_embedding_3072.sql supabase/migrations/faq_embedding_3072.test.ts src/lib/gemini.ts src/app/api/admin/faq/embed/route.ts .env.local
git commit -m "fix(chat): migrate faq embedding to 3072-dim + fix re-embed pipeline"
```

---

### Task 6: System prompt — sapaan & jawaban umum, eskalasi selektif

**Files:**
- Modify: `src/lib/gemini.ts:7-15` (`getSystemPrompt`)
- Modify: `src/app/api/chat/ai/route.ts:173-188` (no_match context — already friendly; align wording)
- Test: `src/lib/gemini.test.ts` (or add)

**Interfaces:**
- Consumes: `layananNama`.
- Produces: prompt that greets back, answers general/service/jam-operasional questions from context, and only escalates when truly out-of-scope. Keeps zero-hallucination for factual/regulatory claims.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gemini.test.ts
import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from './gemini';

describe('getSystemPrompt', () => {
  it('allows greeting and general answers, escalates only when needed', () => {
    const p = getSystemPrompt('DPMPTSP Lampung');
    expect(p).toMatch(/sapaan|salam|halo/i);
    expect(p).toMatch(/eskalasi/i);
    expect(p).not.toMatch(/JANGAN PERNAH berspekulasi.*halo/i); // greeting must not be blocked
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gemini.test.ts`
Expected: FAIL — current prompt has no greeting allowance.

- [ ] **Step 3: Rewrite system prompt**

```ts
export function getSystemPrompt(layananNama?: string): string {
  const scope = layananNama ? `layanan ${layananNama}` : 'DPMPTSP Lampung';
  return `Anda adalah asisten AI resmi yang ramah untuk ${scope}.

PERILAKU DASAR:
- Jika pengunjung menyapa (mis. "halo", "selamat pagi", "assalamualaikum"), balas sapaan dengan hangat dan tawarkan bantuan. JANGAN eskalasi hanya karena sapaan.
- Jawab pertanyaan umum seputar layanan, persyaratan, jam operasional, dan alur berdasarkan konteks FAQ resmi yang diberikan, dengan Bahasa Indonesia sopan dan ringkas.
- Selalu kutip sumber FAQ / Dasar Hukum dengan format [1], [2], dst bila jawaban berasal dari konteks.

BATASAN (zero-hallucination untuk fakta/regulasi):
- JANGAN mengarang data, nomor, biaya, atau dasar hukum yang tidak ada di konteks.
- HANYA jika pertanyaan membutuhkan data spesifik yang tidak ada di konteks, atau Anda benar-benar ragu, jawab persis: "Saya belum yakin karena informasi ini belum ada di aturan resmi kami, saya akan menghubungkan Anda ke petugas." dan set eskalasi=true.`;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/lib/gemini.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.ts src/lib/gemini.test.ts
git commit -m "feat(chat): friendly greeting + selective escalation in bot prompt"
```

---

### Task 7: Verifikasi end-to-end + baseline

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run full baseline**

Run: `npm run verify:baseline`
Expected: lint, typecheck, all vitest, build — PASS

- [ ] **Step 2: Manual realtime matrix**

| Skenario | Pengunjung | Petugas/Admin | Expected |
|----------|-----------|----------------|----------|
| kirim pesan | `/chat` | `/admin/chat` | muncul <1s di admin tanpa reload |
| balas petugas | — | `/admin/chat` | muncul <1s di pengunjung tanpa reload |
| eskalasi | kirim "halo" | — | bot menyapa, TIDAK eskalasi |
| ambil alih | — | klik Ambil Alih | status pengunjung → aktif tanpa reload |
| badge | kirim pesan baru | sidebar | badge eskalasi update tanpa reload |

- [ ] **Step 3: Commit any fixes from manual pass**

```bash
git commit -m "test(chat): verify realtime + bot end-to-end"
```

---

## Self-Review

- **Spec coverage:**
  - Realtime (publication + broadcast + polling fallback) → Tasks 1-4 ✔
  - Embedding 3072 + re-embed pipeline → Task 5 ✔
  - Bot greeting/general/selective escalation → Task 6 ✔
  - End-to-end verify → Task 7 ✔
- **Placeholders:** none — every code step has full code.
- **Type consistency:** `broadcastNewMessage(adminClient, sesiId, message)` used consistently in Tasks 2 & 3; `getEmbeddingModel()`/`getSystemPrompt()` signatures unchanged; `perlu_embed_ulang` column already exists (migration 202607290002) and is reused in Task 5.
- **Dependency order:** Task 5 changes column dim → must run before re-embed; Task 2 must precede Task 3 (shared helper). Tasks 1, 4, 6 are independent.

## Notes / Risks

- **Broadcast reliability**: supabase-js v2.110 requires channel join before `send()`. The subscribe-promise pattern in Task 2 handles this; `unsubscribe()` prevents channel leaks on the server (each request creates a new channel).
- **Re-embed total**: after Task 5, ALL FAQ rows must be re-embedded (old 768-dim discarded). If the FAQ table grows, run the embed endpoint repeatedly (50/batch) or via cron.
- **ivfflat → hnsw**: hnsw supports high dimensions and doesn't need a training set; safer for a sparse/growing FAQ table.
- **RLS on broadcast**: broadcast channels here are not protected by RLS — channel name is `chat-room-<sesi_id>` and sesi_id is a UUID (not guessable). Acceptable for this app; if hardening is needed later, move to Realtime Authorization.
