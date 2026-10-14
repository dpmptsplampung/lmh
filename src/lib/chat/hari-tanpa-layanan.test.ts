import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  muatInfoHariLayanan, sebabHariTanpaLayanan, teksBotTanpaPetugas, teksKanal, teksPemberitahuanChat,
} from './hari-tanpa-layanan';

const wib = (iso: string) => new Date(`${iso}+07:00`);

function klien(opsi: { libur?: unknown; liburGalat?: boolean; kanal?: unknown; lempar?: boolean } = {}) {
  const from = vi.fn((tabel: string) => {
    if (opsi.lempar) throw new Error('boom');
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'gte', 'lte', 'in']) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(
        tabel === 'hari_libur'
          ? opsi.liburGalat ? { data: null, error: { message: 'x' } } : { data: opsi.libur ?? [], error: null }
          : { data: opsi.kanal ?? [], error: null },
      ).then(res);
    return b;
  });
  return { from } as unknown as SupabaseClient & { from: typeof from };
}

describe('muatInfoHariLayanan', () => {
  it('hari kerja: alasan null, tanpa membaca kanal', async () => {
    const k = klien();
    const info = await muatInfoHariLayanan(k, wib('2026-10-14T10:00:00'));
    expect(info).toMatchObject({ tanggal: '2026-10-14', alasan: null, kerjaBerikutnya: null, kanal: { wa: null, email: null } });
    expect(k.from).not.toHaveBeenCalledWith('site_settings');
  });

  it('Sabtu: akhir_pekan, hari kerja berikutnya melewati hari libur, kanal dari site_settings', async () => {
    const k = klien({
      libur: [{ tanggal: '2026-10-19', keterangan: 'Libur' }],
      kanal: [{ key: 'wa_number', value: ' 0812 ' }, { key: 'contact_email', value: '' }],
    });
    const info = await muatInfoHariLayanan(k, wib('2026-10-17T23:30:00'));
    expect(info).toMatchObject({ alasan: 'akhir_pekan', kerjaBerikutnya: '2026-10-20', kanal: { wa: '0812', email: null } });
  });

  it('hari libur: libur_nasional + keterangan; opsi kanal:false tidak membaca site_settings', async () => {
    const k = klien({ libur: [{ tanggal: '2026-10-14', keterangan: 'Cuti bersama' }] });
    const info = await muatInfoHariLayanan(k, wib('2026-10-14T08:00:00'), { kanal: false });
    expect(info).toMatchObject({ alasan: 'libur_nasional', keteranganLibur: 'Cuti bersama', kerjaBerikutnya: '2026-10-15' });
    expect(k.from).not.toHaveBeenCalledWith('site_settings');
  });

  it('batas hari WIB: Jumat 23:30 WIB = Jumat (bukan Sabtu), Sabtu 00:30 WIB = Sabtu', async () => {
    expect((await muatInfoHariLayanan(klien(), wib('2026-10-16T23:30:00'))).alasan).toBeNull();
    expect((await muatInfoHariLayanan(klien(), wib('2026-10-17T00:30:00'))).alasan).toBe('akhir_pekan');
  });

  it('tahan galat: galat baca hari_libur / klien melempar -> tidak melempar (akhir pekan tetap terdeteksi)', async () => {
    expect((await muatInfoHariLayanan(klien({ liburGalat: true }), wib('2026-10-14T10:00:00'))).alasan).toBeNull();
    const info = await muatInfoHariLayanan(klien({ lempar: true }), wib('2026-10-18T10:00:00'));
    expect(info.alasan).toBe('akhir_pekan');
    expect(info.kanal).toEqual({ wa: null, email: null });
  });
});

describe('teks pemberitahuan', () => {
  const sabtu = {
    tanggal: '2026-10-17', alasan: 'akhir_pekan' as const, keteranganLibur: null, kerjaBerikutnya: '2026-10-19',
    kanal: { wa: '0812', email: 'a@b.go.id' },
  };
  it('sebab: nama hari / hari libur (+keterangan)', () => {
    expect(sebabHariTanpaLayanan(sabtu)).toBe('hari ini Sabtu');
    expect(sebabHariTanpaLayanan({ ...sabtu, alasan: 'libur_nasional', keteranganLibur: 'Natal' })).toBe('hari ini hari libur (Natal)');
    expect(sebabHariTanpaLayanan({ ...sabtu, alasan: 'libur_nasional' })).toBe('hari ini hari libur');
  });
  it('kanal hanya disebut bila terisi', () => {
    expect(teksKanal({ wa: null, email: null })).toBe('');
    expect(teksKanal({ wa: null, email: 'a@b' })).toBe(' atau melalui email a@b');
  });
  it('pemberitahuan /chat dan balasan bot: bot saja, tidak diteruskan ke petugas, hari kerja berikutnya', () => {
    expect(teksPemberitahuanChat(sabtu)).toBe(
      'Live chat dengan petugas tidak tersedia karena hari ini Sabtu. Anda hanya dapat bertanya kepada asisten virtual (bot); '
      + 'pertanyaan tidak diteruskan ke petugas. Petugas melayani kembali pada Senin, 19 Oktober 2026 atau melalui WhatsApp 0812 / email a@b.go.id.');
    expect(teksBotTanpaPetugas(sabtu)).toMatch(/^Maaf, asisten virtual belum dapat menjawab/);
    expect(teksBotTanpaPetugas(sabtu, 'prompt_injection')).toMatch(/instruksi yang tidak diizinkan/);
    expect(teksBotTanpaPetugas(sabtu)).toContain('tidak diteruskan ke petugas. Silakan hubungi kami kembali pada Senin, 19 Oktober 2026');
  });
});
