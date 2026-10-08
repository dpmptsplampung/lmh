// @vitest-environment jsdom
// Konsol Pengaturan AI: kunci write-only, Uji (curl tersamar), aktivasi butuh uji/alasan, nav admin saja.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { ADMIN_NAV } from '@/lib/admin-nav';

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));

import PengaturanAiPage from './page';
import CobaTanyaBot from '@/components/admin/settings/CobaTanyaBot';

const EID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'sk-SANGAT-RAHASIA-9876';
const preset = [{ id: 'groq', label: 'Groq', tipe: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', model_contoh: 'llama' }];
const entry = {
  id: EID, label: 'Groq', tipe: 'openai_compat', base_url: 'https://api.groq.com/openai/v1', model: 'llama',
  rahasia_id: null, aktif: true, kuota_harian: null, punya_kunci: false, kunci_tersamar: null,
};

type Calls = Array<{ url: string; method: string; body: unknown }>;
let calls: Calls;
let getBody: Record<string, unknown>;

const jsonRes = (data: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

function baseState(over: Record<string, unknown> = {}) {
  return {
    enkripsi_siap: true, sumber_aktif: 'env', aktif: null,
    draf: { versi: 3, alasan: null, hasil_uji: {}, entries: [entry] },
    riwayat: [
      { versi: 3, status: 'draf', alasan: null, dibuat_at: '2026-10-08T01:00:00Z', diaktifkan_at: null },
      { versi: 2, status: 'arsip', alasan: 'awal', dibuat_at: '2026-10-01T01:00:00Z', diaktifkan_at: '2026-10-02T01:00:00Z' },
    ],
    preset, env_cadangan: { gemini_sdk: true, penyedia: [] }, ...over,
  };
}

beforeEach(() => {
  calls = [];
  getBody = baseState();
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (url.endsWith('/llm/rahasia')) return jsonRes({ ok: true, rahasia_id: 'rid-1', kunci_tersamar: '••••9876' });
    if (url.endsWith('/llm/test')) {
      return jsonRes({
        ok: true, http_status: 200, latensi_ms: 321, cuplikan: 'Halo, ini balasan contoh', error: null,
        tokens: null, curl: "curl https://api.groq.com/openai/v1/chat/completions -H 'Authorization: Bearer ••••9876'",
      });
    }
    if (url.endsWith('/llm/versi')) return jsonRes({ ok: true, versi_aktif: 3, berlaku: 'paling lambat 1 menit' });
    if (method === 'PUT') return jsonRes({ ok: true, versi: 3 });
    return jsonRes(getBody);
  }));
});
afterEach(cleanup);

describe('Pengaturan AI', () => {
  it('API key write-only: tak pernah dirender setelah disimpan, hanya 4 akhir tersamar', async () => {
    getBody = baseState({ draf: { versi: 3, alasan: null, hasil_uji: {}, entries: [entry] } });
    render(<PengaturanAiPage />);
    const input = (await screen.findByLabelText(/API key/)) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /Simpan kunci/ }));
    expect(await screen.findByText('••••9876')).toBeTruthy();
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    // kunci mentah hanya dikirim ke endpoint rahasia
    const kirim = calls.filter((c) => JSON.stringify(c.body ?? '').includes(SECRET));
    expect(kirim.map((c) => c.url)).toEqual(['/api/admin/settings/llm/rahasia']);
  });

  it('Uji menampilkan status, latensi, balasan contoh, dan curl dengan kunci tersamar', async () => {
    render(<PengaturanAiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Uji Groq/ }));
    const hasil = await screen.findByTestId(`uji-${EID}`);
    expect(hasil.textContent).toContain('Berhasil');
    expect(hasil.textContent).toContain('HTTP 200');
    expect(hasil.textContent).toContain('321 ms');
    expect(hasil.textContent).toContain('Halo, ini balasan contoh');
    expect(hasil.textContent).toContain('Bearer ••••9876');
    expect(screen.getByRole('button', { name: /Salin curl/ })).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/llm/test') && (c.body as { sumber: string }).sumber === 'draf')).toBe(true);
  });

  it('Aktifkan: terkunci sebelum lulus uji; tanpa uji wajib centang + alasan; setelah uji lulus bebas', async () => {
    render(<PengaturanAiPage />);
    const aktifkan = (await screen.findByRole('button', { name: /^Aktifkan v3/ })) as HTMLButtonElement;
    expect(aktifkan.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Aktifkan tanpa uji/));
    expect(aktifkan.disabled).toBe(true); // belum ada alasan
    fireEvent.change(screen.getByLabelText(/Alasan \(minimal 5/), { target: { value: 'abc' } });
    expect(aktifkan.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Alasan \(minimal 5/), { target: { value: 'uji manual di luar' } });
    expect(aktifkan.disabled).toBe(false);
    fireEvent.click(aktifkan);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/llm/versi'))).toBe(true));
    const v = calls.find((c) => c.url.endsWith('/llm/versi'))!.body;
    expect(v).toMatchObject({ aksi: 'aktifkan', versi: 3, tanpa_uji: true, alasan: 'uji manual di luar' });
  });

  it('Aktifkan setelah semua penyedia aktif lulus uji tidak butuh alasan', async () => {
    getBody = baseState({
      draf: { versi: 3, alasan: null, hasil_uji: { [EID]: { ok: true, http_status: 200, latensi_ms: 10 } }, entries: [entry] },
    });
    render(<PengaturanAiPage />);
    const aktifkan = (await screen.findByRole('button', { name: /^Aktifkan v3/ })) as HTMLButtonElement;
    expect(aktifkan.disabled).toBe(false);
    expect(screen.queryByLabelText(/Aktifkan tanpa uji/)).toBeNull();
    fireEvent.click(aktifkan);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/llm/versi'))).toBe(true));
    expect((calls.find((c) => c.url.endsWith('/llm/versi'))!.body as Record<string, unknown>).tanpa_uji).toBeUndefined();
  });

  it('Rollback butuh alasan dan konfirmasi', async () => {
    render(<PengaturanAiPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Rollback ke v2/ }));
    const ya = screen.getByRole('button', { name: /Ya, rollback/ }) as HTMLButtonElement;
    expect(ya.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Alasan rollback/), { target: { value: 'model baru bermasalah' } });
    fireEvent.click(ya);
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/llm/versi'))?.body).toMatchObject({ aksi: 'rollback', versi: 2 }));
  });

  it('enkripsi belum diatur: petunjuk jelas dan input kunci nonaktif', async () => {
    getBody = baseState({ enkripsi_siap: false });
    render(<PengaturanAiPage />);
    expect((await screen.findByTestId('peringatan-enkripsi')).textContent).toContain('SETTINGS_ENCRYPTION_KEY');
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).disabled).toBe(true);
  });

  it('galat muat: pesan + coba lagi; 403: hanya Admin', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => jsonRes({ error: 'x' }, 500));
    render(<PengaturanAiPage />);
    expect(await screen.findByText(/Gagal memuat pengaturan AI/)).toBeTruthy();
    cleanup();
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => jsonRes({ error: 'x' }, 403));
    render(<PengaturanAiPage />);
    expect(await screen.findByText(/hanya untuk Admin/)).toBeTruthy();
  });
});

describe('Navigasi & Coba tanya bot', () => {
  it('entri "Pengaturan AI" hanya untuk admin', () => {
    const e = ADMIN_NAV.find((x) => x.href === '/admin/settings/ai');
    expect(e?.roles).toEqual(['admin']);
    for (const role of ['petugas', 'front_office'] as const) {
      expect(ADMIN_NAV.filter((x) => x.roles.includes(role)).some((x) => x.href === '/admin/settings/ai')).toBe(false);
    }
  });

  it('Coba tanya bot: kirim pertanyaan dan tampilkan jawaban + penyedia', async () => {
    const f = vi.fn(() => jsonRes({ ok: true, jawaban: 'Syaratnya KTP dan NPWP', penyedia: 'groq', skor_faq: 0.82, latensi_ms: 400, reason: null, eskalasi: false, chatbot_aktif: false, sumber_dokumen: [] }));
    vi.stubGlobal('fetch', f);
    render(<CobaTanyaBot layananId="l1" layananNama="Helpdesk OSS" />);
    fireEvent.change(screen.getByLabelText(/Teks uji untuk bot/), { target: { value: 'Syarat NIB?' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirim/ }));
    expect((await screen.findByTestId('hasil-coba-bot')).textContent).toContain('Syaratnya KTP dan NPWP');
    expect(screen.getByTestId('hasil-coba-bot').textContent).toContain('NONAKTIF');
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ pertanyaan: 'Syarat NIB?', layanan_id: 'l1' });
  });

  it('Coba tanya bot: 429 menampilkan pesan batas', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonRes({ error: 'x' }, 429)));
    render(<CobaTanyaBot layananId="l1" />);
    fireEvent.change(screen.getByLabelText(/Teks uji untuk bot/), { target: { value: 'halo bot' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirim/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('30 kali per jam');
  });
});
