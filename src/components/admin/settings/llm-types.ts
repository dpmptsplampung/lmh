// Tipe layar konsol AI (kontrak: docs/RBAC_KONSOL_KONTRAK.md).
export type LlmTipe = 'gemini' | 'openai_compat';

export interface LlmEntry {
  id: string;
  label: string;
  tipe: LlmTipe;
  base_url: string;
  model: string;
  rahasia_id: string | null;
  aktif: boolean;
  kuota_harian: number | null;
  suhu?: number;
  batas_waktu_ms?: number;
  // Hanya tampilan (dari server); tidak pernah dikirim balik ke PUT.
  punya_kunci?: boolean;
  kunci_tersamar?: string | null;
}

export interface HasilUjiRingkas {
  ok: boolean;
  http_status: number | null;
  latensi_ms: number | null;
  at?: string;
}

export interface UjiDetail extends HasilUjiRingkas {
  cuplikan: string | null;
  error: string | null;
  curl: string;
}

export interface LlmVersi {
  versi: number;
  alasan: string | null;
  hasil_uji: Record<string, HasilUjiRingkas> | null;
  entries: LlmEntry[];
}

export interface RiwayatItem {
  versi: number;
  status: 'draf' | 'aktif' | 'arsip' | string;
  alasan: string | null;
  dibuat_at: string;
  diaktifkan_at: string | null;
}

export interface LlmPreset {
  id: string;
  label: string;
  tipe: LlmTipe;
  base_url: string;
  model_contoh: string;
}

export interface LlmState {
  enkripsi_siap: boolean;
  sumber_aktif: 'db' | 'env';
  aktif: LlmVersi | null;
  draf: LlmVersi | null;
  riwayat: RiwayatItem[];
  preset: LlmPreset[];
  env_cadangan?: { gemini_sdk: boolean; penyedia: Array<{ nama: string; model: string }> };
}
