// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/021_chat_idor_fix.sql',
);

const readMigration = (): string => {
  try {
    return readFileSync(MIGRATION_PATH, 'utf-8');
  } catch {
    return '';
  }
};

describe('K2 migration: 021_chat_idor_fix.sql — file-level assertions', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('adds the pengunjung_id column to chat_sesi', () => {
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+chat_sesi\s+ADD\s+COLUMN\s+pengunjung_id/i,
    );
  });

  it('references pengunjung(id) with ON DELETE SET NULL', () => {
    expect(sql).toMatch(
      /REFERENCES\s+pengunjung\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i,
    );
  });

  it('creates an index on chat_sesi(pengunjung_id)', () => {
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+idx_chat_sesi_pengunjung\s+ON\s+chat_sesi\s*\(\s*pengunjung_id\s*\)/i,
    );
  });

  it('drops the vulnerable chat_sesi_anon_select_own policy', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_sesi_anon_select_own"\s+ON\s+chat_sesi/i,
    );
  });

  it('drops the vulnerable chat_pesan_select policy', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_pesan_select"\s+ON\s+chat_pesan/i,
    );
  });

  it('drops the vulnerable chat_sesi_anon_insert policy', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_sesi_anon_insert"\s+ON\s+chat_sesi/i,
    );
  });

  it('drops the vulnerable chat_pesan_anon_insert policy', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_pesan_anon_insert"\s+ON\s+chat_pesan/i,
    );
  });

  it('drops the old chat_sesi_petugas_update policy (will be recreated)', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_sesi_petugas_update"\s+ON\s+chat_sesi/i,
    );
  });

  it('does NOT contain the vulnerable USING (true) pattern for chat SELECT', () => {
    // The vulnerable pattern was `FOR SELECT USING (true)`.
    // After the fix, no ACTIVE (uncommented) SQL may use FOR SELECT USING (true).
    // We strip SQL line comments (-- ...) so the ROLLBACK documentation block
    // (which references the old vulnerable policy as a comment) is ignored.
    const stripLineComments = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const selectUsingTrue = /FOR\s+SELECT\s+USING\s*\(\s*true\s*\)/i;
    expect(selectUsingTrue.test(stripLineComments)).toBe(false);
  });

  it('enforces ownership via pengunjung.auth_user_id = auth.uid()', () => {
    expect(sql).toMatch(
      /pengunjung_id\s+IN\s+\(\s*SELECT\s+id\s+FROM\s+pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i,
    );
  });

  it('scopes chat_pesan SELECT through the session ownership check', () => {
    expect(sql).toMatch(
      /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+chat_sesi\s+WHERE\s+id\s*=\s*chat_pesan\.sesi_id/i,
    );
  });

  it('allows petugas to INSERT chat_pesan into their own layanan sessions', () => {
    // The INSERT WITH CHECK must include a petugas branch keyed on
    // pengirim = 'petugas' AND layanan_id = get_my_layanan_id().
    expect(sql).toMatch(
      /pengirim\s*=\s*'petugas'\s+AND\s+layanan_id\s*=\s*get_my_layanan_id\s*\(\s*\)/i,
    );
  });

  it('includes a ROLLBACK section', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
  });

  it('has the required header comment', () => {
    expect(sql).toMatch(/Fase 0\s*\/\s*K2/i);
    expect(sql).toMatch(/IDOR/i);
  });
});

// ============================================================
// Component test: PublicChatPage sets pengunjung_id on INSERT
// Verifies the K2 fix in src/app/chat/page.tsx — when a logged-in
// user starts a session, the chat_sesi INSERT payload MUST include
// pengunjung_id (the user's pengunjung row id), so RLS can enforce
// ownership. Before the fix the INSERT omitted any user link.
// ============================================================

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';

type InsertCapture = { table: string; payload: unknown };

const buildMockSupabase = (opts: {
  user: { id: string } | null;
  pengunjung: { id: string; nama: string } | null;
  layanan: { id: string; nama: string; chatbot_aktif: boolean }[];
  sessionResult?: { id: string; status: string } | null;
  insertError?: unknown;
}) => {
  const inserts: InsertCapture[] = [];

  const chainable = (table: string) => {
    const self: Record<string, ReturnType<typeof vi.fn>> = {};
    // Most terminal-ish builders resolve to data; insert captures payload.
    self.select = vi.fn(() => self);
    self.eq = vi.fn(() => self);
    self.neq = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.update = vi.fn(() => self);
    self.in = vi.fn(() => self);
    self.single = vi.fn(async () => {
      if (table === 'pengunjung') {
        return { data: opts.pengunjung, error: null };
      }
      return { data: null, error: null };
    });
    self.maybeSingle = vi.fn(async () => ({ data: null, error: null }));

    // Make `self` thenable so `await supabase.from(table).select(...).order(...)`
    // resolves to a table-appropriate { data, error } for READ paths.
    (self as unknown as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      let result: { data: unknown; error: unknown } = { data: null, error: null };
      if (table === 'layanan') {
        result = { data: opts.layanan, error: null };
      } else if (table === 'faq_knowledge_base') {
        result = { data: [], error: null };
      } else if (table === 'chat_pesan') {
        result = { data: [], error: null };
      }
      return Promise.resolve(result).then(resolve, reject);
    };

    self.insert = vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      // Return a chain that allows .select().single() for chat_sesi start path
      const after: Record<string, ReturnType<typeof vi.fn>> = {};
      after.select = vi.fn(() => after);
      after.single = vi.fn(async () => {
        if (table === 'chat_sesi') {
          if (opts.insertError) {
            return { data: null, error: opts.insertError };
          }
          return {
            data: opts.sessionResult ?? { id: 'sesi-123', status: 'bot' },
            error: null,
          };
        }
        return { data: null, error: null };
      });
      // Also support bare insert().then() (no select) used elsewhere
      (after as unknown as { then: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        Promise.resolve({ error: opts.insertError ?? null }).then(resolve, reject);
      return after;
    });
    // .from() called again on same builder for repeated queries — return chainable
    return self;
  };

  const mock = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user },
        error: null,
      })),
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    },
    from: vi.fn((table: string) => chainable(table)),
    channel: vi.fn(() => {
      const ch: Record<string, ReturnType<typeof vi.fn>> = {};
      ch.on = vi.fn(() => ch);
      ch.subscribe = vi.fn(() => ch);
      ch.unsubscribe = vi.fn();
      return ch;
    }),
    removeChannel: vi.fn(),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock, inserts };
};

describe('K2 chat page: handleStartSession includes pengunjung_id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement Element.scrollIntoView; the chat page calls it
    // in a useEffect when messages change after a session starts.
    if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  it('INSERTs chat_sesi with pengunjung_id when user is logged in', async () => {
    const { inserts } = buildMockSupabase({
      user: { id: 'auth-user-1' },
      pengunjung: { id: 'peng-uuid-9', nama: 'Budi' },
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP', chatbot_aktif: true }],
      sessionResult: { id: 'sesi-123', status: 'bot' },
    });

    render(<PublicChatPage />);

    // Wait for auth + layanan load to settle and the logged-in input to appear.
    await waitFor(() => {
      expect(screen.getByLabelText('Layanan yang Ditanyakan')).toBeInTheDocument();
    });

    // Select a layanan
    fireEvent.change(screen.getByLabelText('Layanan yang Ditanyakan'), {
      target: { value: 'lay-1' },
    });

    // Submit the setup form
    fireEvent.click(screen.getByRole('button', { name: /mulai sesi chat/i }));

    // Assert that a chat_sesi insert was called with pengunjung_id
    await waitFor(() => {
      const sesiInsert = inserts.find((i) => i.table === 'chat_sesi');
      expect(sesiInsert).toBeDefined();
      expect(sesiInsert?.payload).toMatchObject({
        layanan_id: 'lay-1',
        pengunjung_id: 'peng-uuid-9',
        kontak_pengunjung: 'Budi',
        status: 'bot',
      });
    });
  });

  it('does NOT include pengunjung_id when user is anonymous (no pengunjung row yet)', async () => {
    // Guards against accidentally sending pengunjung_id: undefined as a real field.
    const { inserts } = buildMockSupabase({
      user: { id: 'anon-user-1' },
      pengunjung: null, // anon, no pengunjung row yet
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP', chatbot_aktif: true }],
      sessionResult: { id: 'sesi-anon', status: 'bot' },
    });

    render(<PublicChatPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Layanan yang Ditanyakan')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Layanan yang Ditanyakan'), {
      target: { value: 'lay-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /mulai sesi chat/i }));

    await waitFor(() => {
      const sesiInsert = inserts.find((i) => i.table === 'chat_sesi');
      expect(sesiInsert).toBeDefined();
      // pengunjung_id must be absent (not undefined-as-field) when no pengunjung row
      expect(sesiInsert?.payload).not.toHaveProperty('pengunjung_id');
    });
  });
});
