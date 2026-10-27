// Percakapan pengunjung (Fase 5): satu per (pengunjung, Layanan), DITURUNKAN dari chat_sesi (tanpa tabel baru).
// Modul murni + penanda "belum dibaca" per perangkat (localStorage, K13).

export type PengirimChat = 'pengunjung' | 'bot' | 'petugas';

export interface PercakapanRingkas {
  layananId: string;
  layananNama: string;
  layananAktif: boolean;
  punyaChat: boolean;
  chatbotAktif: boolean;
  jumlahSesi: number;
  sesiTerakhirId: string;
  /** Sesi yang belum selesai (bot/eskalasi/aktif); null = pesan berikutnya membuat sesi baru. */
  sesiTerbukaId: string | null;
  statusTerakhir: string;
  lastPesan: string | null;
  lastPesanAt: string | null;
  lastPengirim: PengirimChat | null;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const pengirim = (v: unknown): PengirimChat | null =>
  v === 'pengunjung' || v === 'bot' || v === 'petugas' ? v : null;

/** Baris RPC chat_percakapan_saya -> bentuk klien; baris tanpa kunci wajib dibuang. */
export function dariBarisRpc(rows: unknown): PercakapanRingkas[] {
  if (!Array.isArray(rows)) return [];
  const hasil: PercakapanRingkas[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || !str(r.layanan_id) || !str(r.sesi_terakhir_id)) continue;
    hasil.push({
      layananId: r.layanan_id,
      layananNama: str(r.layanan_nama) ? r.layanan_nama : 'Layanan',
      layananAktif: r.layanan_aktif !== false,
      punyaChat: r.punya_chat !== false,
      chatbotAktif: r.chatbot_aktif === true,
      jumlahSesi: typeof r.jumlah_sesi === 'number' ? r.jumlah_sesi : 1,
      sesiTerakhirId: r.sesi_terakhir_id,
      sesiTerbukaId: str(r.sesi_terbuka_id) ? r.sesi_terbuka_id : null,
      statusTerakhir: str(r.status_terakhir) ? r.status_terakhir : 'selesai',
      lastPesan: str(r.last_pesan) ? r.last_pesan : null,
      lastPesanAt: str(r.last_pesan_at) ? r.last_pesan_at : null,
      lastPengirim: pengirim(r.last_pengirim),
    });
  }
  return hasil;
}

export interface BarisSesi {
  id: string;
  layanan_id: string;
  status: string;
  created_at: string;
}

/** Cadangan bila RPC belum ada (migrasi belum diterapkan): kelompokkan sesi milik pengunjung per Layanan. */
export function dariBarisSesi(
  rows: BarisSesi[],
  namaLayanan: Record<string, string>,
  opsiLayanan: Record<string, { chatbotAktif?: boolean; aktif?: boolean }> = {},
): PercakapanRingkas[] {
  const urut = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const peta = new Map<string, BarisSesi[]>();
  for (const s of urut) peta.set(s.layanan_id, [...(peta.get(s.layanan_id) ?? []), s]);
  const hasil: Array<PercakapanRingkas & { _t: string }> = [];
  for (const [layananId, sesi] of peta) {
    const terbuka = sesi.find((s) => s.status !== 'selesai');
    hasil.push({
      layananId,
      layananNama: namaLayanan[layananId] ?? 'Layanan',
      layananAktif: opsiLayanan[layananId]?.aktif !== false,
      punyaChat: true,
      chatbotAktif: opsiLayanan[layananId]?.chatbotAktif === true,
      jumlahSesi: sesi.length,
      sesiTerakhirId: sesi[0].id,
      sesiTerbukaId: terbuka?.id ?? null,
      statusTerakhir: sesi[0].status,
      lastPesan: null,
      lastPesanAt: null,
      lastPengirim: null,
      _t: sesi[0].created_at,
    });
  }
  return hasil.sort((a, b) => b._t.localeCompare(a._t)).map((p) => {
    const { _t, ...sisa } = p;
    void _t;
    return sisa;
  });
}

/** Belum dibaca: pesan terakhir dari bot/petugas dan lebih baru dari penanda baca perangkat ini. */
export function belumDibaca(
  p: Pick<PercakapanRingkas, 'lastPesanAt' | 'lastPengirim'>,
  dibacaIso: string | null,
): boolean {
  if (!p.lastPesanAt || !p.lastPengirim || p.lastPengirim === 'pengunjung') return false;
  return !dibacaIso || p.lastPesanAt > dibacaIso;
}

export const kunciDibaca = (layananId: string) => `lmh_chat_dibaca_${layananId}`;

export function bacaDibaca(layananId: string): string | null {
  try {
    return window.localStorage.getItem(kunciDibaca(layananId));
  } catch {
    return null;
  }
}

export function tulisDibaca(layananId: string, iso: string): void {
  try {
    window.localStorage.setItem(kunciDibaca(layananId), iso);
  } catch {
    /* penyimpanan diblok: indikator saja yang hilang */
  }
}

const KALIMAT_SURVEI_LAMA = /\s*Tautan survei kepuasan layanan akan disediakan di sini\.?/i;

/** Pesan penutup lama memuat kalimat survei (Q24): disaring di tampilan tanpa mengubah baris di database. */
export function bersihkanPenutup(isi: string): string {
  return isi.replace(KALIMAT_SURVEI_LAMA, '').trim();
}
