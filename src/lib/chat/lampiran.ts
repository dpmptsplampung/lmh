// Lampiran foto live chat (R2, area chat-lampiran). Kunci objek = chat-lampiran/<sesi_id>/<uuid>.<ext>.
import { randomUUID } from 'node:crypto';

export type LampiranChat = { kunci: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; ukuran: number; nama: string };

export const MAKS_LAMPIRAN_BYTE = 5 * 1024 * 1024;
export const RETENSI_LAMPIRAN_HARI = 90;
export const MIME_LAMPIRAN = ['image/jpeg', 'image/png', 'image/webp'] as const;

const EKSTENSI: Record<(typeof MIME_LAMPIRAN)[number], 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function ekstensiDariMime(mime: string): 'jpg' | 'png' | 'webp' | null {
  return (EKSTENSI as Record<string, 'jpg' | 'png' | 'webp'>)[mime] ?? null;
}

/** Path di dalam area (tanpa awalan "chat-lampiran/"): `<sesi_id>/<uuid>.<ext>`. */
export function pathLampiran(sesiId: string, ext: 'jpg' | 'png' | 'webp'): string {
  return `${sesiId}/${randomUUID()}.${ext}`;
}

/** Kunci penuh milik sesi ini? (mencegah mengaitkan objek sesi lain ke pesan). */
export function kunciMilikSesi(kunci: string, sesiId: string): boolean {
  return new RegExp(`^chat-lampiran/${sesiId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(kunci);
}

/** Nama berkas yang aman ditampilkan: tanpa path, tanpa karakter kontrol, maks 120. */
export function bersihkanNamaBerkas(nama: string): string {
  const dasar = nama.split(/[\\/]/).pop() ?? '';
  const bersih = dasar.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return bersih || 'foto';
}
