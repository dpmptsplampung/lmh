'use client';

// Badge notifikasi sidebar admin: jumlah data yang perlu dibuka per menu. Semua hitungan klien (head count,
// tanpa mengunduh baris) dan dibatasi RLS; tidak ada migrasi. Satu instance di Sidebar.
//
// Pembaruan: realtime (tabel penanganan, chat_sesi, tiket_antrean — semuanya ada di publikasi supabase_realtime;
// pengaduan TIDAK ada, jadi hanya terbarui lewat polling) + polling cadangan 30 dtk yang hanya bekerja saat tab terlihat
// + refetch saat tab kembali terlihat/fokus. Galat ditelan: badge terakhir dipertahankan (atau tidak tampil).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { badgeKeysForRole, type AdminBadgeKey } from '@/lib/admin-nav';
import { muatStatusLayananChat } from '@/lib/chat/status-layanan';
import { todayWIB } from '@/lib/time';

export interface NavBadge {
  count: number;
  /** Teks untuk pembaca layar, mis. "3 chat menunggu diambil". */
  label: string;
}
export type NavBadges = Partial<Record<AdminBadgeKey, NavBadge>>;

export interface PenggunaBadge {
  role: string;
  /** petugas.id (untuk "penanganan milik saya"). */
  petugasId: string | null;
  layananId: string | null;
}

const POLL_MS = 30_000;

type Hitungan = number | null; // null = gagal dihitung (pertahankan nilai lama)

async function hitung(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<Hitungan> {
  try {
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

const head = { count: 'exact', head: true } as const;

/** Kueri tepat tiap badge. Mengembalikan hanya badge yang berhak untuk role (lihat ADMIN_BADGE_ROLES). */
export async function hitungBadge(
  supabase: SupabaseClient,
  who: PenggunaBadge,
  opsi: { tanggal: string; hariTanpaLayanan: boolean },
): Promise<NavBadges> {
  const { role } = who;
  const kunci = badgeKeysForRole(role);
  const hasil: NavBadges = {};
  const tugas: Promise<void>[] = [];
  const set = (k: AdminBadgeKey, n: Hitungan, label: (n: number) => string) => {
    if (n === null) return;
    hasil[k] = { count: n, label: label(n) };
  };
  const adalahFo = role === 'front_office';

  for (const k of kunci) {
    if (k === 'kotakMasukFo') {
      // Kotak Masuk FO non-chat (pengunjung yang dikembalikan petugas layanan dll.). Item chat dihitung di Live Chat
      // agar total di judul tab tidak ganda.
      const dasar = () =>
        supabase.from('penanganan').select('id', head).eq('peran_tahap', 'fo').eq('status', 'menunggu').neq('saluran', 'chat');
      tugas.push(
        Promise.all([hitung(dasar()), hitung(dasar().gt('tahap_ke', 1))]).then(([semua, kembali]) => {
          if (semua === null) return;
          const d = kembali ?? 0;
          set(k, semua, (n) =>
            d > 0 ? `${n} menunggu diambil, ${Math.min(d, n)} dikembalikan petugas layanan` : `${n} menunggu diambil`,
          );
        }),
      );
    } else if (k === 'liveChat') {
      // Hari tanpa pelayanan: chat tidak dapat diambil (DB menolak), jadi tidak ada badge.
      if (opsi.hariTanpaLayanan) {
        hasil[k] = { count: 0, label: '0 chat menunggu diambil' };
        continue;
      }
      // FO: chat yang menunggu di Kotak Masuk FO (tahap FO, saluran chat; RLS: hanya yang boleh dibaca FO).
      // Admin: semua sesi eskalasi. Petugas layanan: hanya sesi eskalasi layanannya.
      const sesi = supabase.from('chat_sesi').select('id', head).eq('status', 'eskalasi');
      const q = adalahFo
        ? supabase.from('penanganan').select('id', head).eq('saluran', 'chat').eq('peran_tahap', 'fo').eq('status', 'menunggu')
        : role === 'petugas' && who.layananId
          ? sesi.eq('layanan_id', who.layananId)
          : sesi;
      tugas.push(hitung(q).then((n) => set(k, n, (c) => `${c} chat menunggu diambil`)));
    } else if (k === 'penangananFo') {
      if (!who.petugasId) continue;
      tugas.push(
        hitung(
          supabase.from('penanganan').select('id', head)
            .eq('peran_tahap', 'fo').eq('status', 'berjalan').eq('penangan_id', who.petugasId),
        ).then((n) => set(k, n, (c) => `${c} penanganan masih berjalan`)),
      );
    } else if (k === 'antrian') {
      if (role === 'petugas') {
        if (!who.layananId) continue;
        tugas.push(
          hitung(
            supabase.from('tiket_antrean').select('id', head)
              .eq('tanggal', opsi.tanggal).in('status', ['menunggu', 'dipanggil']).eq('layanan_id', who.layananId),
          ).then((n) => set(k, n, (c) => `${c} tiket menunggu atau dipanggil hari ini`)),
        );
      } else {
        tugas.push(
          hitung(supabase.from('tiket_antrean').select('id', head).eq('tanggal', opsi.tanggal).eq('status', 'menunggu'))
            .then((n) => set(k, n, (c) => `${c} tiket menunggu hari ini`)),
        );
      }
    } else if (k === 'pengaduan') {
      const semua = supabase.from('pengaduan').select('id', head).eq('status', 'baru');
      const q = adalahFo ? semua.eq('jalur', 'layanan') : semua; // FO tidak pernah melihat jalur integritas
      tugas.push(hitung(q).then((n) => set(k, n, (c) => `${c} pengaduan baru belum ditangani`)));
    }
  }
  await Promise.all(tugas);
  return hasil;
}

/** Jumlah seluruh badge (untuk judul tab). */
export function totalBadge(badges: NavBadges): number {
  return Object.values(badges).reduce((a, b) => a + (b?.count ?? 0), 0);
}

export function useNavBadges(who: PenggunaBadge | null): NavBadges {
  const [badges, setBadges] = useState<NavBadges>({});
  const whoRef = useRef(who);
  const seq = useRef(0);
  const jalan = useRef(false);
  const ulang = useRef(false);
  const hariRef = useRef<{ tanggal: string; libur: boolean } | null>(null);
  const hidup = useRef(true);

  const role = who?.role ?? null;
  const petugasId = who?.petugasId ?? null;
  const layananId = who?.layananId ?? null;

  useEffect(() => {
    whoRef.current = role ? { role, petugasId, layananId } : null;
  }, [role, petugasId, layananId]);

  useEffect(() => {
    hidup.current = true;
    return () => {
      hidup.current = false;
    };
  }, []);

  const muat = useCallback(async () => {
    // Satu putaran muat. Belum tahu role / tab tersembunyi: jangan memuat apa pun.
    const satuKali = async () => {
      const w = whoRef.current;
      if (!w) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const mine = ++seq.current;
      try {
        const supabase = createClient();
        const tanggal = todayWIB();
        if (badgeKeysForRole(w.role).includes('liveChat') && hariRef.current?.tanggal !== tanggal) {
          // Jadwal PER LAYANAN (spec §4.4): hanya petugas Layanan yang punya satu Layanan untuk dinilai; FO/Admin
          // melihat chat banyak Layanan sehingga badge tetap dihitung (tidak dinolkan oleh satu hari tanpa pelayanan).
          const libur =
            w.role === 'petugas' && w.layananId
              ? (await muatStatusLayananChat(supabase, w.layananId)).hariTanpaLayanan
              : false;
          hariRef.current = { tanggal, libur };
        }
        const baru = await hitungBadge(supabase, w, { tanggal, hariTanpaLayanan: !!hariRef.current?.libur });
        if (hidup.current && mine === seq.current && whoRef.current?.role === w.role) {
          // Gagal dihitung (kunci hilang dari hasil) = pertahankan nilai lama.
          setBadges((lama) => {
            const gabung: NavBadges = {};
            for (const k of badgeKeysForRole(w.role)) {
              const v = baru[k] ?? lama[k];
              if (v) gabung[k] = v;
            }
            return gabung;
          });
        }
      } catch {
        /* badge hilang/lama; tanpa spam konsol */
      }
    };
    // Tanpa tumpang tindih: pemicu yang datang saat berjalan hanya menandai satu putaran ulang.
    if (jalan.current) {
      ulang.current = true;
      return;
    }
    jalan.current = true;
    try {
      do {
        ulang.current = false;
        await satuKali();
      } while (ulang.current);
    } finally {
      jalan.current = false;
    }
  }, []);

  // Realtime + polling cadangan (kueri dilewati saat tab tersembunyi, lihat `muat`).
  useRealtimeRefetch(muat, { tables: ['penanganan', 'chat_sesi', 'tiket_antrean'], pollMs: POLL_MS });

  // Muat awal begitu role diketahui; refetch saat tab kembali terlihat/fokus.
  useEffect(() => {
    if (!role) return;
    void muat();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void muat();
    };
    const onFocus = () => void muat();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [role, petugasId, layananId, muat]);

  return role ? badges : {};
}

const AWALAN_JUDUL = /^\(\d+\) /;

/** Awali judul tab dengan "(N) " bila N > 0 dan kembalikan saat 0 / unmount. Tahan penimpaan title oleh Next. */
export function useJudulTabBadge(total: number): void {
  useEffect(() => {
    const terapkan = () => {
      const bersih = document.title.replace(AWALAN_JUDUL, '');
      const target = total > 0 ? `(${total}) ${bersih}` : bersih;
      if (document.title !== target) document.title = target;
    };
    terapkan();
    // Next memperbarui <title> saat navigasi: pasang ulang awalan (idempoten, tidak berulang tanpa akhir).
    const pengamat = new MutationObserver(terapkan);
    pengamat.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      pengamat.disconnect();
      document.title = document.title.replace(AWALAN_JUDUL, '');
    };
  }, [total]);
}
