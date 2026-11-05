// @vitest-environment jsdom
// Perbaikan G1 chat publik: wajib Google + konteks ?layanan= (A-03), buka percakapan tanpa centang (A-10),
// respons riwayat basi tidak menimpa percakapan lain (C2-07), galat riwayat terlihat + Coba lagi (C2-02).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import PublicChatPage from './page';
import { createClient } from '@/lib/supabase/client';
import type { OpsiHarness } from './chat.test-utils';
import { L_BANK, L_BPJS, PENGGUNA_GOOGLE, barisRpc, siapkanHarness } from './chat.test-utils';

const harness = (opsi: OpsiHarness = {}) => siapkanHarness(createClient, opsi);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.pushState({}, '', '/chat');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('A-03: chat wajib login Google', () => {
  it.each([
    ['belum masuk', null],
    ['akun anonim', { id: 'anon-1', is_anonymous: true }],
  ])('%s: ajakan masuk di paling atas, formulir tidak ada, profil anonim tidak dibuat', async (_nama, user) => {
    const { inserts } = harness({ user });
    render(<PublicChatPage />);
    const ajakan = await screen.findByRole('button', { name: /masuk dengan google/i });
    expect(ajakan).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Nama Anda/)).toBeNull();
    expect(screen.queryByLabelText(/^Layanan yang Ditanyakan/)).toBeNull();
    expect(screen.queryByLabelText(/saya setuju/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /mulai sesi chat/i })).toBeNull();
    expect(inserts.filter((i) => i.table === 'pengunjung')).toHaveLength(0);
  });

  it('tombol masuk meneruskan ?layanan= lewat next agar konteks tidak hilang', async () => {
    window.history.pushState({}, '', `/chat?layanan=${L_BANK}`);
    const { signInWithOAuth } = harness({ user: null });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /masuk dengan google/i }));
    const opsi = signInWithOAuth.mock.calls[0][0] as { provider: string; options: { redirectTo: string } };
    expect(opsi.provider).toBe('google');
    const tujuan = new URL(opsi.options.redirectTo);
    expect(tujuan.pathname).toBe('/auth/callback');
    expect(tujuan.searchParams.get('next')).toBe(`/chat?layanan=${L_BANK}`);
  });

  it('nama layanan dengan spasi/karakter khusus ikut utuh di next', async () => {
    window.history.pushState({}, '', '/chat?layanan=Bank%20Lampung%26Co');
    const { signInWithOAuth } = harness({ user: null });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /masuk dengan google/i }));
    const { options } = signInWithOAuth.mock.calls[0][0] as { options: { redirectTo: string } };
    const next = new URL(options.redirectTo).searchParams.get('next');
    expect(next).toBe('/chat?layanan=Bank%20Lampung%26Co');
  });

  it('tanpa ?layanan= next tetap /chat', async () => {
    const { signInWithOAuth } = harness({ user: null });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /masuk dengan google/i }));
    const { options } = signInWithOAuth.mock.calls[0][0] as { options: { redirectTo: string } };
    expect(new URL(options.redirectTo).searchParams.get('next')).toBe('/chat');
  });

  it('pengguna Google: formulir tampil, ajakan masuk tidak', async () => {
    harness({ user: { ...PENGGUNA_GOOGLE, id: 'g-1' } });
    render(<PublicChatPage />);
    expect(await screen.findByLabelText(/^Layanan yang Ditanyakan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).toBeNull();
  });
});

describe('R5: pengunjung wajib identitas Google dari data Auth', () => {
  it.each([
    ['nonanonim tanpa identitas Google (sandi)', { id: 'p-1', is_anonymous: false, identities: [{ provider: 'email' }], app_metadata: { provider: 'email' } }],
    ['klaim Google hanya di user_metadata (dapat dipalsukan klien)', { id: 'p-2', is_anonymous: false, identities: [], user_metadata: { provider: 'google', iss: 'https://accounts.google.com' } }],
    ['tanpa data identitas sama sekali', { id: 'p-3', is_anonymous: false }],
  ])('%s: ajakan masuk Google tampil, formulir tidak, profil tidak dibuat', async (_nama, user) => {
    const { inserts } = harness({ user });
    render(<PublicChatPage />);
    expect(await screen.findByRole('button', { name: /masuk dengan google/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Layanan yang Ditanyakan/)).toBeNull();
    expect(inserts.filter((i) => i.table === 'pengunjung')).toHaveLength(0);
  });

  it.each([
    ['identities memuat google', { ...PENGGUNA_GOOGLE, id: 'g-1' }],
    ['app_metadata.providers memuat google', { id: 'g-2', is_anonymous: false, app_metadata: { providers: ['google'] } }],
  ])('%s: formulir tampil', async (_nama, user) => {
    harness({ user });
    render(<PublicChatPage />);
    expect(await screen.findByLabelText(/^Layanan yang Ditanyakan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).toBeNull();
  });

  it.each(['admin', 'petugas', 'front_office'])('STAF sah (role %s di JWT) dengan sandi tetap boleh memakai chat', async (role) => {
    harness({ user: { id: 's-1', is_anonymous: false, identities: [{ provider: 'email' }], app_metadata: { provider: 'email', role } } });
    render(<PublicChatPage />);
    expect(await screen.findByLabelText(/^Layanan yang Ditanyakan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /masuk dengan google/i })).toBeNull();
  });

  it.each([
    ['google', { ...PENGGUNA_GOOGLE, id: 'g-3' }],
    ['email', { id: 's-2', is_anonymous: false, identities: [{ provider: 'email' }], app_metadata: { provider: 'email', role: 'petugas' } }],
  ])('profil pengunjung baru mencatat provider %s dari identitas nyata, bukan nilai tetap', async (provider, user) => {
    const h = harness({ user, tanpaProfil: true });
    render(<PublicChatPage />);
    await screen.findByLabelText(/^Layanan yang Ditanyakan/);
    const profil = h.inserts.find((i) => i.table === 'pengunjung');
    expect((profil?.payload as { provider?: string }).provider).toBe(provider);
  });
});

describe('A-10: layanan yang sudah punya percakapan tidak meminta centang lagi', () => {
  it('pilih layanan yang sudah ada: tanpa centang persetujuan, tombol "Buka percakapan" aktif dan membuka percakapan', async () => {
    const { inserts } = harness({ rpcDaftar: [barisRpc()] });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /percakapan baru/i }));
    const pilih = await screen.findByLabelText(/^Layanan yang Ditanyakan/);
    // Layanan lain (belum ada percakapan): centang tetap wajib.
    fireEvent.change(pilih, { target: { value: L_BPJS } });
    expect(screen.getByLabelText(/saya setuju/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mulai sesi chat/i })).toBeDisabled();
    // Layanan yang sudah ada: tidak ada centang, langsung bisa dibuka.
    fireEvent.change(pilih, { target: { value: L_BANK } });
    expect(screen.queryByLabelText(/saya setuju/i)).toBeNull();
    const buka = screen.getByRole('button', { name: 'Buka percakapan' });
    expect(buka).toBeEnabled();
    fireEvent.click(buka);
    expect(await screen.findByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
    expect(inserts.filter((i) => i.table === 'consent_log')).toHaveLength(0);
  });
});

/** Dua percakapan; respons riwayat percakapan Bank (sesi-A) ditahan sampai `lepas()` dipanggil. */
function siapkanBalapan() {
  const h = harness({
    rpcDaftar: [
      barisRpc({ sesi_terakhir_id: 'sesi-A', sesi_terbuka_id: 'sesi-A' }),
      barisRpc({
        layanan_id: L_BPJS, layanan_nama: 'BPJS Kesehatan', sesi_terakhir_id: 'sesi-B', sesi_terbuka_id: 'sesi-B',
        last_pesan: 'Halo dari B',
      }),
    ],
    messages: (url) =>
      url.includes('sesi_id=sesi-A')
        ? { status: 'eskalasi', ada_lebih: false, messages: [{ id: 'mA', sesi_id: 'sesi-A', pengirim: 'petugas', isi: 'Pesan milik layanan A', created_at: '2026-10-30T01:00:00Z' }] }
        : { status: 'bot', ada_lebih: false, messages: [{ id: 'mB', sesi_id: 'sesi-B', pengirim: 'bot', isi: 'Pesan milik layanan B', created_at: '2026-10-30T02:00:00Z' }] },
  });
  const asli = h.fetchMock.getMockImplementation()!;
  let lepas!: () => void;
  const tahan = new Promise<void>((r) => {
    lepas = r;
  });
  h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('sesi_id=sesi-A')) await tahan;
    return asli(input, init);
  });
  return { ...h, lepas };
}

describe('C2-07: respons riwayat basi tidak boleh menimpa percakapan aktif', () => {
  it('buka A, kembali, buka B, lalu respons A tiba terlambat: utas B tidak memuat pesan A', async () => {
    const { lepas } = siapkanBalapan();
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    fireEvent.click(await screen.findByRole('button', { name: /daftar percakapan/i }));
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bpjs kesehatan/i }));
    expect(await screen.findByText('Pesan milik layanan B')).toBeInTheDocument();
    expect(screen.getByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();

    await act(async () => {
      lepas();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.queryByText('Pesan milik layanan A')).toBeNull();
    expect(screen.getByText('Pesan milik layanan B')).toBeInTheDocument();
    // status B (bot) tidak tertimpa status A (eskalasi)
    expect(screen.getByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
  });

  it('kembali ke daftar sebelum respons tiba: respons dibuang (tidak mengisi utas yang sudah ditinggalkan)', async () => {
    const { lepas } = siapkanBalapan();
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    fireEvent.click(await screen.findByRole('button', { name: /daftar percakapan/i }));
    await screen.findByRole('button', { name: /buka percakapan bpjs kesehatan/i });
    await act(async () => {
      lepas();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText('Pesan milik layanan A')).toBeNull();
  });
});

/**
 * R4: sinkronisasi biasa (polling) percakapan A tertunda; pengguna pindah ke B. Respons A tiba SESUDAH B dibuka tetapi
 * SEBELUM sinkronisasi B yang pertama dimulai (macrotask) -> hanya jendela ini yang menguji penjaga generasi.
 */
function siapkanBalapanSinkron(statusA: string) {
  const h = harness({
    rpcDaftar: [
      barisRpc({ sesi_terakhir_id: 'sesi-A', sesi_terbuka_id: 'sesi-A' }),
      barisRpc({
        layanan_id: L_BPJS, layanan_nama: 'BPJS Kesehatan', sesi_terakhir_id: 'sesi-B', sesi_terbuka_id: 'sesi-B',
        last_pesan: 'Halo dari B',
      }),
    ],
  });
  let lepasA!: () => void;
  const tahanA = new Promise<void>((r) => {
    lepasA = r;
  });
  const sinkronA = vi.fn();
  h.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const balas = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (url.startsWith('/api/chat/messages')) {
      const riwayat = url.includes('riwayat=1');
      if (url.includes('sesi_id=sesi-A')) {
        if (riwayat) return balas({ status: statusA, ada_lebih: false, messages: [] });
        sinkronA();
        await tahanA; // sinkronisasi biasa A tertahan
        return balas({ status: statusA, messages: [{ id: 'mA', sesi_id: 'sesi-A', pengirim: 'petugas', isi: 'Sinkron milik layanan A', created_at: '2026-10-30T01:00:00Z' }] });
      }
      return balas({ status: 'bot', ada_lebih: false, messages: [{ id: 'mB', sesi_id: 'sesi-B', pengirim: 'bot', isi: 'Pesan milik layanan B', created_at: '2026-10-30T02:00:00Z' }] });
    }
    if (url.startsWith('/api/chat/status')) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return { ...h, lepasA, sinkronA };
}

const mikrotugas = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('R4: respons SINKRONISASI lama tidak boleh masuk ke utas yang baru dibuka', () => {
  it('buka A (sinkron tertunda), kembali, buka B; respons sinkron A tiba sebelum sinkron B mulai: pesan dan status A dibuang', async () => {
    const { lepasA, sinkronA } = siapkanBalapanSinkron('eskalasi');
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    await waitFor(() => expect(sinkronA).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /daftar percakapan/i }));
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bpjs kesehatan/i }));
    // Respons A dilepas hanya lewat mikrotugas: timer sinkron B (setTimeout 0) belum sempat jalan.
    await act(async () => {
      lepasA();
      await mikrotugas();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(await screen.findByText('Pesan milik layanan B')).toBeInTheDocument();
    expect(screen.queryByText('Sinkron milik layanan A')).toBeNull();
    expect(screen.getByText('Mode Chatbot FAQ Aktif')).toBeInTheDocument();
  });

  it('kembali ke daftar lalu respons sinkron A tiba: tidak ada yang berubah di state percakapan berikutnya', async () => {
    const { lepasA, sinkronA } = siapkanBalapanSinkron('eskalasi');
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    await waitFor(() => expect(sinkronA).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /daftar percakapan/i }));
    await screen.findByRole('button', { name: /buka percakapan bpjs kesehatan/i });
    await act(async () => {
      lepasA();
      await new Promise((r) => setTimeout(r, 30));
    });
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bpjs kesehatan/i }));
    expect(await screen.findByText('Pesan milik layanan B')).toBeInTheDocument();
    expect(screen.queryByText('Sinkron milik layanan A')).toBeNull();
  });
});

describe('C2-02: galat memuat riwayat terlihat dan bisa diulang', () => {
  const dua = [barisRpc({ sesi_terbuka_id: null, sesi_terakhir_id: 'sesi-2', status_terakhir: 'selesai' })];

  it('"Muat pesan sebelumnya" gagal: pesan galat + Coba lagi; berhasil setelah diulang', async () => {
    const h = harness({ rpcDaftar: dua });
    const asli = h.fetchMock.getMockImplementation()!;
    let gagal = true;
    h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('sebelum=')) {
        if (gagal) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ status: 'selesai', ada_lebih: false, messages: [{ id: 'm0', sesi_id: 'sesi-0', pengirim: 'bot', isi: 'Pesan tertua', created_at: '2026-08-01T01:00:00Z' }] }) };
      }
      if (url.includes('riwayat=1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'selesai', ada_lebih: true, messages: [{ id: 'm2', sesi_id: 'sesi-2', pengirim: 'bot', isi: 'Pesan baru', created_at: '2026-10-30T01:00:00Z' }] }) };
      }
      return asli(input, init);
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    fireEvent.click(await screen.findByRole('button', { name: /muat pesan sebelumnya/i }));
    const galat = await screen.findByRole('alert');
    expect(galat).toHaveTextContent(/pesan sebelumnya belum dapat dimuat/i);

    gagal = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Pesan tertua')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('riwayat awal gagal saat membuka percakapan: galat + Coba lagi memuat ulang riwayat', async () => {
    const h = harness({ rpcDaftar: dua });
    const asli = h.fetchMock.getMockImplementation()!;
    let gagal = true;
    h.fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('riwayat=1')) {
        if (gagal) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ status: 'selesai', ada_lebih: false, messages: [{ id: 'm2', sesi_id: 'sesi-2', pengirim: 'bot', isi: 'Riwayat pulih', created_at: '2026-10-30T01:00:00Z' }] }) };
      }
      return asli(input, init);
    });
    render(<PublicChatPage />);
    fireEvent.click(await screen.findByRole('button', { name: /buka percakapan bank lampung/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/riwayat percakapan belum dapat dimuat/i);
    gagal = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Riwayat pulih')).toBeInTheDocument();
  });
});
