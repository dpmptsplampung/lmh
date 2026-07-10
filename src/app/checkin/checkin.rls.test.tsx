import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/022_anon_rate_limit.sql',
);

const readMigration = (): string => {
  try {
    return readFileSync(MIGRATION_PATH, 'utf-8');
  } catch {
    return '';
  }
};

describe('K3 migration: 022_anon_rate_limit.sql — file-level assertions', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    expect(sql).toMatch(/Fase 0\s*\/\s*K3/i);
    expect(sql).toMatch(/rate limit/i);
  });

  it('creates the anon_rate_limit table', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+anon_rate_limit/i);
  });

  it('defines the check_anon_rate function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+check_anon_rate/i);
  });

  it('defines the log_anon_action trigger function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+log_anon_action/i);
  });

  it('revokes direct client access to anon_rate_limit', () => {
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+anon_rate_limit\s+FROM\s+anon\s*,\s*authenticated/i,
    );
  });

  it('drops the old vulnerable kunjungan_anon_insert policy', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"kunjungan_anon_insert"\s+ON\s+kunjungan/i,
    );
  });

  it('recreates kunjungan_anon_insert WITH check_anon_rate', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"kunjungan_anon_insert"\s+ON\s+kunjungan/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'kunjungan_insert'\s*,\s*5\s*,\s*60\s*\)/i);
  });

  it('recreates chat_sesi_owner_insert WITH check_anon_rate (3/60s)', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_sesi_owner_insert"\s+ON\s+chat_sesi/i,
    );
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_sesi_owner_insert"\s+ON\s+chat_sesi/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_sesi_insert'\s*,\s*3\s*,\s*60\s*\)/i);
  });

  it('recreates chat_pesan_owner_insert WITH check_anon_rate (20/60s)', () => {
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"chat_pesan_owner_insert"\s+ON\s+chat_pesan/i,
    );
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"chat_pesan_owner_insert"\s+ON\s+chat_pesan/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'chat_pesan_insert'\s*,\s*20\s*,\s*60\s*\)/i);
  });

  it('exempts petugas/admin from rate limiting in all three policies', () => {
    // Each WITH CHECK must include get_my_role() IN ('petugas','admin')
    // Strip line comments so the ROLLBACK section is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    // Count occurrences of the exemption pattern — should appear in 3 active policies.
    const matches = stripped.match(
      /get_my_role\s*\(\s*\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)/gi,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('creates the three AFTER INSERT triggers', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_kunjungan_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_sesi_insert/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_chat_pesan_insert/i);
  });

  it('does NOT contain WITH CHECK (true) for kunjungan INSERT (active SQL)', () => {
    // Strip line comments so ROLLBACK documentation is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    // Look for the vulnerable pattern scoped to kunjungan INSERT.
    const vulnerable = /kunjungan[\s\S]*?FOR\s+INSERT[\s\S]*?WITH\s+CHECK\s*\(\s*true\s*\)/i;
    expect(vulnerable.test(stripped)).toBe(false);
  });

  it('scopes kunjungan INSERT to authenticated (no longer anon/public)', () => {
    // Strip comments so ROLLBACK block is ignored.
    const stripped = sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    const policyBlock = stripped.match(
      /CREATE\s+POLICY\s+"kunjungan_anon_insert"\s+ON\s+kunjungan\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(policyBlock).not.toBeNull();
  });

  it('includes a ROLLBACK section', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
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
