// Status "petugas chat tersedia?" per Layanan (Fase 5). Keputusan ada di DB (chat_layanan_status = jadwal Layanan
// is_layanan_buka_jadwal + bukan hari tanpa pelayanan). Modul ini memuat hasilnya dan menyusun teks pengunjung.
// Sebelum migrasi 202610310002 diterapkan: turun ke kalender global lama (Sabtu/Minggu/hari_libur + tutup 16:00 WIB).
import type { SupabaseClient } from '@supabase/supabase-js';
import { muatInfoHariLayanan } from '@/lib/chat/hari-tanpa-layanan';
import { labelTanggalID } from '@/lib/llm/bot-waktu';
import { menitWIB, toWIBDateString } from '@/lib/time';

export interface StatusLayananChat {
  buka: boolean;
  /** Tanggal WIB yang dinilai (YYYY-MM-DD). */
  tanggal: string;
  liburKeterangan: string | null;
  hariTanpaLayanan: boolean;
  bukaBerikutnya: { tanggal: string; jam: string } | null;
  sumber: 'jadwal' | 'kalender_global';
}

export const TEKS_MENUNGGU_PETUGAS = 'Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.';

const JAM_TUTUP_LAMA_MENIT = 16 * 60;
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Objek jsonb chat_layanan_status -> StatusLayananChat; bentuk lain (array, null, layanan tak ada) -> null. */
export function parseStatusLayanan(data: unknown): StatusLayananChat | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.ada !== true || typeof d.buka !== 'boolean') return null;
  const tanggal = strOrNull(d.tanggal);
  if (!tanggal) return null;
  const bt = strOrNull(d.buka_berikutnya_tanggal);
  return {
    buka: d.buka,
    tanggal,
    liburKeterangan: strOrNull(d.libur_keterangan),
    hariTanpaLayanan: d.hari_tanpa_layanan === true,
    bukaBerikutnya: bt ? { tanggal: bt, jam: strOrNull(d.buka_berikutnya_jam) ?? '08:00' } : null,
    sumber: 'jadwal',
  };
}

async function statusKalenderGlobal(client: SupabaseClient, now: Date): Promise<StatusLayananChat> {
  const tanggal = toWIBDateString(now);
  try {
    const info = await muatInfoHariLayanan(client, now, { kanal: false });
    const hariTanpa = info.alasan !== null;
    return {
      buka: !hariTanpa && menitWIB(now) < JAM_TUTUP_LAMA_MENIT,
      tanggal,
      liburKeterangan: info.keteranganLibur,
      hariTanpaLayanan: hariTanpa,
      bukaBerikutnya: info.kerjaBerikutnya ? { tanggal: info.kerjaBerikutnya, jam: '08:00' } : null,
      sumber: 'kalender_global',
    };
  } catch {
    return { buka: true, tanggal, liburKeterangan: null, hariTanpaLayanan: false, bukaBerikutnya: null, sumber: 'kalender_global' };
  }
}

/** Status dari jadwal Layanan (RPC chat_layanan_status); null bila RPC belum ada/gagal/layanan tak aktif. Tidak melempar. */
export async function muatStatusJadwal(client: SupabaseClient, layananId: string): Promise<StatusLayananChat | null> {
  try {
    const { data, error } = await client.rpc('chat_layanan_status', { p_layanan_id: layananId });
    if (!error) return parseStatusLayanan(data);
  } catch {
    /* RPC tak tersedia */
  }
  return null;
}

/** Tidak pernah melempar: RPC belum ada/gagal -> kalender global lama. */
export async function muatStatusLayananChat(
  client: SupabaseClient,
  layananId: string,
  now: Date = new Date(),
): Promise<StatusLayananChat> {
  return (await muatStatusJadwal(client, layananId)) ?? (await statusKalenderGlobal(client, now));
}

/** "Senin, 2 November 2026 pukul 08.00 WIB" / "hari ini pukul 08.00 WIB" / "pada jam kerja berikutnya". */
export function teksBukaBerikutnya(s: Pick<StatusLayananChat, 'tanggal' | 'bukaBerikutnya'>): string {
  if (!s.bukaBerikutnya) return 'pada jam kerja berikutnya';
  const jam = `pukul ${s.bukaBerikutnya.jam.slice(0, 5).replace(':', '.')} WIB`;
  return s.bukaBerikutnya.tanggal === s.tanggal ? `hari ini ${jam}` : `${labelTanggalID(s.bukaBerikutnya.tanggal)} ${jam}`;
}

function sebabTutup(s: StatusLayananChat): string {
  if (s.liburKeterangan) return ` (hari libur: ${s.liburKeterangan})`;
  if (s.hariTanpaLayanan) return ' (hari ini tidak ada pelayanan)';
  return ' (di luar jam operasional)';
}

/** Spanduk pengunjung di luar jam operasional. `tanpaBot`: Layanan tanpa asisten virtual (hanya petugas). */
export function teksPetugasTidakTersedia(layananNama: string, s: StatusLayananChat, opsi: { tanpaBot?: boolean } = {}): string {
  if (opsi.tanpaBot) {
    return (
      `Petugas ${layananNama} sedang tidak tersedia${sebabTutup(s)}. Layanan ini dijawab langsung oleh petugas: ` +
      `tinggalkan pesan Anda, petugas akan menjawab pada jam kerja (${teksBukaBerikutnya(s)}).`
    );
  }
  return (
    `Petugas ${layananNama} sedang tidak tersedia${sebabTutup(s)}. Pertanyaan Anda dijawab otomatis oleh asisten virtual. ` +
    `Petugas kembali bertugas ${teksBukaBerikutnya(s)}. ` +
    'Bila ingin berbicara dengan petugas, tekan "Hubungkan ke Petugas"; petugas akan menjawab pada jam kerja.'
  );
}

/** Balasan bot ketika asisten tidak dapat menjawab di luar jam (pengganti eskalasi otomatis). */
export function teksBotLuarJam(s: StatusLayananChat, sebab?: 'prompt_injection' | 'ai_error'): string {
  const awal =
    sebab === 'prompt_injection'
      ? 'Maaf, pertanyaan Anda mengandung instruksi yang tidak diizinkan sehingga tidak dapat saya jawab.'
      : 'Maaf, asisten virtual belum dapat menjawab pertanyaan Anda saat ini.';
  return (
    `${awal} Petugas sedang tidak tersedia${sebabTutup(s)}. ` +
    `Bila ingin berbicara dengan petugas, ketik "Hubungkan ke petugas"; petugas akan menjawab pada jam kerja (${teksBukaBerikutnya(s)}).`
  );
}
