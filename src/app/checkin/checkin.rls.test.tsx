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

function extractWithCheckExpression(statement: string) {
  const clause = /\bWITH\s+CHECK\s*\(/i.exec(statement);
  if (!clause) return undefined;

  const start = clause.index + clause[0].length;
  let depth = 1;
  for (let i = start; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    if (statement[i] === ')' && --depth === 0) return statement.slice(start, i);
  }
  return undefined;
}

function isSecureVisitInsertPolicy(sql: string) {
  const statement = extractFinalActivePolicy(
    sql,
    'visit_insert_walk_in',
    'public.visit',
  );
  const withCheck = statement && extractWithCheckExpression(statement);
  return Boolean(
    statement &&
    withCheck &&
    /FOR\s+INSERT\s+TO\s+authenticated/i.test(statement) &&
    !/\btrue\b/i.test(withCheck) &&
    /^\s*asal\s*=\s*'walk_in'\s+AND\s*\(\s*public\.get_my_role\s*\(\s*\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)\s+OR\s+public\.check_anon_rate\s*\(\s*'visit_insert_walk_in'\s*,\s*5\s*,\s*60\s*\)\s*\)\s*$/i.test(withCheck),
  );
}

describe('final check-in RLS baseline contract', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines the check_anon_rate function', () => {
    expect(sql).toMatch(/CREATE\s+FUNCTION\s+public\.check_anon_rate/i);
  });

  it('defines the log_anon_action trigger function', () => {
    expect(sql).toMatch(/CREATE\s+FUNCTION\s+public\.log_anon_action/i);
  });

  it('revokes direct client access to anon_rate_limit', () => {
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.anon_rate_limit\s+FROM\s+anon\s*,\s*authenticated/i,
    );
  });

  it('creates final visit walk-in policy with check_anon_rate', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+public\.visit/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'visit_insert_walk_in'\s*,\s*5\s*,\s*60\s*\)/i);
  });

  it('recreates chat_sesi_owner_insert WITH check_anon_rate (3/60s)', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_sesi_owner_insert"\s+ON\s+public\.chat_sesi/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_sesi_insert'\s*,\s*3\s*,\s*60\s*\)/i);
  });

  it('recreates chat_pesan_owner_insert WITH check_anon_rate (20/60s)', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_pesan_owner_insert"\s+ON\s+public\.chat_pesan/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_pesan_insert'\s*,\s*20\s*,\s*60\s*\)/i);
  });

  it('exempts petugas/admin from rate limiting in public-write policies', () => {
    // Each WITH CHECK must include get_my_role() IN ('petugas','admin')
    // Strip line comments so the ROLLBACK section is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    // Visit, chat session, chat message, lead, and UMKM inquiry policies use this exemption.
    const matches = stripped.match(
      /get_my_role\s*\(\s*\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)/gi,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('creates final AFTER INSERT accounting triggers', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_visit_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_sesi_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_pesan_insert/i);
  });

  it('does NOT contain WITH CHECK (true) for visit INSERT (active SQL)', () => {
    expect(isSecureVisitInsertPolicy(sql)).toBe(true);
  });

  it('rejects true OR check_anon_rate in the kunjungan INSERT policy', () => {
    const insecureSql = `
      CREATE POLICY "visit_insert_walk_in" ON public.visit
        FOR INSERT TO authenticated
        WITH CHECK (
          asal = 'walk_in' AND (public.get_my_role() IN ('petugas', 'admin')
          OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
        );
      CREATE POLICY "visit_insert_walk_in" ON public.visit
        FOR INSERT TO authenticated
        WITH CHECK (
          true OR public.check_anon_rate('visit_insert_walk_in', 5, 60)
        );
    `;

    expect(isSecureVisitInsertPolicy(insecureSql)).toBe(false);
  });

  it('scopes visit INSERT to authenticated', () => {
    // Strip comments so ROLLBACK block is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const policyBlock = stripped.match(
      /CREATE\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+public\.visit\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(policyBlock).not.toBeNull();
  });

  it('contains no historical policy drop/recreate cycle', () => {
    expect(stripSqlComments(sql)).not.toMatch(/DROP\s+POLICY/i);
  });
});

// ============================================================
// Component tests: CheckinPage auth gate
// Verifies src/app/checkin/page.tsx requires a user before showing
// the form. If getUser() returns no user AND signInAnonymously()
// throws (anon sign-in disabled), renders fallback UI with Google
// login + retry. If a user is present, renders the form.
// ============================================================

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import CheckinPage from './page';
import { createClient } from '@/lib/supabase/client';

type InsertCapture = { table: string; payload: unknown };

const buildMockSupabase = (opts: {
  user: { id: string } | null;
  anonThrows?: boolean;
  anonUser?: { id: string } | null;
  layanan?: { id: string; nama: string }[];
}) => {
  const inserts: InsertCapture[] = [];

  const chainable = (table: string) => {
    const self: Record<string, ReturnType<typeof vi.fn>> = {};
    self.select = vi.fn(() => self);
    self.neq = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.insert = vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      const after: Record<string, ReturnType<typeof vi.fn>> = {};
      (after as unknown as { then: unknown }).then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        Promise.resolve({ error: null }).then(resolve, reject);
      return after;
    });
    (self as unknown as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      let result = { data: null as unknown, error: null };
      if (table === 'layanan') {
        result = { data: opts.layanan ?? [], error: null };
      }
      return Promise.resolve(result).then(resolve, reject);
    };
    return self;
  };

  const mock = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user },
        error: null,
      })),
      signInAnonymously: vi.fn(async () => {
        if (opts.anonThrows) {
          throw new Error('Anonymous sign-ins are disabled');
        }
        return {
          data: { user: opts.anonUser ?? null },
          error: opts.anonUser ? null : { message: 'disabled' },
        };
      }),
    },
    from: vi.fn((table: string) => chainable(table)),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock, inserts };
};

describe('K3 checkin page: auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders fallback UI (Google login + retry) when no user and anon sign-in throws', async () => {
    buildMockSupabase({
      user: null,
      anonThrows: true,
    });

    render(<CheckinPage />);

    // Fallback message + Google login + retry button
    await waitFor(() => {
      expect(screen.getByText(/silakan login atau coba lagi nanti/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /login dengan google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
  });

  it('renders fallback UI when anon sign-in returns no user (disabled, no throw)', async () => {
    buildMockSupabase({
      user: null,
      anonUser: null,
    });

    render(<CheckinPage />);

    await waitFor(() => {
      expect(screen.getByText(/silakan login atau coba lagi nanti/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /login dengan google/i })).toBeInTheDocument();
  });

  it('renders the check-in form when a user is already present (Google auth)', async () => {
    buildMockSupabase({
      user: { id: 'google-user-1' },
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP' }],
    });

    render(<CheckinPage />);

    // Form fields should appear once authed
    await waitFor(() => {
      expect(screen.getByLabelText(/nama lengkap/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/layanan tujuan/i)).toBeInTheDocument();
  });

  it('renders the check-in form after successful anon sign-in', async () => {
    buildMockSupabase({
      user: null,
      anonUser: { id: 'anon-user-1' },
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP' }],
    });

    render(<CheckinPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/nama lengkap/i)).toBeInTheDocument();
    });
  });

  it('retry button re-attempts auth', async () => {
    const { mock } = buildMockSupabase({
      user: null,
      anonThrows: true,
    });

    render(<CheckinPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
    });

    const initialCalls = mock.auth.getUser.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));

    await waitFor(() => {
      expect(mock.auth.getUser.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  // I1.b: verify the check-in INSERT now targets the visit spine with asal='walk_in'
  it('inserts into visit with asal=walk_in on submit', async () => {
    const { inserts } = buildMockSupabase({
      user: { id: 'google-user-2' },
      layanan: [{ id: 'lay-1', nama: 'DPMPTSP' }],
    });

    render(<CheckinPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/nama lengkap/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/nama lengkap/i), {
      target: { value: 'Budi Santoso' },
    });
    fireEvent.change(screen.getByLabelText(/layanan tujuan/i), {
      target: { value: 'lay-1' },
    });
    fireEvent.change(screen.getByLabelText(/keperluan/i), {
      target: { value: 'Persuratan' },
    });
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));

    fireEvent.click(screen.getByRole('button', { name: /kirim check-in/i }));

    await waitFor(() => {
      const visitInsert = inserts.find((i) => i.table === 'visit');
      expect(visitInsert).toBeDefined();
      expect((visitInsert?.payload as Record<string, unknown>).asal).toBe('walk_in');
      expect((visitInsert?.payload as Record<string, unknown>).nama).toBe('Budi Santoso');
      expect((visitInsert?.payload as Record<string, unknown>).layanan_id).toBe('lay-1');
      expect((visitInsert?.payload as Record<string, unknown>).tujuan).toBe('loket');
      expect((visitInsert?.payload as Record<string, unknown>).status).toBe('menunggu');
    });

    // No row should be inserted into the legacy kunjungan table
    expect(inserts.find((i) => i.table === 'kunjungan')).toBeUndefined();
  });
});
