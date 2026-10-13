// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/client';
import NotificationsPage from './page';

interface NotifRow {
  id: string;
  kanal: 'email' | 'web_push';
  subjek: string | null;
  body: string;
  status: string;
  created_at: string;
}

type HasilDb = {
  data?: unknown;
  error: { message: string; code?: string } | null;
  status?: number;
};

interface OpsiMock {
  /** Baris push_subscriptions milik pengguna saat halaman dimuat (>0 = toggle awalnya aktif). */
  subs?: Array<{ id: string }>;
  /** Hasil upsert push_subscriptions (jalur aktifkan). */
  upsertResult?: HasilDb;
  /** Hasil delete push_subscriptions (jalur nonaktifkan). */
  deleteResult?: HasilDb;
}

const buildMockSupabase = (rows: NotifRow[] = [], opsi: OpsiMock = {}) => {
  const authUser = { id: 'user-1', email: 'me@example.com' };
  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: authUser },
    error: null,
  });

  const notifChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };

  const pushSubChain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: opsi.subs ?? [], error: null }),
  };

  // Upsert chain for subscribe path: .from('push_subscriptions').upsert(payload, { onConflict })
  const upsertMock = vi.fn().mockResolvedValue(opsi.upsertResult ?? { error: null });

  // Delete chain for unsubscribe path: .delete().eq('user_id', ..).eq('endpoint', ..) (thenable)
  const deleteHasil = opsi.deleteResult ?? { data: null, error: null };
  const deleteChain: {
    eq: ReturnType<typeof vi.fn>;
    then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise<unknown>;
  } = {
    eq: vi.fn(() => deleteChain),
    then: (r, j) => Promise.resolve(deleteHasil).then(r, j),
  };

  const mock = {
    auth: { getUser: authGetUser },
    from: vi.fn((table: string) => {
      if (table === 'notifikasi') return notifChain;
      if (table === 'push_subscriptions') return pushSubChain;
      return {};
    }),
    _notifChain: notifChain,
    _pushSubChain: pushSubChain,
    _upsertMock: upsertMock,
    _deleteChain: deleteChain,
    _authUser: authUser,
  };

  // The subscribe handler calls .upsert() on push_subscriptions; we route
  // that by augmenting the pushSubChain returned for that table.
  pushSubChain.upsert = upsertMock;
  pushSubChain.delete = vi.fn().mockReturnValue(deleteChain);

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
};

describe('I5 /me/notifications page — smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement serviceWorker — leave it undefined so the page
    // treats push as unsupported (graceful path).
    // @ts-expect-error narrowing test env
    delete navigator.serviceWorker;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page heading', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Notifikasi/i })).toBeInTheDocument();
    });
  });

  it('lists recent notifications with subject and body', async () => {
    buildMockSupabase([
      {
        id: 'n1',
        kanal: 'email',
        subjek: 'Survei Kepuasan Masyarakat — DPMPTSP Lampung',
        body: 'Layanan Anda telah selesai. Mohon isi survei: https://lmh.lampungprov.go.id/skm?token=abc',
        status: 'sent',
        created_at: new Date().toISOString(),
      },
      {
        id: 'n2',
        kanal: 'email',
        subjek: 'Listing UMKM Anda Disetujui — DPMPTSP Lampung',
        body: 'Listing "Kopi Lampung" telah disetujui dan tayang di marketplace.',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Survei Kepuasan Masyarakat/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Listing UMKM Anda Disetujui/i)).toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no notifications', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Belum ada notifikasi|Tidak ada notifikasi/i)).toBeInTheDocument();
    });
  });

  it('shows push toggle (disabled when serviceWorker unsupported)', async () => {
    buildMockSupabase([]);
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toBeDisabled();
    });
  });
});

describe('I5 /me/notifications page — subscribe uses upsert (23505 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('calls upsert with onConflict endpoint (not insert) so resubscribe succeeds', async () => {
    const mock = buildMockSupabase([]);

    // Mock serviceWorker + pushManager so the subscribe path is reachable.
    const fakeSubscription = {
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc-123',
        keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
      }),
    };
    const readyReg = {
      pushManager: {
        subscribe: vi.fn().mockResolvedValue(fakeSubscription),
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    };
    const registerMock = vi.fn().mockResolvedValue(readyReg);
    // @ts-expect-error narrow test env — inject serviceWorker
    navigator.serviceWorker = { register: registerMock, ready: Promise.resolve(readyReg) };

    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-vapid-key';

    render(<NotificationsPage />);
    const toggle = await screen.findByRole('button', { name: /Aktifkan notifikasi push/i });
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
    });
    fireEvent.click(toggle);

    // The subscribe handler should call upsert with onConflict: 'endpoint'.
    await waitFor(() => {
      expect(mock._upsertMock).toHaveBeenCalledTimes(1);
    });
    const [payload, options] = mock._upsertMock.mock.calls[0];
    expect(payload.user_id).toBe('user-1');
    expect(payload.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc-123');
    expect(payload.keys).toEqual({ p256dh: 'p256dh-val', auth: 'auth-val' });
    expect(options).toEqual({ onConflict: 'endpoint' });

    // Success message should appear.
    await waitFor(() => {
      expect(screen.getByText(/Notifikasi push diaktifkan/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Audit T2b: hasil upsert/delete push_subscriptions harus dicek. supabase-js tidak melempar;
// toggle "aktif" tidak boleh menyala bila server tidak menyimpan langganan.
// ---------------------------------------------------------------------------

const ERR_RLS = { message: 'new row violates row-level security policy for table "push_subscriptions"', code: '42501' };
const ERR_JARINGAN = { message: 'TypeError: Failed to fetch', code: '' };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc-123';

// Memasang serviceWorker + pushManager palsu agar jalur subscribe/unsubscribe terjangkau.
function pasangServiceWorker(opsi: { subscribeSudahAda?: boolean } = {}) {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const sub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256dh-val', auth: 'auth-val' } }),
    unsubscribe,
  };
  const readyReg = {
    pushManager: {
      subscribe: vi.fn().mockResolvedValue(sub),
      getSubscription: vi.fn().mockResolvedValue(opsi.subscribeSudahAda ? sub : null),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(readyReg), ready: Promise.resolve(readyReg) },
  });
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-vapid-key';
  return { sub, unsubscribe, readyReg };
}

describe('T2b /me/notifications — aktifkan push: hasil upsert dicek', () => {
  let konsolError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    konsolError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    konsolError.mockRestore();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  const klikAktifkan = async () => {
    const toggle = await screen.findByRole('button', { name: /Aktifkan notifikasi push/i });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
  };

  it.each([
    ['ditolak RLS (42501): endpoint sudah terdaftar, tak ada policy UPDATE', { data: null, error: ERR_RLS }, /ditolak server.*coba lagi untuk membuat langganan baru/i],
    ['error jaringan', { data: null, error: ERR_JARINGAN, status: 0 }, /^Gagal mengaktifkan notifikasi, coba lagi$/],
  ])('upsert gagal: %s -> langganan browser dibatalkan, toggle tetap mati, pesan galat bermakna', async (_nama, upsertResult, pesan) => {
    const { unsubscribe } = pasangServiceWorker();
    const mock = buildMockSupabase([], { upsertResult });
    render(<NotificationsPage />);
    await klikAktifkan();

    expect(await screen.findByText(pesan)).toBeInTheDocument();
    expect(mock._upsertMock).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const toggle = screen.getByRole('button', { name: /Aktifkan notifikasi push/i });
    expect(toggle).toHaveAttribute('data-enabled', 'false');
    expect(screen.queryByText(/Notifikasi push diaktifkan/i)).toBeNull();
    // tombol bisa dicoba lagi (tidak terkunci busy)
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it('upsert menolak (promise reject) -> diperlakukan gagal: batalkan langganan, toggle mati', async () => {
    const { unsubscribe } = pasangServiceWorker();
    const mock = buildMockSupabase([]);
    mock._upsertMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<NotificationsPage />);
    await klikAktifkan();

    expect(await screen.findByText('Gagal mengaktifkan notifikasi, coba lagi')).toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toHaveAttribute('data-enabled', 'false');
  });

  it('pembatalan langganan browser ikut gagal -> dicatat ke console.error (tidak ditelan diam-diam), pesan galat tetap tampil', async () => {
    const { unsubscribe } = pasangServiceWorker();
    unsubscribe.mockRejectedValueOnce(new Error('unsubscribe gagal'));
    buildMockSupabase([], { upsertResult: { data: null, error: ERR_RLS } });
    render(<NotificationsPage />);
    await klikAktifkan();

    expect(await screen.findByText(/Gagal mengaktifkan notifikasi/)).toBeInTheDocument();
    expect(konsolError).toHaveBeenCalledWith(expect.stringContaining('membatalkan langganan browser'), expect.any(Error));
    expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toHaveAttribute('data-enabled', 'false');
  });

  it('upsert sukses -> toggle aktif, pesan sukses, langganan browser TIDAK dibatalkan', async () => {
    const { unsubscribe } = pasangServiceWorker();
    const mock = buildMockSupabase([]);
    render(<NotificationsPage />);
    await klikAktifkan();

    expect(await screen.findByText(/Notifikasi push diaktifkan/i)).toBeInTheDocument();
    expect(mock._upsertMock).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Aktif$/ })).toHaveAttribute('data-enabled', 'true');
    expect(screen.queryByText('Gagal mengaktifkan notifikasi, coba lagi')).toBeNull();
  });
});

describe('T2b /me/notifications — nonaktifkan push: hasil delete dicek', () => {
  let konsolError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    konsolError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    konsolError.mockRestore();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  // Toggle awalnya aktif karena server punya langganan milik pengguna.
  const bukaDalamKeadaanAktif = async (opsi: OpsiMock = {}) => {
    const sw = pasangServiceWorker({ subscribeSudahAda: true });
    const mock = buildMockSupabase([], { subs: [{ id: 's1' }], ...opsi });
    render(<NotificationsPage />);
    const toggle = await screen.findByRole('button', { name: /Aktif$/ });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    return { sw, mock, toggle };
  };

  it('delete sukses -> hapus baris milik pengguna+endpoint, batalkan langganan browser, toggle mati', async () => {
    const { sw, mock, toggle } = await bukaDalamKeadaanAktif();
    fireEvent.click(toggle);

    expect(await screen.findByText(/Notifikasi push dinonaktifkan/i)).toBeInTheDocument();
    expect(mock._deleteChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mock._deleteChain.eq).toHaveBeenCalledWith('endpoint', ENDPOINT);
    expect(sw.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toHaveAttribute('data-enabled', 'false');
  });

  it.each([
    ['ditolak RLS (42501)', { data: null, error: ERR_RLS }],
    ['error jaringan', { data: null, error: ERR_JARINGAN, status: 0 }],
  ])('delete gagal: %s -> status sesungguhnya (masih aktif), pesan galat, browser tidak diubah', async (_nama, deleteResult) => {
    const { sw, toggle } = await bukaDalamKeadaanAktif({ deleteResult });
    fireEvent.click(toggle);

    expect(await screen.findByText('Gagal menonaktifkan notifikasi, coba lagi')).toBeInTheDocument();
    // server gagal menghapus -> langganan browser JANGAN dilepas sehingga keadaan tetap konsisten (aktif)
    expect(sw.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Aktif$/ })).toHaveAttribute('data-enabled', 'true');
    expect(screen.queryByText(/Notifikasi push dinonaktifkan/i)).toBeNull();
  });

  it('tidak ada langganan di perangkat ini (aktif di perangkat lain): JANGAN mengklaim dinonaktifkan; toggle tetap aktif; tak ada delete', async () => {
    const sw = pasangServiceWorker({ subscribeSudahAda: false });
    const mock = buildMockSupabase([], { subs: [{ id: 's-perangkat-lain' }] });
    render(<NotificationsPage />);
    const toggle = await screen.findByRole('button', { name: /Aktif$/ });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    expect(await screen.findByText(/aktif ada di perangkat lain.*nonaktifkan dari perangkat itu/i)).toBeInTheDocument();
    expect(screen.queryByText(/Notifikasi push dinonaktifkan/i)).toBeNull();
    // tidak ada yang dihapus di server (langganan perangkat lain tidak disentuh) dan tak ada yang dilepas di browser
    expect(mock._pushSubChain.delete).not.toHaveBeenCalled();
    expect(sw.unsubscribe).not.toHaveBeenCalled();
    // toggle mencerminkan kenyataan: masih aktif
    expect(screen.getByRole('button', { name: /Aktif$/ })).toHaveAttribute('data-enabled', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /Aktif$/ })).not.toBeDisabled());
  });

  it('delete 0 baris tanpa error (baris sudah tidak ada) = sudah nonaktif -> sukses, bukan galat', async () => {
    const { sw, toggle } = await bukaDalamKeadaanAktif({ deleteResult: { data: [], error: null } });
    fireEvent.click(toggle);

    expect(await screen.findByText(/Notifikasi push dinonaktifkan/i)).toBeInTheDocument();
    expect(sw.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toHaveAttribute('data-enabled', 'false');
  });

  it('server sukses tetapi pembatalan langganan browser gagal -> tetap nonaktif (server tak akan mengirim), dicatat ke console.error', async () => {
    const { sw, toggle } = await bukaDalamKeadaanAktif();
    sw.unsubscribe.mockRejectedValueOnce(new Error('unsubscribe gagal'));
    fireEvent.click(toggle);

    expect(await screen.findByText(/Notifikasi push dinonaktifkan/i)).toBeInTheDocument();
    expect(konsolError).toHaveBeenCalledWith(expect.stringContaining('membatalkan langganan browser'), expect.any(Error));
    expect(screen.getByRole('button', { name: /Aktifkan notifikasi push/i })).toHaveAttribute('data-enabled', 'false');
  });
});
