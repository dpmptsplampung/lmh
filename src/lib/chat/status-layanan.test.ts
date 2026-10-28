import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  muatStatusLayananChat, parseStatusLayanan, teksBotLuarJam, teksBukaBerikutnya, teksPetugasTidakTersedia, TEKS_MENUNGGU_PETUGAS,
} from './status-layanan';

const wib = (iso: string) => new Date(`${iso}+07:00`);
const LID = '11111111-1111-4111-8111-111111111111';

function klien(rpc: unknown, libur: unknown[] = []) {
  return {
    rpc: vi.fn(async () => rpc),
    from: vi.fn(() => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lte', 'in']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: libur, error: null }).then(res);
      return b;
    }),
  } as unknown as SupabaseClient;
}

const RPC_OK = {
  ada: true, buka: false, tanggal: '2026-10-31', hari_tanpa_layanan: true, libur_keterangan: null,
  buka_berikutnya_tanggal: '2026-11-02', buka_berikutnya_jam: '08:00',
};

describe('parseStatusLayanan', () => {
  it('menerima objek RPC lengkap', () => {
    expect(parseStatusLayanan(RPC_OK)).toEqual({
      buka: false, tanggal: '2026-10-31', liburKeterangan: null, hariTanpaLayanan: true,
      bukaBerikutnya: { tanggal: '2026-11-02', jam: '08:00' }, sumber: 'jadwal',
    });
  });
  it.each([[[]], [null], ['x'], [{ buka: 'ya' }], [{ ada: false, buka: false }]])('menolak %j', (v) => {
    expect(parseStatusLayanan(v)).toBeNull();
  });
});

describe('muatStatusLayananChat', () => {
  it('memakai RPC bila tersedia', async () => {
    const s = await muatStatusLayananChat(klien({ data: RPC_OK, error: null }), LID, wib('2026-10-31T10:00:00'));
    expect(s.sumber).toBe('jadwal');
    expect(s.buka).toBe(false);
  });
  it('RPC belum ada -> kalender global lama: Sabtu tutup, Rabu 10:00 buka, Rabu 16:30 tutup', async () => {
    const galat = { data: null, error: { code: 'PGRST202', message: 'x' } };
    const sabtu = await muatStatusLayananChat(klien(galat), LID, wib('2026-10-17T10:00:00'));
    expect(sabtu).toMatchObject({ sumber: 'kalender_global', buka: false, hariTanpaLayanan: true });
    const rabuPagi = await muatStatusLayananChat(klien(galat), LID, wib('2026-10-14T10:00:00'));
    expect(rabuPagi).toMatchObject({ sumber: 'kalender_global', buka: true });
    const rabuSore = await muatStatusLayananChat(klien(galat), LID, wib('2026-10-14T16:30:00'));
    expect(rabuSore).toMatchObject({ sumber: 'kalender_global', buka: false, hariTanpaLayanan: false });
  });
  it('RPC mengembalikan array (tiruan lama) -> kalender global; tidak pernah melempar', async () => {
    const s = await muatStatusLayananChat(klien({ data: [], error: null }), LID, wib('2026-10-14T10:00:00'));
    expect(s.sumber).toBe('kalender_global');
    const lempar = {
      rpc: () => { throw new Error('boom'); },
      from: () => { throw new Error('boom'); },
    } as unknown as SupabaseClient;
    await expect(muatStatusLayananChat(lempar, LID, wib('2026-10-14T10:00:00'))).resolves.toMatchObject({ sumber: 'kalender_global' });
  });
});

describe('teks', () => {
  const dasar = { buka: false, tanggal: '2026-10-31', liburKeterangan: null, hariTanpaLayanan: true, sumber: 'jadwal' as const };
  it('TEKS_MENUNGGU_PETUGAS persis spec', () => {
    expect(TEKS_MENUNGGU_PETUGAS).toBe('Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.');
  });
  it('teksBukaBerikutnya', () => {
    expect(teksBukaBerikutnya({ ...dasar, bukaBerikutnya: { tanggal: '2026-11-02', jam: '08:00' } })).toBe(
      'Senin, 2 November 2026 pukul 08.00 WIB',
    );
    expect(teksBukaBerikutnya({ ...dasar, bukaBerikutnya: { tanggal: '2026-10-31', jam: '08:00' } })).toBe('hari ini pukul 08.00 WIB');
    expect(teksBukaBerikutnya({ ...dasar, bukaBerikutnya: null })).toBe('pada jam kerja berikutnya');
  });
  it('teksPetugasTidakTersedia memuat nama layanan, bot, dan jam kerja', () => {
    const t = teksPetugasTidakTersedia('Bank Lampung', { ...dasar, bukaBerikutnya: { tanggal: '2026-11-02', jam: '08:00' } });
    expect(t).toContain('Petugas Bank Lampung');
    expect(t).toContain('Senin, 2 November 2026 pukul 08.00 WIB');
    expect(t).toContain('asisten virtual');
    expect(t).toContain('Hubungkan ke Petugas');
  });
  it('teksBotLuarJam menyebut jam kerja dan tidak lagi mengatakan tidak diteruskan', () => {
    const t = teksBotLuarJam({ ...dasar, bukaBerikutnya: null }, 'ai_error');
    expect(t).toContain('belum dapat menjawab');
    expect(t).not.toContain('tidak diteruskan');
    expect(teksBotLuarJam({ ...dasar, bukaBerikutnya: null }, 'prompt_injection')).toContain('instruksi yang tidak diizinkan');
  });
});
