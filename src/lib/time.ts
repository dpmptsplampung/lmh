// src/lib/time.ts — Helper zona waktu Asia/Jakarta (RPT-07 / I-21).
//
// SELURUH batas "hari", "hari ini", awal/akhir hari, agregasi harian, dan cron
// WAJIB memakai Asia/Jakarta, BUKAN UTC (bug kelas satu bila salah — lihat
// LMH-AGENT-SPEC aturan 0.2 #9 dan RPT-07).
//
// Kenapa tidak `new Date().toISOString().split('T')[0]`?
// `toISOString()` mengembalikan UTC, sehingga pada pukul 00:00–06:59 WIB
// "hari ini" masih dianggap KEMARIN. Helper ini mengembalikan tanggal menurut
// kalender WIB (Asia/Jakarta).

const TIMEZONE = 'Asia/Jakarta';

// Komponen tanggal disusun sendiri agar separator dan urutan tidak bergantung locale.
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: TIMEZONE,
  calendar: 'iso8601',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Tanggal "hari ini" menurut kalender Asia/Jakarta, format 'YYYY-MM-DD'.
 * Aman dipakai untuk filter tanggal, penomoran antrean, batas reservasi, dll.
 */
export function todayWIB(): string {
  return toWIBDateString(new Date());
}

/**
 * Konversi sebuah Date ke string tanggal 'YYYY-MM-DD' pada zona Asia/Jakarta.
 */
export function toWIBDateString(date: Date): string {
  const parts = dateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')!.value.padStart(4, '0');
  const month = parts.find((part) => part.type === 'month')!.value;
  const day = parts.find((part) => part.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/**
 * String tanggal WIB untuk N hari dari hari ini (bisa negatif untuk mundur).
 * Perhitungan dilakukan pada komponen kalender WIB agar tidak melewati batas UTC.
 */
export function addDaysWIB(days: number, from: Date = new Date()): string {
  // Ambil komponen tanggal WIB lalu geser harinya pada representasi lokal.
  const base = toWIBDateString(from); // 'YYYY-MM-DD'
  const [y, m, d] = base.split('-').map((v) => parseInt(v, 10));
  // Gunakan UTC midday agar tidak terkena pergeseran DST (WIB tidak punya DST).
  const shifted = new Date(Date.UTC(1970, 0, 1, 12));
  shifted.setUTCFullYear(y, m - 1, d + days);
  return toWIBDateString(shifted);
}

/**
 * Waktu sekarang (objek Date). Disediakan agar pemanggil eksplisit sadar bahwa
 * instan ini tetap UTC di dalam Date, dan hanya BATAS HARI yang memakai WIB.
 */
export function nowServer(): Date {
  return new Date();
}

// Menit sejak tengah malam WIB (0–1439) untuk sebuah instan. Dipakai keputusan jam buka/tutup di klien/server.
const jamFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function menitWIB(date: Date = new Date()): number {
  const bagian = jamFormatter.formatToParts(date);
  const jam = Number(bagian.find((p) => p.type === 'hour')?.value ?? 0);
  const menit = Number(bagian.find((p) => p.type === 'minute')?.value ?? 0);
  return jam * 60 + menit;
}

/**
 * Cap waktu untuk watermark/jejak yang dibaca manusia: 'YYYY-MM-DD HH:mm WIB' (zona Asia/Jakarta).
 */
export function capWaktuWIB(date: Date = new Date()): string {
  const jam = jamFormatter.format(date);
  return `${toWIBDateString(date)} ${jam} WIB`;
}
