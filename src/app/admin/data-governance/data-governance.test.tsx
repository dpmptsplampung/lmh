// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import DataGovernancePage from './page';
import { createClient } from '@/lib/supabase/client';

interface CountResult {
  count: number | null;
  error: unknown;
}

const buildMockSupabase = (opts: {
  auditToday?: number;
  audit7?: number;
  audit30?: number;
  consentRows?: { tujuan: string; disetujui: boolean }[];
  piiCount?: number;
  recentAudit?: {
    id: string;
    actor_role: string | null;
    aksi: string;
    entitas: string;
    entitas_id: string | null;
    created_at: string;
  }[];
}) => {
  const chainable = (table: string) => {
    const self: Record<string, ReturnType<typeof vi.fn>> = {};
    self.select = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.limit = vi.fn(() => self);
    self.not = vi.fn(() => self);
    self.gte = vi.fn(() => self);

    // For count/head queries: { count, error }
    self.head = vi.fn(() => true);

    // Make self thenable so await resolves to { data, count, error }
    (self as unknown as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      let result: CountResult | { data: unknown; error: unknown } = {
        count: 0,
        error: null,
      };

      if (table === 'audit_log') {
        // We cannot easily distinguish between today/7/30 here without
        // inspecting the gte arg. Since the test passes fixed numbers,
        // we return the max so a single value is fine for smoke test.
        result = { count: opts.auditToday ?? 0, error: null };
      } else if (table === 'consent_log') {
        result = { data: opts.consentRows ?? [], error: null };
      } else if (table === 'pengunjung') {
        result = { count: opts.piiCount ?? 0, error: null };
      }
      return Promise.resolve(result).then(resolve, reject);
    };

    return self;
  };

  // Override audit_log chainable to return different counts based on the
  // gte argument. We track calls to return appropriate count.
  const auditLogChainable = () => {
    const self: Record<string, ReturnType<typeof vi.fn>> = {};
    let gteArg = '';
    self.select = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.limit = vi.fn(() => self);
    self.not = vi.fn(() => self);
    self.gte = vi.fn((col: string, val: string) => {
      gteArg = val;
      return self;
    });
    self.head = vi.fn(() => true);
    (self as unknown as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      // Heuristic: today is closer to now; 7 days ago older; 30 oldest.
      // We just return 3 different numbers based on gteArg.
      let count = 0;
      const argDate = new Date(gteArg).getTime();
      const now = Date.now();
      const diffDays = (now - argDate) / (1000 * 60 * 60 * 24);
      if (diffDays < 1) count = opts.auditToday ?? 0;
      else if (diffDays < 8) count = opts.audit7 ?? 0;
      else count = opts.audit30 ?? 0;

      return Promise.resolve({ count, error: null }).then(resolve, reject);
    };
    return self;
  };

  const auditListChainable = () => {
    const self: Record<string, ReturnType<typeof vi.fn>> = {};
    self.select = vi.fn(() => self);
    self.order = vi.fn(() => self);
    self.limit = vi.fn(() => self);
    self.gte = vi.fn(() => self);
    (self as unknown as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise
        .resolve({ data: opts.recentAudit ?? [], error: null })
        .then(resolve, reject);
    return self;
  };

  let auditCallCount = 0;
  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'audit_log') {
        auditCallCount += 1;
        // Calls 1-3 are count queries; call 4+ is the recent list
        if (auditCallCount <= 3) return auditLogChainable();
        return auditListChainable();
      }
      return chainable(table);
    }),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return { mock };
};

describe('I8 DPO dashboard: data-governance page smoke test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing and shows all 4 card titles', async () => {
    buildMockSupabase({
      auditToday: 5,
      audit7: 12,
      audit30: 30,
      consentRows: [
        { tujuan: 'checkin_data', disetujui: true },
        { tujuan: 'checkin_data', disetujui: false },
        { tujuan: 'chat_followup', disetujui: true },
      ],
      piiCount: 42,
      recentAudit: [
        {
          id: '1',
          actor_role: 'admin',
          aksi: 'update_status',
          entitas: 'kunjungan',
          entitas_id: 'abc-123-def-456',
          created_at: new Date().toISOString(),
        },
      ],
    });

    render(<DataGovernancePage />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });

    // Card 1: Audit Log title
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    // Card 2: Consent Coverage
    expect(screen.getByText('Consent Coverage')).toBeInTheDocument();
    // Card 3: PII Aktif
    expect(screen.getByText('PII Aktif')).toBeInTheDocument();
    // Card 4: recent audit table title
    expect(screen.getByText(/Audit Log Terbaru/)).toBeInTheDocument();
  });

  it('renders empty states when no data', async () => {
    buildMockSupabase({
      auditToday: 0,
      audit7: 0,
      audit30: 0,
      consentRows: [],
      piiCount: 0,
      recentAudit: [],
    });

    render(<DataGovernancePage />);

    await waitFor(() => {
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });

    // Empty consent
    expect(screen.getByText('Belum ada consent')).toBeInTheDocument();
    // Empty recent audit table
    expect(screen.getByText('Belum ada entri audit')).toBeInTheDocument();
  });

  it('renders recent audit entries with formatted data', async () => {
    buildMockSupabase({
      auditToday: 1,
      audit7: 1,
      audit30: 1,
      consentRows: [{ tujuan: 'checkin_data', disetujui: true }],
      piiCount: 1,
      recentAudit: [
        {
          id: 'audit-1',
          actor_role: 'petugas',
          aksi: 'update_status',
          entitas: 'kunjungan',
          entitas_id: '550e8400-e29b-41d4-a716-446655440000',
          created_at: '2026-07-11T10:00:00Z',
        },
      ],
    });

    render(<DataGovernancePage />);

    await waitFor(() => {
      // actor_role badge
      expect(screen.getByText('petugas')).toBeInTheDocument();
    });
    // aksi value
    expect(screen.getByText('update_status')).toBeInTheDocument();
    // entitas value
    expect(screen.getByText('kunjungan')).toBeInTheDocument();
  });

  it('renders back link to /admin', async () => {
    buildMockSupabase({});

    render(<DataGovernancePage />);

    await waitFor(() => {
      expect(screen.getByText('Audit Log')).toBeInTheDocument();
    });
    const backLink = screen.getByRole('link', { name: /kembali ke dashboard/i });
    expect(backLink).toHaveAttribute('href', '/admin');
  });
});
