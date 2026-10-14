// Live chat pada HARI TANPA PELAYANAN (keputusan CEO 2026-10-14): Sabtu, Minggu, dan tanggal di tabel hari_libur
// (pengaturan Admin). Pada hari itu live chat dengan petugas TIDAK tersedia: pengunjung hanya tanya-jawab dengan bot,
// /api/chat/ai tidak mengeskalasi, dan staf tidak dapat mengambil chat (DB: chat_ambil/chat_teruskan menolak
// HARI_TANPA_LAYANAN; trigger eskalasi tidak membuat kunjungan; lihat 202610140012 bagian 11).
//
// Aturan hari = public.hari_tanpa_layanan(date) di DB = hariTanpaLayanan() di lib/llm/bot-waktu.ts (satu aturan).
// Modul ini dipakai halaman /chat, /admin/chat, dan route /api/chat/ai (client Supabase apa pun: pengguna/service).
// Teks pemberitahuan tetap di kode (tanpa UI pengaturan baru); kanal kontak diambil dari site_settings yang sudah
// dikelola Admin di Pengaturan (wa_number, contact_email) dan hanya disebut bila terisi.
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDaysWIB, toWIBDateString } from '@/lib/time';
import { hariKerjaBerikutnya, hariTanpaLayanan, labelTanggalID, type AlasanTanpaLayanan } from '@/lib/llm/bot-waktu';

export interface KanalKontak {
  wa: string | null;
  email: string | null;
}

export interface InfoHariLayanan {
  /** Tanggal WIB yang dinilai (YYYY-MM-DD). */
  tanggal: string;
  /** null = hari pelayanan (live chat dengan petugas tersedia sesuai jam kerja). */
  alasan: AlasanTanpaLayanan | null;
  /** Keterangan hari libur (tabel hari_libur) bila alasan = libur_nasional. */
  keteranganLibur: string | null;
  /** Hari kerja berikutnya (YYYY-MM-DD), hanya bila alasan terisi. */
  kerjaBerikutnya: string | null;
  kanal: KanalKontak;
}

const kosong = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Menilai hari ini (WIB) dari tabel hari_libur + akhir pekan, dan membaca kanal kontak dari site_settings.
 * Tahan galat: gagal membaca hari_libur = dianggap tidak libur (akhir pekan tetap terdeteksi); gagal membaca
 * site_settings = tanpa kanal. Tidak pernah melempar. DB tetap penegak (fungsi hari_tanpa_layanan).
 */
export async function muatInfoHariLayanan(
  supabase: SupabaseClient,
  now: Date = new Date(),
  opsi: { kanal?: boolean } = {},
): Promise<InfoHariLayanan> {
  const tanggal = toWIBDateString(now);
  const libur = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('hari_libur')
      .select('tanggal, keterangan')
      .gte('tanggal', tanggal)
      .lte('tanggal', addDaysWIB(60, now));
    if (!error) {
      for (const r of (data ?? []) as Array<{ tanggal: string; keterangan?: string | null }>) {
        libur.set(r.tanggal, r.keterangan ?? '');
      }
    }
  } catch {
    /* anggap tidak ada libur */
  }
  const setLibur = new Set(libur.keys());
  const alasan = hariTanpaLayanan(tanggal, setLibur);

  const kanal: KanalKontak = { wa: null, email: null };
  if (alasan && opsi.kanal !== false) {
    try {
      const { data, error } = await supabase
        .from('site_settings')
        .select('key, value')
        .in('key', ['wa_number', 'contact_email']);
      if (!error) {
        for (const r of (data ?? []) as Array<{ key: string; value: string | null }>) {
          if (r.key === 'wa_number') kanal.wa = kosong(r.value);
          if (r.key === 'contact_email') kanal.email = kosong(r.value);
        }
      }
    } catch {
      /* tanpa kanal */
    }
  }

  return {
    tanggal,
    alasan,
    keteranganLibur: alasan === 'libur_nasional' ? kosong(libur.get(tanggal)) : null,
    kerjaBerikutnya: alasan ? hariKerjaBerikutnya(tanggal, setLibur) : null,
    kanal,
  };
}

/** "hari ini Sabtu" / "hari ini hari libur (Hari Kemerdekaan)". */
export function sebabHariTanpaLayanan(info: Pick<InfoHariLayanan, 'alasan' | 'tanggal' | 'keteranganLibur'>): string {
  if (info.alasan === 'libur_nasional') {
    return info.keteranganLibur ? `hari ini hari libur (${info.keteranganLibur})` : 'hari ini hari libur';
  }
  const hari = labelTanggalID(info.tanggal).split(',')[0];
  return `hari ini ${hari}`;
}

const sampai = (info: Pick<InfoHariLayanan, 'kerjaBerikutnya'>) =>
  info.kerjaBerikutnya ? labelTanggalID(info.kerjaBerikutnya) : 'hari kerja berikutnya';

/** " atau melalui WhatsApp 08xx / email x@y" (kosong bila tidak ada kanal di pengaturan). */
export function teksKanal(kanal: KanalKontak): string {
  const bagian = [kanal.wa ? `WhatsApp ${kanal.wa}` : null, kanal.email ? `email ${kanal.email}` : null].filter(Boolean);
  return bagian.length > 0 ? ` atau melalui ${bagian.join(' / ')}` : '';
}

/** Pemberitahuan di /chat (layar awal & selama sesi). */
export function teksPemberitahuanChat(info: InfoHariLayanan): string {
  return (
    `Live chat dengan petugas tidak tersedia karena ${sebabHariTanpaLayanan(info)}. ` +
    'Anda hanya dapat bertanya kepada asisten virtual (bot); pertanyaan tidak diteruskan ke petugas. ' +
    `Petugas melayani kembali pada ${sampai(info)}${teksKanal(info.kanal)}.`
  );
}

/** Balasan bot ketika asisten tidak dapat menjawab pada hari tanpa pelayanan (pengganti eskalasi). */
export function teksBotTanpaPetugas(info: InfoHariLayanan, sebabBot?: 'prompt_injection' | 'ai_error'): string {
  const awal = sebabBot === 'prompt_injection'
    ? 'Maaf, pertanyaan Anda mengandung instruksi yang tidak diizinkan sehingga tidak dapat saya jawab.'
    : 'Maaf, asisten virtual belum dapat menjawab pertanyaan Anda saat ini.';
  return (
    `${awal} Live chat dengan petugas tidak tersedia karena ${sebabHariTanpaLayanan(info)}, ` +
    `jadi pertanyaan Anda tidak diteruskan ke petugas. Silakan hubungi kami kembali pada ${sampai(info)}${teksKanal(info.kanal)}.`
  );
}
