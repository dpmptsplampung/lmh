// @vitest-environment jsdom
// Admin Live Chat sebagai layanan online tercatat (Tahap C): kotak masuk chat eskalasi, Ambil / Ambil Alih (alasan
// wajib) / Teruskan / Selesai lewat /api/chat/sesi (RPC chat_*), pesan galat Indonesia, peringatan petugas_hadir,
// aksesibilitas dialog. Kontrak: docs/analysis/FO-CHAT-KONTRAK-RPC.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { buatH, punyaOp, type FakeH, type Op } from '@/test/fo-supabase-mock';

const ME = 'pet-1';
const SESI = 's1';

const m = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  h: null as unknown as FakeH,
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, replace: m.replace }) }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  const channel = { on: () => channel, subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return channel; } };
  return { createClient: () => ({ ...buatFakeSupabase(m.h), channel: () => channel, removeChannel: () => {} }) };
});

import AdminChatPage from './page';

type Role = 'admin' | 'petugas' | 'front_office';

let sesi: Record<string, unknown>;
let tahap: Record<string, unknown>[];
let jawabSesi: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> };
let panggilSesi: Record<string, unknown>[];

const sesi0 = (o: Record<string, unknown> = {}) => ({
  id: SESI, status: 'eskalasi', layanan_id: 'l1', pengunjung_id: null, ditangani_oleh: null,
  created_at: '2026-10-14T01:00:00Z', updated_at: '2026-10-14T01:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-10-14T01:00:01Z', last_pengirim: 'pengunjung', unread: true, ...o,
});
const tahapFo = (o: Record<string, unknown> = {}) => ({
  id: 'pn-1', chat_sesi_id: SESI, peran_tahap: 'fo', status: 'menunggu', layanan_id: null, penangan_id: null, ...o,
});

function siapkan(role: Role, opsi: { sesiRow?: Record<string, unknown>; tahapRows?: Record<string, unknown>[] } = {}) {
  sesi = opsi.sesiRow ?? sesi0();
  tahap = opsi.tahapRows ?? [tahapFo()];
  m.h.tabel.petugas = (ops: Op[]) =>
    punyaOp(ops, 'select', 'id, role, layanan_id')
      ? { data: { id: ME, role, layanan_id: role === 'petugas' ? 'l1' : null }, error: null }
      : { data: [{ id: ME, nama: 'Saya' }, { id: 'pet-2', nama: 'Sari' }], error: null };
  m.h.tabel.layanan = {
    data: [
      { id: 'l1', nama: 'Helpdesk OSS', aktif: true, punya_chat: true },
      { id: 'l2', nama: 'BPJS Kesehatan', aktif: true, punya_chat: false },
      { id: 'l3', nama: 'Bank Lampung', aktif: true, punya_chat: true },
      { id: 'l4', nama: 'Layanan Lama', aktif: false, punya_chat: true },
    ],
    error: null,
  };
  m.h.tabel.topik_penanganan = (ops: Op[]) =>
    punyaOp(ops, 'is', 'layanan_id', null)
      ? { data: [{ id: 'tf-1', nama: 'Informasi umum', urut: 1 }, { id: 'tf-2', nama: 'Arahan layanan', urut: 2 }], error: null }
      : { data: [{ id: 'tl-1', nama: 'Konsultasi NIB', urut: 1 }], error: null };
  m.h.tabel.penanganan = () => ({ data: tahap, error: null });
  m.h.tabel.chat_sesi = { data: [{ kontak_pengunjung: 'Ani' }], error: null };
  m.h.rpc = (nama) => (nama === 'chat_sesi_ringkas' ? { data: [sesi], error: null } : { data: null, error: null });
}

const pesanOk = (data: Record<string, unknown> = {}) => ({ status: 200, body: { ok: true, data: { ok: true, ...data } } });
const galat = (kode: string, pesan: string, status: number) => ({ status, body: { error: pesan, kode } });

async function bukaSesi() {
  render(<AdminChatPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
  await screen.findByRole('heading', { name: 'Ani' });
}

beforeEach(() => {
  m.h = buatH();
  m.toast.mockClear();
  m.push.mockClear();
  m.replace.mockClear();
  panggilSesi = [];
  jawabSesi = () => pesanOk();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/chat/sesi')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      panggilSesi.push(body);
      const r = jawabSesi(body);
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => ({ messages: [], status: sesi.status }) };
  }));
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, '', '/admin/chat');
  // Hari kerja (Rabu) agar suite tidak bergantung hari dijalankan: pada Sabtu/Minggu/hari_libur tombol ambil nonaktif.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T10:00:00+07:00'));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('kotak masuk chat', () => {
  it('chat eskalasi yang menunggu tampil paling atas dengan hitungan "menunggu diambil"', async () => {
    siapkan('front_office');
    m.h.rpc = (nama) =>
      nama === 'chat_sesi_ringkas'
        ? {
            data: [
              sesi0({ id: 'bot-1', status: 'bot', layanan_id: 'l3', last_pesan: 'tanya bot' }),
              sesi0({ id: SESI }),
            ],
            error: null,
          }
        : { data: null, error: null };
    render(<AdminChatPage />);
    await screen.findByText(/1 menunggu diambil/);
    const tombol = (await screen.findAllByRole('button', { name: /Helpdesk OSS|Bank Lampung/ })).map((b) => b.textContent);
    expect(tombol[0]).toMatch(/Helpdesk OSS/); // eskalasi di atas meskipun sesi bot lebih dulu di hasil RPC
    expect(tombol[0]).toMatch(/Menunggu Diambil/);
  });

  it('status chat yang sudah diteruskan menunggu petugas layanan diberi label jelas', async () => {
    siapkan('admin', { tahapRows: [tahapFo({ peran_tahap: 'layanan', layanan_id: 'l1' })] });
    render(<AdminChatPage />);
    const item = await screen.findByRole('button', { name: /Helpdesk OSS/ });
    expect(item.textContent).toMatch(/Menunggu Petugas Layanan/);
  });

  it('memuat tahap penanganan chat (saluran chat, menunggu/berjalan) lewat RLS', async () => {
    siapkan('front_office');
    render(<AdminChatPage />);
    await screen.findByRole('button', { name: /Helpdesk OSS/ });
    const kueri = m.h.log.find((l) => l.tabel === 'penanganan')!;
    expect(punyaOp(kueri.ops, 'eq', 'saluran', 'chat')).toBe(true);
    expect(punyaOp(kueri.ops, 'in', 'status', ['menunggu', 'berjalan'])).toBe(true);
  });

  it('tautan dari Kotak Masuk FO (?sesi=) membuka sesi tersebut otomatis', async () => {
    siapkan('front_office');
    window.history.replaceState({}, '', `/admin/chat?sesi=${SESI}`);
    render(<AdminChatPage />);
    expect(await screen.findByRole('heading', { name: 'Ani' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ambil Chat/ })).toBeInTheDocument();
  });
});

describe('tombol aksi per peran dan keadaan', () => {
  it('FO: chat menunggu -> Ambil Chat (tanpa Teruskan/Selesai/Kembalikan ke Bot); kotak balasan nonaktif', async () => {
    siapkan('front_office');
    await bukaSesi();
    expect(screen.getByRole('button', { name: /Ambil Chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Teruskan ke Layanan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Selesaikan Chat/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kembalikan ke Bot/ })).toBeNull();
    expect(screen.getByText(/Tekan "Ambil Chat"/)).toBeInTheDocument();
  });

  it('FO: chat sudah diteruskan ke layanan -> tidak ada tombol Ambil (DB menolak FORBIDDEN)', async () => {
    siapkan('front_office', { tahapRows: [tahapFo({ peran_tahap: 'layanan', layanan_id: 'l1' })] });
    await bukaSesi();
    expect(screen.queryByRole('button', { name: /Ambil Chat/ })).toBeNull();
    expect(screen.getByText(/sudah diteruskan ke petugas layanan/)).toBeInTheDocument();
  });

  it('Admin: chat diteruskan menunggu layanan masih boleh diambil', async () => {
    siapkan('admin', { tahapRows: [tahapFo({ peran_tahap: 'layanan', layanan_id: 'l1' })] });
    await bukaSesi();
    expect(screen.getByRole('button', { name: /Ambil Chat/ })).toBeInTheDocument();
  });

  it('FO pemilik tahap FO: Teruskan ke Layanan + Selesaikan Chat', async () => {
    siapkan('front_office', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ status: 'berjalan', penangan_id: ME })],
    });
    await bukaSesi();
    expect(screen.getByRole('button', { name: /Teruskan ke Layanan/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Selesaikan Chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ambil/ })).toBeNull();
  });

  it('Petugas pemilik tahap layanan: hanya Selesaikan Chat (tanpa Teruskan)', async () => {
    siapkan('petugas', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ peran_tahap: 'layanan', status: 'berjalan', layanan_id: 'l1', penangan_id: ME })],
    });
    await bukaSesi();
    expect(screen.getByRole('button', { name: /Selesaikan Chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Teruskan ke Layanan/ })).toBeNull();
  });

  it('chat dipegang staf lain: petugas/FO tidak punya tombol ambil alih; Admin punya', async () => {
    const dipegang = { sesiRow: sesi0({ status: 'aktif', ditangani_oleh: 'pet-2' }), tahapRows: [tahapFo({ status: 'berjalan', penangan_id: 'pet-2' })] };
    siapkan('front_office', dipegang);
    await bukaSesi();
    expect(screen.queryByRole('button', { name: /Ambil/ })).toBeNull();
    expect(screen.getByText(/sedang ditangani Sari/)).toBeInTheDocument();
    cleanup();

    siapkan('admin', dipegang);
    await bukaSesi();
    expect(screen.getByRole('button', { name: /Ambil Alih Chat/ })).toBeInTheDocument();
  });

  it('sesi selesai tidak punya tombol aksi', async () => {
    siapkan('admin', { sesiRow: sesi0({ status: 'selesai', ditangani_oleh: ME }), tahapRows: [] });
    render(<AdminChatPage />);
    fireEvent.click(await screen.findByLabelText(/Tampilkan sesi selesai/));
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    await screen.findByRole('heading', { name: 'Ani' });
    expect(screen.queryByRole('button', { name: /Ambil|Teruskan|Selesaikan Chat/ })).toBeNull();
  });
});

describe('Ambil Chat', () => {
  it('memanggil /api/chat/sesi aksi takeover tanpa alasan, lalu menyegarkan status', async () => {
    siapkan('petugas');
    await bukaSesi();
    sesi = { ...sesi, status: 'aktif', ditangani_oleh: ME };
    tahap = [tahapFo({ peran_tahap: 'layanan', status: 'berjalan', layanan_id: 'l1', penangan_id: ME })];
    fireEvent.click(screen.getByRole('button', { name: /Ambil Chat/ }));
    await waitFor(() => expect(panggilSesi).toEqual([{ sesi_id: SESI, aksi: 'takeover' }]));
    await waitFor(() => expect(screen.getByText(/Ditangani oleh Anda/)).toBeInTheDocument());
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Chat diambil'), 'success');
  });

  it('SUDAH_DIAMBIL (kalah balapan): pesan ramah (info), daftar dimuat ulang, tombol aktif kembali', async () => {
    siapkan('front_office');
    jawabSesi = () => galat('SUDAH_DIAMBIL', 'Chat ini baru saja diambil staf lain. Daftar dimuat ulang.', 409);
    await bukaSesi();
    const sebelum = m.h.rpcLog.length;
    fireEvent.click(screen.getByRole('button', { name: /Ambil Chat/ }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('baru saja diambil staf lain'), 'info'));
    expect(m.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    await waitFor(() => expect(m.h.rpcLog.length).toBeGreaterThan(sebelum));
    await waitFor(() => expect(screen.getByRole('button', { name: /Ambil Chat/ })).toBeEnabled());
  });

  it('SESI_TIDAK_SAH mengarahkan ke login (pola A2)', async () => {
    siapkan('front_office');
    jawabSesi = () => galat('SESI_TIDAK_SAH', 'Sesi Anda sudah tidak berlaku', 401);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Ambil Chat/ }));
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?alasan=/)));
  });

  it('klik ganda hanya mengirim satu permintaan', async () => {
    siapkan('petugas');
    let selesai: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/chat/sesi')) {
        panggilSesi.push(JSON.parse(String(init?.body)));
        return new Promise((r) => { selesai = () => r({ ok: true, status: 200, json: async () => ({ ok: true, data: { ok: true } }) }); });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ messages: [], status: 'eskalasi' }) });
    }));
    await bukaSesi();
    const tombol = screen.getByRole('button', { name: /Ambil Chat/ });
    fireEvent.click(tombol);
    fireEvent.click(tombol);
    await waitFor(() => expect(tombol).toBeDisabled());
    expect(panggilSesi).toHaveLength(1);
    selesai();
  });
});

describe('hari tanpa pelayanan (Sabtu/Minggu/hari_libur): chat tidak dapat diambil', () => {
  it('hari libur (tabel hari_libur): tombol Ambil Chat nonaktif dengan alasan; klik tidak mengirim permintaan', async () => {
    siapkan('front_office');
    m.h.tabel.hari_libur = { data: [{ tanggal: '2026-10-14', keterangan: 'Cuti bersama' }], error: null };
    await bukaSesi();
    const banner = await screen.findByTestId('admin-chat-hari-tanpa-layanan');
    expect(banner).toHaveTextContent(/hari ini hari libur \(Cuti bersama\)/);
    expect(banner).toHaveTextContent(/ditutup otomatis setelah 24 jam/);
    const tombol = screen.getByRole('button', { name: /Ambil Chat/ });
    await waitFor(() => expect(tombol).toBeDisabled());
    expect(tombol).toHaveAttribute('aria-describedby', 'alasan-hari-tanpa-layanan');
    expect(tombol).toHaveAccessibleDescription(/tidak dapat diambil atau diteruskan/);
    fireEvent.click(tombol);
    expect(panggilSesi).toHaveLength(0);
    // Hari libur dibaca dari tabel hari_libur rentang hari ini (WIB)
    const kueri = m.h.log.find((l) => l.tabel === 'hari_libur')!;
    expect(punyaOp(kueri.ops, 'gte', 'tanggal', '2026-10-14')).toBe(true);
  });

  it('Sabtu: Ambil Alih (Admin) dan Teruskan nonaktif; pemegang chat tetap dapat Selesaikan', async () => {
    vi.setSystemTime(new Date('2026-10-17T10:00:00+07:00')); // Sabtu
    siapkan('admin', { sesiRow: sesi0({ status: 'aktif', ditangani_oleh: 'pet-2' }), tahapRows: [tahapFo({ status: 'berjalan', penangan_id: 'pet-2' })] });
    await bukaSesi();
    expect(await screen.findByTestId('admin-chat-hari-tanpa-layanan')).toHaveTextContent(/hari ini Sabtu/);
    await waitFor(() => expect(screen.getByRole('button', { name: /Ambil Alih Chat/ })).toBeDisabled());
    cleanup();

    siapkan('front_office', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ status: 'berjalan', penangan_id: ME })],
    });
    await bukaSesi();
    await waitFor(() => expect(screen.getByRole('button', { name: /Teruskan ke Layanan/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /Selesaikan Chat/ })).toBeEnabled();
  });

  it('hari kerja: tanpa pemberitahuan, tombol Ambil aktif; galat DB HARI_TANPA_LAYANAN tetap dipetakan ke pesan jelas', async () => {
    siapkan('front_office');
    jawabSesi = () => galat('HARI_TANPA_LAYANAN', 'x', 409);
    await bukaSesi();
    expect(screen.queryByTestId('admin-chat-hari-tanpa-layanan')).toBeNull();
    const tombol = screen.getByRole('button', { name: /Ambil Chat/ });
    expect(tombol).toBeEnabled();
    fireEvent.click(tombol);
    await waitFor(() =>
      expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('hari tanpa pelayanan'), 'error'));
  });
});

describe('Ambil Alih (Admin, alasan wajib)', () => {
  const dipegang = {
    sesiRow: sesi0({ status: 'aktif', ditangani_oleh: 'pet-2' }),
    tahapRows: [tahapFo({ status: 'berjalan', penangan_id: 'pet-2' })],
  };

  it('dialog beralasan: alasan < 5 karakter ditolak sebelum request; alasan sah dikirim', async () => {
    siapkan('admin', dipegang);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Ambil Alih Chat/ }));
    const dialog = await screen.findByRole('dialog', { name: /Ambil alih chat Ani/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(/Sari/)).toBeInTheDocument();
    const alasan = within(dialog).getByLabelText('Alasan ambil alih');
    expect(alasan).toHaveFocus();

    fireEvent.change(alasan, { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ambil alih chat' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Alasan ambil alih wajib/);
    expect(panggilSesi).toHaveLength(0);

    fireEvent.change(alasan, { target: { value: '  Petugas sedang cuti  ' } });
    sesi = { ...sesi, ditangani_oleh: ME };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ambil alih chat' }));
    await waitFor(() => expect(panggilSesi).toEqual([{ sesi_id: SESI, aksi: 'takeover', alasan: 'Petugas sedang cuti' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('diambil alih'), 'success');
  });

  it('galat server ALASAN_WAJIB tampil inline di dalam dialog (tetap terbuka)', async () => {
    siapkan('admin', dipegang);
    jawabSesi = () => galat('ALASAN_WAJIB', 'x', 422);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Ambil Alih Chat/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Alasan ambil alih'), { target: { value: 'alasan cukup panjang' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ambil alih chat' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Alasan ambil alih wajib/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape menutup dialog tanpa mengirim', async () => {
    siapkan('admin', dipegang);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Ambil Alih Chat/ }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(panggilSesi).toHaveLength(0);
  });
});

describe('Teruskan ke Layanan (FO)', () => {
  const milikFo = {
    sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
    tahapRows: [tahapFo({ status: 'berjalan', penangan_id: ME })],
  };

  async function bukaDialog() {
    siapkan('front_office', milikFo);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Teruskan ke Layanan/ }));
    return screen.findByRole('dialog', { name: /Teruskan chat Ani/ });
  }

  it('pilihan layanan hanya yang aktif dan punya_chat; topik FO; layanan sesi dipra-pilih; fokus awal ke layanan', async () => {
    const dialog = await bukaDialog();
    const layanan = within(dialog).getByLabelText('Layanan tujuan') as HTMLSelectElement;
    expect(layanan).toHaveFocus();
    expect(layanan.value).toBe('l1'); // layanan sesi saat ini
    const opsi = Array.from(layanan.options).map((o) => o.textContent);
    expect(opsi).toEqual(['Pilih layanan…', 'Helpdesk OSS', 'Bank Lampung']);
    const topik = within(dialog).getByLabelText('Topik') as HTMLSelectElement;
    expect(Array.from(topik.options).map((o) => o.textContent)).toEqual(['Pilih topik…', 'Informasi umum', 'Arahan layanan']);
    expect(within(dialog).getByText('0/200')).toBeInTheDocument();
  });

  it('topik & catatan wajib: pesan inline, tanpa request', async () => {
    const dialog = await bukaDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Teruskan chat' }));
    expect(await within(dialog).findByText('Topik wajib dipilih.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 'tf-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Teruskan chat' }));
    expect(await within(dialog).findByText('Catatan wajib diisi.')).toBeInTheDocument();
    expect(panggilSesi).toHaveLength(0);
  });

  it('sukses: kirim layanan/topik/catatan; petugas_hadir=false memunculkan peringatan (bukan galat)', async () => {
    jawabSesi = () => pesanOk({ layanan_nama: 'Bank Lampung', petugas_hadir: false, notifikasi_diantrekan: 0 });
    const dialog = await bukaDialog();
    fireEvent.change(within(dialog).getByLabelText('Layanan tujuan'), { target: { value: 'l3' } });
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 'tf-2' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'Tanya kredit UMKM' } });
    sesi = { ...sesi, status: 'eskalasi', ditangani_oleh: null, layanan_id: 'l3' };
    tahap = [tahapFo({ peran_tahap: 'layanan', layanan_id: 'l3' })];
    fireEvent.click(within(dialog).getByRole('button', { name: 'Teruskan chat' }));

    await waitFor(() =>
      expect(panggilSesi).toEqual([
        { sesi_id: SESI, aksi: 'teruskan', layanan_id: 'l3', topik_id: 'tf-2', catatan: 'Tanya kredit UMKM' },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(/belum ada petugas layanan itu yang hadir hari ini/)).toBeInTheDocument();
    expect(m.toast).toHaveBeenCalledWith('Chat diteruskan ke Bank Lampung.', 'success');
    expect(m.toast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('LAYANAN_TIDAK_VALID dari server tampil di bawah pilihan layanan; BUKAN_PEMILIK tampil umum + muat ulang', async () => {
    jawabSesi = () => galat('LAYANAN_TIDAK_VALID', 'x', 422);
    const dialog = await bukaDialog();
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 'tf-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'catatan' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Teruskan chat' }));
    expect(await within(dialog).findByText(/Layanan tujuan tidak dapat dipakai/)).toBeInTheDocument();

    jawabSesi = () => galat('BUKAN_PEMILIK', 'x', 403);
    const sebelum = m.h.rpcLog.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Teruskan chat' }));
    expect(await within(dialog).findByText(/dipegang staf lain/)).toBeInTheDocument();
    await waitFor(() => expect(m.h.rpcLog.length).toBeGreaterThan(sebelum));
  });
});

describe('Selesaikan Chat', () => {
  it('tahap FO: topik FO + catatan maks 200; kirim aksi selesaikan', async () => {
    siapkan('front_office', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ status: 'berjalan', penangan_id: ME })],
    });
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Chat/ }));
    const dialog = await screen.findByRole('dialog', { name: /Selesaikan chat Ani/ });
    expect(within(dialog).getByLabelText('Topik')).toHaveFocus();
    expect(within(dialog).getByLabelText('Catatan singkat')).toHaveAttribute('maxlength', '200');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesaikan chat' }));
    expect(await within(dialog).findByText('Topik wajib dipilih.')).toBeInTheDocument();
    expect(panggilSesi).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 'tf-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'Sudah dijawab' } });
    sesi = { ...sesi, status: 'selesai' };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() =>
      expect(panggilSesi).toEqual([{ sesi_id: SESI, aksi: 'selesaikan', topik_id: 'tf-1', catatan: 'Sudah dijawab' }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.toast).toHaveBeenCalledWith('Sesi chat diselesaikan.', 'success');
  });

  it('tahap layanan: topik milik layanan tahap itu + catatan maks 1000', async () => {
    siapkan('petugas', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ peran_tahap: 'layanan', status: 'berjalan', layanan_id: 'l1', penangan_id: ME })],
    });
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Chat/ }));
    const dialog = await screen.findByRole('dialog', { name: /Selesaikan chat Ani/ });
    await within(dialog).findByRole('option', { name: 'Konsultasi NIB' });
    const kueriTopik = m.h.log.filter((l) => l.tabel === 'topik_penanganan').at(-1)!;
    expect(punyaOp(kueriTopik.ops, 'eq', 'layanan_id', 'l1')).toBe(true);
    expect(within(dialog).getByLabelText(/Catatan penanganan/)).toHaveAttribute('maxlength', '1000');
    await waitFor(() => expect(within(dialog).getByLabelText(/Topik penanganan/)).toHaveFocus());

    fireEvent.change(within(dialog).getByLabelText(/Topik penanganan/), { target: { value: 'tl-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Catatan penanganan/), { target: { value: 'Konsultasi NIB selesai' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesaikan chat' }));
    await waitFor(() =>
      expect(panggilSesi).toEqual([{ sesi_id: SESI, aksi: 'selesaikan', topik_id: 'tl-1', catatan: 'Konsultasi NIB selesai' }]),
    );
  });

  it('galat BUKAN_PEMILIK / INVALID_STATUS tampil umum di dialog dan memuat ulang daftar', async () => {
    siapkan('front_office', {
      sesiRow: sesi0({ status: 'aktif', ditangani_oleh: ME }),
      tahapRows: [tahapFo({ status: 'berjalan', penangan_id: ME })],
    });
    jawabSesi = () => galat('INVALID_STATUS', 'x', 409);
    await bukaSesi();
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Chat/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Topik'), { target: { value: 'tf-1' } });
    fireEvent.change(within(dialog).getByLabelText('Catatan singkat'), { target: { value: 'ok' } });
    const sebelum = m.h.rpcLog.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesaikan chat' }));
    expect(await within(dialog).findByText(/Status chat sudah berubah/)).toBeInTheDocument();
    await waitFor(() => expect(m.h.rpcLog.length).toBeGreaterThan(sebelum));
  });
});
