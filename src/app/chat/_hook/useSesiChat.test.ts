// @vitest-environment jsdom
// Kontrak useSesiChat (tugas 6.3): persetujuan dicatat SEBELUM sesi dibuat dan memblokirnya bila gagal, percakapan yang
// ada dibuka tanpa persetujuan baru, pastikanSesi membuka sesi baru hanya bila tidak ada sesi terbuka, keputusan
// tampilan awal dari ?layanan=, dan meninggalkan percakapan membatalkan riwayat. Juga cermin sinkron useMesinChat.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const data = vi.hoisted(() => ({ pengguna: vi.fn(), consent: vi.fn(), sesi: vi.fn(), urutan: [] as string[] }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  ambilPenggunaChat: data.pengguna,
  catatPersetujuan: data.consent,
  buatSesiChat: data.sesi,
}));

import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import type { LayananChat } from '@/lib/data/chat-pengunjung';
import { MutasiError } from '@/lib/supabase/mutate';
import { TEKS_OFFLINE } from '../_logika/turunan';
import { useMesinChat } from './useMesinChat';
import { useSesiChat, type PersetujuanChat } from './useSesiChat';

const L = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const LAYANAN: LayananChat[] = [
  { id: L, nama: 'Bank Lampung', chatbot_aktif: true },
  { id: L2, nama: 'BPJS', chatbot_aktif: false },
];
const SETUJU: PersetujuanChat = { tujuan: 'chat_followup', disetujui: true, versi_kebijakan: '1.0' };
const percakapan = (over: Partial<PercakapanRingkas> = {}) =>
  ({ layananId: L, sesiTerakhirId: 's-lama', sesiTerbukaId: null, statusTerakhir: 'selesai', ...over }) as PercakapanRingkas;

function pasang(opsi: { pengunjungId?: string | null; daring?: boolean } = {}) {
  const pesan = { ganti: vi.fn(), muatRiwayatAwal: vi.fn(async () => undefined), tinggalkan: vi.fn() };
  const muatFaq = vi.fn(async () => undefined);
  const dibuka = vi.fn();
  const r = renderHook(() => {
    const mesin = useMesinChat();
    const sesi = useSesiChat({
      mesin,
      pesan,
      layanan: LAYANAN,
      muatFaq,
      pengunjungId: opsi.pengunjungId === undefined ? 'peng-1' : opsi.pengunjungId,
      namaPengunjung: '  Budi ',
      daring: opsi.daring ?? true,
      onPercakapanDibuka: dibuka,
    });
    return { mesin, sesi };
  });
  const pilih = (id: string) => act(() => r.result.current.sesi.pilihLayanan(id));
  return { r, pesan, muatFaq, dibuka, pilih };
}

beforeEach(() => {
  data.urutan.length = 0;
  data.pengguna.mockReset().mockResolvedValue({ data: { id: 'auth-1' }, error: null });
  data.consent.mockReset().mockImplementation(async () => {
    data.urutan.push('consent');
    return { data: true, error: null };
  });
  data.sesi.mockReset().mockImplementation(async () => {
    data.urutan.push('sesi');
    return { data: { id: 'sesi-baru', status: 'bot' }, error: null };
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('useSesiChat: mulai percakapan baru', () => {
  it('persetujuan dicatat lalu sesi dibuat; percakapan terbuka dengan sambutan dan FAQ', async () => {
    const { r, pesan, muatFaq, pilih } = pasang();
    pilih(L);
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(data.urutan).toEqual(['consent', 'sesi']);
    expect(data.consent.mock.calls[0][1]).toEqual({ subjek_ref: 'peng-1', ...SETUJU });
    expect(data.sesi.mock.calls[0][1]).toEqual({ layananId: L, kontak: 'Budi', chatbotAktif: true, pengunjungId: 'peng-1' });
    expect(r.result.current.mesin.keadaan).toMatchObject({ tampilan: 'percakapan', sesiId: 'sesi-baru', sesiLayananId: L, memulai: false });
    expect(pesan.ganti.mock.calls[0][0][0]).toMatchObject({ id: 'welcome', local: 'notice' });
    expect(pesan.ganti.mock.calls[0][0][0].isi).toContain('Halo Bapak/Ibu Budi.');
    expect(muatFaq).toHaveBeenCalledWith(L);
    expect(localStorage.getItem(`lmh_chat_dibaca_${L}`)).not.toBeNull();
  });

  it('tanpa persetujuan / tanpa Layanan: tidak ada yang dicatat', async () => {
    const { r, pilih } = pasang();
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    pilih(L);
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: null, ada: undefined }));
    expect(data.consent).not.toHaveBeenCalled();
    expect(r.result.current.mesin.keadaan.memulai).toBe(false);
  });

  it('percakapan yang sudah ada dibuka tanpa persetujuan baru', async () => {
    const { r, pesan, dibuka, pilih } = pasang();
    pilih(L);
    const ada = percakapan({ sesiTerbukaId: 's-1', statusTerakhir: 'bot' });
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: null, ada }));
    expect(data.consent).not.toHaveBeenCalled();
    expect(dibuka).toHaveBeenCalled();
    expect(pesan.muatRiwayatAwal).toHaveBeenCalledWith(ada);
    expect(r.result.current.mesin.keadaan).toMatchObject({ tampilan: 'percakapan', sesiId: 's-1', status: 'bot' });
  });

  it('offline: galat formulir, tanpa pencatatan', async () => {
    const { r, pilih } = pasang({ daring: false });
    pilih(L);
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(r.result.current.mesin.keadaan.galat.setup).toBe(TEKS_OFFLINE);
    expect(data.pengguna).not.toHaveBeenCalled();
  });

  it('persetujuan gagal karena jaringan: pesan menyebut koneksi, sesi TIDAK dibuat; selain jaringan tanpa kata koneksi', async () => {
    const { r, pilih } = pasang();
    pilih(L);
    data.consent.mockResolvedValueOnce({ data: null, error: { jenis: 'jaringan', pesan: '', asli: null } });
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(r.result.current.mesin.keadaan.galat.consent).toMatch(/koneksi/);
    expect(data.sesi).not.toHaveBeenCalled();
    data.consent.mockResolvedValueOnce({ data: null, error: { jenis: 'ditolak', pesan: '', asli: null } });
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(r.result.current.mesin.keadaan.galat.consent).not.toMatch(/koneksi/);
    act(() => r.result.current.sesi.hapusGalatConsent());
    expect(r.result.current.mesin.keadaan.galat.consent).toBe('');
  });

  it('tanpa baris pengunjung: subjek = auth.uid; tanpa keduanya: akun tak dikenali', async () => {
    const { r, pilih } = pasang({ pengunjungId: null });
    pilih(L);
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(data.consent.mock.calls[0][1].subjek_ref).toBe('auth-1');
    expect(data.sesi.mock.calls[0][1].pengunjungId).toBeNull();

    data.pengguna.mockResolvedValueOnce({ data: null, error: null });
    data.consent.mockClear();
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(r.result.current.mesin.keadaan.galat.consent).toMatch(/tidak dapat dikenali/);
    expect(data.consent).not.toHaveBeenCalled();
  });

  it('sesi gagal dibuat: galat formulir memakai pesan MutasiError', async () => {
    const { r, pilih } = pasang();
    pilih(L2);
    const e = new MutasiError('jaringan');
    data.sesi.mockResolvedValueOnce({ data: null, error: { jenis: 'jaringan', pesan: e.pesan, asli: e } });
    await act(() => r.result.current.sesi.mulaiSesi({ persetujuan: SETUJU, ada: undefined }));
    expect(r.result.current.mesin.keadaan.galat.setup).toBe(`Gagal memulai sesi chat. ${e.pesan}`);
    expect(r.result.current.mesin.keadaan.tampilan).toBe('awal');
  });
});

describe('useSesiChat: sesi terbuka untuk pesan berikutnya', () => {
  it('sesi terbuka dipakai; sesi selesai -> sesi baru (cermin mesin langsung terbarui); Layanan hilang -> galat', async () => {
    const { r } = pasang();
    act(() => r.result.current.sesi.bukaPercakapan(percakapan({ sesiTerbukaId: 's-1', statusTerakhir: 'aktif' })));
    expect(await r.result.current.sesi.pastikanSesi()).toEqual({ data: 's-1', error: null });
    expect(data.sesi).not.toHaveBeenCalled();

    act(() => r.result.current.mesin.kirim({ jenis: 'status', status: 'selesai' }));
    let h!: Awaited<ReturnType<typeof r.result.current.sesi.pastikanSesi>>;
    await act(async () => {
      h = await r.result.current.sesi.pastikanSesi();
      expect(r.result.current.mesin.ref.current.sesiId).toBe('sesi-baru'); // sebelum render berikutnya
    });
    expect(h).toEqual({ data: 'sesi-baru', error: null });
    expect(r.result.current.mesin.keadaan).toMatchObject({ sesiId: 'sesi-baru', status: 'bot' });

    act(() => r.result.current.sesi.bukaPercakapan(percakapan({ layananId: 'arsip' })));
    expect((await r.result.current.sesi.pastikanSesi()).error?.jenis).toBe('database');
  });
});

describe('useSesiChat: tampilan awal dan meninggalkan percakapan', () => {
  it('?layanan= yang punya percakapan dibuka; tanpa parameter daftar; gagal muat -> daftar', () => {
    window.history.pushState({}, '', `/chat?layanan=${L}`);
    const a = pasang();
    act(() => a.r.result.current.sesi.putuskanAwal([percakapan({ sesiTerbukaId: 's-1', statusTerakhir: 'bot' })]));
    expect(a.r.result.current.mesin.keadaan).toMatchObject({ tampilan: 'percakapan', sesiId: 's-1' });
    cleanup();

    window.history.pushState({}, '', '/chat');
    const b = pasang();
    act(() => b.r.result.current.sesi.putuskanAwal([percakapan()]));
    expect(b.r.result.current.mesin.keadaan.tampilan).toBe('daftar');
    const c = pasang();
    act(() => c.r.result.current.sesi.putuskanAwal(null));
    expect(c.r.result.current.mesin.keadaan.tampilan).toBe('daftar');
  });

  it('kembali: riwayat ditinggalkan, generasi naik, penanda dibaca ditulis', () => {
    const { r, pesan } = pasang();
    act(() => r.result.current.sesi.bukaPercakapan(percakapan({ sesiTerbukaId: 's-1', statusTerakhir: 'bot' })));
    localStorage.clear();
    const generasi = r.result.current.mesin.keadaan.generasi;
    act(() => r.result.current.sesi.kembali());
    expect(pesan.tinggalkan).toHaveBeenCalled();
    expect(r.result.current.mesin.keadaan).toMatchObject({ tampilan: 'daftar', generasi: generasi + 1 });
    expect(localStorage.getItem(`lmh_chat_dibaca_${L}`)).not.toBeNull();
  });

  it('?layanan= memilih Layanan di formulir', async () => {
    window.history.pushState({}, '', '/chat?layanan=bpjs');
    const { r } = pasang();
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 0));
    });
    expect(r.result.current.mesin.keadaan.layananId).toBe(L2);
  });
});
