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

// Formatter tanggal 'YYYY-MM-DD' pada zona Asia/Jakarta.
// 'en-CA' menghasilkan format ISO (YYYY-MM-DD) secara konsisten.
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Tanggal "hari ini" menurut kalender Asia/Jakarta, format 'YYYY-MM-DD'.
 * Aman dipakai untuk filter tanggal, penomoran antrean, batas reservasi, dll.
 */
export function todayWIB(): string {
  return dateFormatter.format(new Date());
}

/**
 * Konversi sebuah Date ke string tanggal 'YYYY-MM-DD' pada zona Asia/Jakarta.
 */
export function toWIBDateString(date: Date): string {
  return dateFormatter.format(date);
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
  const shifted = new Date(Date.UTC(y, m - 1, d + days, 12));
  return toWIBDateString(shifted);
}

/**
 * Waktu sekarang (objek Date). Disediakan agar pemanggil eksplisit sadar bahwa
 * instan ini tetap UTC di dalam Date, dan hanya BATAS HARI yang memakai WIB.
 */
export function nowServer(): Date {
  return new Date();
}
