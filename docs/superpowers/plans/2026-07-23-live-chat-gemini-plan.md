# Live Chat Interaktif & Gemini AI Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengupgrade fitur Live Chat LMH menjadi interaktif (typing indicator, quick FAQ chips, rich markdown, notifikasi suara) dengan AI Gemini Auto-Takeover, Officer Copilot, batasan knowledge berbasis Undang-Undang/Perda/SOP, dan multi-layer security.

**Architecture:** RAG berbasis pgvector (`match_faq`), Gemini 1.5 Flash API dengan system instruction strict legal grounding, filter PII & Anti-Prompt Injection, Supabase Realtime & RLS, serta endpoint Copilot Draf Balasan untuk petugas admin.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (pgvector & RLS), `@google/generative-ai`, Lucide Icons, CSS Modules.

## Global Constraints

- Menggunakan Next.js 15 App Router (`src/app/`) dan TypeScript.
- Menjaga keakuratan akun mitra individual (sesuai `AGENTS.md`).
- Menjaga integritas RLS Supabase (pengunjung hanya bisa mengakses sesi miliknya).
- Menjaga ketersediaan fail-closed rate limit (10 panggil AI per 60 detik per pengguna).

---

### Task 1: Strict Legal Grounding & Gemini Prompt Configuration

**Files:**
- Modify: `src/lib/gemini.ts`
- Modify: `src/app/api/chat/ai/route.ts`
- Test: `src/app/api/chat/ai/ai.test.ts`

- [ ] **Step 1: Write unit tests for strict legal grounding in prompt**

Edit `src/app/api/chat/ai/ai.test.ts` to include test assertions verifying system prompt contains scope, legal grounding rules, zero hallucination instruction, and safety settings.

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest src/app/api/chat/ai/ai.test.ts --passWithNoTests`

- [ ] **Step 3: Update `src/lib/gemini.ts`**

Update `getSystemPrompt` and `getChatModel` in `src/lib/gemini.ts` to include strict legal grounding instructions and safety settings (`HarmCategory.HARM_CATEGORY_HARASSMENT`, `HarmCategory.HARM_CATEGORY_HATE_SPEECH`, `HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT`, `HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/app/api/chat/ai/ai.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/gemini.ts src/app/api/chat/ai/ai.test.ts
git commit -m "feat(chat): enforce strict legal grounding and safety settings in Gemini prompt"
```

---

### Task 2: Anti-Prompt Injection & Output PII Sanitization

**Files:**
- Modify: `src/app/api/chat/ai/route.ts`
- Modify: `src/lib/pii.ts`
- Test: `src/app/api/chat/ai/ai.test.ts`

- [ ] **Step 1: Add prompt injection detector helper**

In `src/lib/pii.ts`, implement `detectPromptInjection(text: string): boolean` to detect prompt injection keywords (e.g. "ignore previous instructions", "system prompt", "dan abaikan aturan").

- [ ] **Step 2: Integrate detector and output sanitization in `/api/chat/ai/route.ts`**

If `detectPromptInjection(rawPertanyaan)` is true, return immediate polite refusal / escalation without calling Gemini API. Additionally, run `redactPii` on Gemini's output before returning response.

- [ ] **Step 3: Test prompt injection & PII output sanitization**

Run: `npx jest src/app/api/chat/ai/ai.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/pii.ts src/app/api/chat/ai/route.ts src/app/api/chat/ai/ai.test.ts
git commit -m "security(chat): add anti-prompt injection guard and output PII redaction"
```

---

### Task 3: Officer Copilot Draft API (`/api/chat/ai/draft`)

**Files:**
- Create: `src/app/api/chat/ai/draft/route.ts`
- Create: `src/app/api/chat/ai/draft/draft.test.ts`

- [ ] **Step 1: Create draft API test**

Write tests checking officer authentication, session thread context retrieval, and AI draft generation.

- [ ] **Step 2: Implement `/api/chat/ai/draft/route.ts`**

Accept `sesi_id`, verify officer authorization (`petugas` table check), retrieve last 5 messages, query RAG FAQ matches, call Gemini to generate concise suggested reply for officer.

- [ ] **Step 3: Run draft tests**

Run: `npx jest src/app/api/chat/ai/draft/draft.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/ai/draft/
git commit -m "feat(admin-chat): add Officer Copilot Draft API endpoint"
```

---

### Task 4: Interactive UX Public Chat (`src/app/chat/page.tsx`)

**Files:**
- Modify: `src/app/chat/page.tsx`
- Modify: `src/app/chat/chat.module.css`

- [ ] **Step 1: Implement Typing Indicator & Quick FAQ Chips**

Add state `isBotTyping` showing animated 3-dot pulse when waiting for Gemini API. Render Quick FAQ Chips when service is selected so visitors can tap to ask.

- [ ] **Step 2: Add Web Audio Soft Chime & Rich Text Formatting**

Add audio chime function when new message arrives. Support Markdown formatting for bot messages.

- [ ] **Step 3: Verify build / typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/page.tsx src/app/chat/chat.module.css
git commit -m "feat(chat): implement interactive UI, typing indicator, and quick FAQ chips"
```

---

### Task 5: Admin Panel Copilot Integration & Legal Grounding in FAQ

**Files:**
- Modify: `src/app/admin/chat/page.tsx`
- Modify: `src/app/admin/chat/faq/page.tsx`

- [ ] **Step 1: Add "⚡ Draf Balasan Gemini" Button in Admin Chat Console**

In `src/app/admin/chat/page.tsx`, add a button next to chat input that calls `/api/chat/ai/draft`, showing a loading state and populating input field with Gemini's draft reply.

- [ ] **Step 2: Add Dasar Hukum Field in FAQ Management**

In `src/app/admin/chat/faq/page.tsx`, add an optional input field for `Dasar Hukum / Peraturan / UU` when creating or editing FAQs.

- [ ] **Step 3: Verify build / typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/chat/page.tsx src/app/admin/chat/faq/page.tsx
git commit -m "feat(admin-chat): integrate Gemini Copilot button and legal grounding FAQ fields"
```
