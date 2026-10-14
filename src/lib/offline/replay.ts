// src/lib/offline/replay.ts — Memutar ulang antrean offline Front Office (I9.3, audit T3).
// Dipanggil: (1) event 'online', (2) saat halaman admin dibuka, (3) pesan REPLAY_QUEUE dari service worker
// (Background Sync). Hanya pendaftaran walk-in FO ('fo_walkin') yang didukung.
//
// Jaminan:
//  - Idempoten: setiap item membawa p_client_request_id yang dibuat saat pendaftaran; `sudah_ada` = sukses.
//  - Kepemilikan: hanya item milik `ownerUserId` yang diputar. Tanpa pemilik = tidak ada yang diputar.
//  - Minim data: item tersinkron/ditolak/kedaluwarsa dihapus; rekaman tipe lama dan rekaman hari sebelumnya
//    (fo_mulai_kunjungan memakai tanggal server, jadi replay esok hari akan salah tanggal) dibuang.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { toWIBDateString } from '@/lib/time';
import { bacaParamTersimpan, galatFoMulaiPermanen, panggilFoMulaiKunjungan } from '@/lib/fo/walkin';
import { getPending, markSynced, removeSynced, type QueuedAction } from './queue';

export interface ReplayResult {
  synced: number;
  failed: number;
  /** Ditolak permanen oleh server (layanan tutup, data tidak valid, dsb.); dibuang dari antrean. Ada hanya bila > 0. */
  ditolak?: number;
  /** Dibuat sebelum hari ini (WIB) sehingga tidak boleh didaftarkan; dibuang. Ada hanya bila > 0. */
  kedaluwarsa?: number;
}

type HasilSatu = 'ok' | 'ditolak' | 'gagal';

async function putarSatu(action: QueuedAction, supabase: Pick<SupabaseClient, 'rpc'>): Promise<HasilSatu> {
  const param = bacaParamTersimpan(action.payload);
  if (!param) return 'ditolak'; // payload rusak: tak pernah bisa berhasil
  try {
    await panggilFoMulaiKunjungan(supabase, param); // `sudah_ada` dihitung sukses di dalamnya
    return 'ok';
  } catch (e) {
    return galatFoMulaiPermanen(e) ? 'ditolak' : 'gagal';
  }
}

// Satu replay pada satu waktu: 'online' + pesan SW + mount bisa terjadi hampir bersamaan.
let sedangBerjalan: Promise<ReplayResult> | null = null;

async function jalankanReplay(
  ownerUserId: string | null | undefined,
  supabase: Pick<SupabaseClient, 'rpc'>,
): Promise<ReplayResult> {
  const hariIni = toWIBDateString(new Date());
  let kedaluwarsa = 0;

  // Bersihkan rekaman yang tidak mungkin diputar siapa pun, termasuk milik akun lain (minim data di perangkat).
  for (const a of await getPending()) {
    const tipeLama = a.type !== 'fo_walkin';
    const lewatHari = toWIBDateString(new Date(a.created_at)) < hariIni;
    if (tipeLama || lewatHari) {
      await markSynced(a.id);
      if (!tipeLama) kedaluwarsa += 1;
    }
  }

  let synced = 0;
  let failed = 0;
  let ditolak = 0;

  // `getPending(owner)` mengembalikan [] bila pemilik tak diketahui: item akun lain tidak pernah diputar (T3c).
  const milikSaya = (await getPending(ownerUserId ?? null)).sort((a, b) => a.created_at - b.created_at);
  for (const action of milikSaya) {
    const hasil = await putarSatu(action, supabase);
    if (hasil === 'ok') {
      await markSynced(action.id);
      synced += 1;
    } else if (hasil === 'ditolak') {
      await markSynced(action.id); // dibuang: mengulang tak akan pernah berhasil
      ditolak += 1;
    } else {
      failed += 1;
    }
  }

  await removeSynced();
  return {
    synced,
    failed,
    ...(ditolak > 0 ? { ditolak } : {}),
    ...(kedaluwarsa > 0 ? { kedaluwarsa } : {}),
  };
}

export async function replayQueue(
  ownerUserId: string | null | undefined,
  supabase?: Pick<SupabaseClient, 'rpc'>,
): Promise<ReplayResult> {
  if (sedangBerjalan) return sedangBerjalan;
  sedangBerjalan = jalankanReplay(ownerUserId, supabase ?? createClient()).finally(() => {
    sedangBerjalan = null;
  });
  return sedangBerjalan;
}
