// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/202607140004_security_and_automation.sql',
);

const readMigration = (): string => {
  try {
    return readFileSync(MIGRATION_PATH, 'utf-8');
  } catch {
    return '';
  }
};

const OWNER_CHECK = String.raw`pengunjung_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+(?:public\.)?pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)`;
const SERVICE_CHECK = String.raw`layanan_id\s*=\s*(?:public\.)?get_my_layanan_id\s*\(\s*\)`;
const ADMIN_CHECK = String.raw`(?:public\.)?get_my_role\s*\(\s*\)\s*=\s*'admin'`;

const CHAT_SELECT_POLICIES = [
  {
    name: 'chat_sesi_owner_select',
    table: '(?:public\\.)?chat_sesi',
    usingPattern: new RegExp(
      `^\\s*${OWNER_CHECK}\\s+OR\\s+${SERVICE_CHECK}\\s+OR\\s+${ADMIN_CHECK}\\s*$`,
      'i',
    ),
  },
  {
    name: 'chat_pesan_owner_select',
    table: '(?:public\\.)?chat_pesan',
    usingPattern: new RegExp(
      `^\\s*EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+(?:public\\.)?chat_sesi\\s+WHERE\\s+id\\s*=\\s*chat_pesan\\.sesi_id\\s+AND\\s*\\(\\s*${OWNER_CHECK}\\s+OR\\s+${SERVICE_CHECK}\\s+OR\\s+${ADMIN_CHECK}\\s*\\)\\s*\\)\\s*$`,
      'i',
    ),
  },
] as const;

function stripSqlComments(sql: string) {
  let result = '';
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        result += char;
      }
    } else if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i++;
      }
    } else if (quote) {
      result += char;
      if (char === quote && next === quote) {
        result += next;
        i++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      result += char;
    } else if (char === '-' && next === '-') {
      lineComment = true;
      i++;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      i++;
    } else {
      result += char;
    }
  }

  return result;
}

function extractFinalActivePolicy(sql: string, name: string, table: string) {
  const activeSql = stripSqlComments(sql);
  const matches = activeSql.matchAll(
    new RegExp(
      `CREATE\\s+POLICY\\s+"${name}"\\s+ON\\s+${table}[\\s\\S]*?;`,
      'gi',
    ),
  );
  return Array.from(matches).at(-1)?.[0];
}

function extractUsingExpression(statement: string) {
  const clause = /\bUSING\s*\(/i.exec(statement);
  if (!clause) return undefined;

  const start = clause.index + clause[0].length;
  let depth = 1;
  for (let i = start; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    if (statement[i] === ')' && --depth === 0) return statement.slice(start, i);
  }
  return undefined;
}

function isSecureChatSelectPolicy(
  sql: string,
  policy: (typeof CHAT_SELECT_POLICIES)[number],
) {
  const statement = extractFinalActivePolicy(sql, policy.name, policy.table);
  const usingExpression = statement && extractUsingExpression(statement);
  return Boolean(
    statement &&
    usingExpression &&
    /FOR\s+SELECT\s+TO\s+authenticated/i.test(statement) &&
    !/\btrue\b/i.test(usingExpression) &&
    policy.usingPattern.test(usingExpression),
  );
}

describe('final chat RLS baseline contract', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('does NOT contain the vulnerable USING (true) pattern for chat SELECT', () => {
    for (const policy of CHAT_SELECT_POLICIES) {
      expect(isSecureChatSelectPolicy(sql, policy)).toBe(true);
    }
  });

  it('rejects true OR ownership_check in a chat SELECT policy', () => {
    const insecureSql = `
      CREATE POLICY "chat_sesi_owner_select" ON chat_sesi
        FOR SELECT TO authenticated
        USING (
          pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
          OR layanan_id = get_my_layanan_id()
          OR get_my_role() = 'admin'
        );
      CREATE POLICY "chat_sesi_owner_select" ON chat_sesi
        FOR SELECT TO authenticated
        USING (
          true OR
          pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
          OR layanan_id = get_my_layanan_id()
          OR get_my_role() = 'admin'
        );
    `;

    expect(isSecureChatSelectPolicy(insecureSql, CHAT_SELECT_POLICIES[0])).toBe(false);
  });

  it('ignores commented policy SQL when selecting the active statement', () => {
    const sqlWithCommentedPolicy = `
      /* CREATE POLICY "chat_sesi_owner_select" ON chat_sesi
         FOR SELECT USING (true); */
      CREATE POLICY "chat_sesi_owner_select" ON chat_sesi
        FOR SELECT TO authenticated
        USING (
          pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
          OR layanan_id = get_my_layanan_id()
          OR get_my_role() = 'admin'
        );
    `;

    expect(
      isSecureChatSelectPolicy(sqlWithCommentedPolicy, CHAT_SELECT_POLICIES[0]),
    ).toBe(true);
  });

  it('enforces ownership via pengunjung.auth_user_id = auth.uid()', () => {
    expect(sql).toMatch(
      /pengunjung_id\s+IN\s+\(\s*SELECT\s+id\s+FROM\s+(?:public\.)?pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i,
    );
  });

  it('scopes chat_pesan SELECT through the session ownership check', () => {
    expect(sql).toMatch(
      /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(?:public\.)?chat_sesi\s+WHERE\s+id\s*=\s*chat_pesan\.sesi_id/i,
    );
  });

  it('allows petugas to INSERT chat_pesan into their own layanan sessions', () => {
    // The INSERT WITH CHECK must include a petugas branch keyed on
    // pengirim = 'petugas' AND layanan_id = get_my_layanan_id().
    expect(sql).toMatch(
      /pengirim\s*=\s*'petugas'\s+AND\s+layanan_id\s*=\s*(?:public\.)?get_my_layanan_id\s*\(\s*\)/i,
    );
  });

  it('contains no historical policy drop/recreate cycle', () => {
    expect(stripSqlComments(sql)).not.toMatch(/DROP\s+POLICY/i);
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

  afterEach(() => {
    // I8: cleanup DOM between tests — consent checkbox now adds a 2nd form
    // instance if previous render is not torn down (causes "multiple elements"
    // errors in getByRole queries).
    cleanup();
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

    // I8: tick the PDP consent checkbox (required to enable the submit button)
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));

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

    // I8: tick the PDP consent checkbox (required to enable the submit button)
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));

    fireEvent.click(screen.getByRole('button', { name: /mulai sesi chat/i }));

    await waitFor(() => {
      const sesiInsert = inserts.find((i) => i.table === 'chat_sesi');
      expect(sesiInsert).toBeDefined();
      // pengunjung_id must be absent (not undefined-as-field) when no pengunjung row
      expect(sesiInsert?.payload).not.toHaveProperty('pengunjung_id');
    });
  });
});
