import { toCsv } from '@/lib/csv';
import { redactPii } from '@/lib/pii';
import { menitWIB, toWIBDateString } from '@/lib/time';
import type { LaporanStatistik } from './types';

function aman(value: string) {
  const teks = redactPii(value).replace(/;/g, ',');
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(teks) ? `'${teks}` : teks;
}
export function laporanCsv(data: LaporanStatistik) {
  const angka = (n: number | null) => n === null ? 'belum dicatat' : n;
  const rows: Record<string, unknown>[] = [];
  let waktuAktif = 'belum diaktifkan';
  if (data.aktif_pada) {
    const aktif = new Date(data.aktif_pada), menit = menitWIB(aktif);
    const jam = String(Math.floor(menit / 60)).padStart(2, '0');
    waktuAktif = `${toWIBDateString(aktif)} ${jam}:${String(menit % 60).padStart(2, '0')} WIB`;
  }
  rows.push({ bagian: 'Ringkasan statistik', nama: 'Waktu aktif sakelar (WIB)', jumlah: waktuAktif });
  for (const [status, jumlah] of Object.entries(data.profil)) {
    rows.push({ bagian: 'Ringkasan profil', nama: status, jumlah });
  }
  for (const [nama, jumlah] of Object.entries({ Suka: data.suka, Dilihat: data.dilihat,
    'Pencarian tanpa hasil': data.tanpa_hasil })) {
    rows.push({ bagian: 'Ringkasan statistik', nama, jumlah: angka(jumlah) });
  }
  for (const [label, jumlah] of [['Pesan', data.pesan], ['Laporan', data.laporan]] as const) {
    for (const [status, n] of Object.entries(jumlah)) {
      rows.push({ bagian: `${label} (masa simpan 180 hari)`, nama: status, jumlah: n });
    }
  }
  for (const [status, jumlah] of Object.entries(data.permintaan ?? {})) {
    rows.push({ bagian: 'Permintaan per status', nama: status, jumlah });
  }
  if (data.rata_keputusan_detik !== undefined) rows.push({ bagian: 'Permintaan',
    nama: 'Lama tunggu keputusan (detik)', jumlah: data.rata_keputusan_detik ?? 'belum ada keputusan' });
  for (const [hasil, jumlah] of Object.entries(data.hasil ?? {})) {
    rows.push({ bagian: 'Hasil pembukaan', nama: hasil, jumlah });
  }
  for (const p of data.profil_statistik) rows.push({ bagian: 'Statistik per UMKM',
    id: p.id, nama: aman(p.nama), suka: p.suka, dilihat: angka(p.dilihat), klik_formulir: angka(p.klik_formulir),
    permintaan: p.permintaan ?? '',
  });
  for (const k of data.kelompok_tanpa_hasil) rows.push({ bagian: 'Kelompok tanpa hasil',
    hari: k.hari, kategori: aman(k.kategori), kabupaten_kota: aman(k.kabupaten_kota), jumlah: k.jumlah });
  return '\uFEFF' + toCsv([
    ['bagian', 'Bagian'], ['id', 'Id profil'], ['nama', 'Nama'], ['suka', 'Suka'], ['dilihat', 'Dilihat'],
    ['klik_formulir', 'Klik formulir'], ['jumlah', 'Jumlah'], ['hari', 'Hari WIB'],
    ['kategori', 'Kategori'], ['kabupaten_kota', 'Kabupaten/kota'],
    ['permintaan', 'Minat perusahaan'],
  ].map(([key, label]) => ({ key, label })), rows);
}
