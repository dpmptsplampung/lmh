'use client';

// Data cangkang pengunjung: identitas (kartu), kunjungan berikutnya (widget "Kunjungan saya"), dan jumlah
// notifikasi yang belum dilihat (lencana menu). Semua baca-saja, memakai sesi pengunjung (RLS). Kegagalan
// kueri TIDAK pernah jadi galat merah: widget memberi tahu "belum tersedia", lencana diam.
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { todayWIB } from '@/lib/time';
import { kunciNotifikasiDilihat } from '@/lib/pengunjung-nav';

export interface KunjunganBerikut {
  id: string;
  /** YYYY-MM-DD (WIB). */
  tanggal: string;
  /** HH:MM atau null (tanpa jam tetap). */
  jam: string | null;
  tujuan: string;
  namaYangDitemui: string | null;
  layanan: string | null;
  status: string;
  /** Nomor antrean (mis. "OS-014") hanya bila kunjungan hari ini dan tiket sudah terbit. */
  nomorAntrean: string | null;
}

export type StatusKunjungan = 'memuat' | 'ada' | 'kosong' | 'tak-tersedia';

export interface DataPengunjung {
  /** false selama sesi belum diperiksa. */
  siap: boolean;
  nama: string;
  email: string;
  kunjungan: { status: StatusKunjungan; data: KunjunganBerikut | null };
  /** Notifikasi yang dibuat setelah halaman Notifikasi terakhir dibuka. 0 bila tidak diketahui. */
  belumDilihat: number;
  /** Dipanggil saat halaman Notifikasi terbuka: menyimpan waktu sekarang dan mengosongkan lencana. */
  tandaiNotifikasiDilihat: () => void;
}

type Tiket = { nomor_display?: string | null; tanggal?: string | null; status?: string | null };

function bacaDilihat(userId: string): { tersedia: boolean; nilai: string | null } {
  try {
    return { tersedia: true, nilai: window.localStorage.getItem(kunciNotifikasiDilihat(userId)) };
  } catch {
    return { tersedia: false, nilai: null };
  }
}

function pilihTiket(tiket: unknown, tanggal: string): string | null {
  const daftar = Array.isArray(tiket) ? (tiket as Tiket[]) : tiket ? [tiket as Tiket] : [];
  const aktif = daftar.find((t) => t.tanggal === tanggal && t.nomor_display && t.status !== 'batal');
  return aktif?.nomor_display ?? null;
}

export function useDataPengunjung(): DataPengunjung {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const [siap, setSiap] = useState(false);
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [kunjungan, setKunjungan] = useState<DataPengunjung['kunjungan']>({ status: 'memuat', data: null });
  const [belumDilihat, setBelumDilihat] = useState(0);

  useEffect(() => {
    let batal = false;
    const supabase = createClient();

    async function muat() {
      const { data: { user } } = await supabase.auth.getUser();
      if (batal) return;
      setUserId(user?.id ?? null);
      setBelumDilihat(0);
      if (!user) {
        setNama('');
        setEmail('');
        setSiap(true);
        setKunjungan({ status: 'kosong', data: null });
        return;
      }
      setNama(String(user.user_metadata?.full_name ?? ''));
      setEmail(user.email ?? '');

      let pengunjungId: string | null = null;
      try {
        const { data: p } = await supabase
          .from('pengunjung')
          .select('id, nama, email')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (batal) return;
        if (p) {
          pengunjungId = (p.id as string) ?? null;
          if (p.nama) setNama(p.nama as string);
          if (p.email) setEmail(p.email as string);
        }
      } catch {
        /* identitas cadangan dari akun login */
      }
      if (batal) return;
      setSiap(true);

      // Satu-satunya kueri baru untuk widget: kunjungan reservasi berikutnya milik sendiri (RLS + filter eksplisit).
      if (!pengunjungId) {
        setKunjungan({ status: 'kosong', data: null });
      } else {
        try {
          const hariIni = todayWIB();
          const { data, error } = await supabase
            .from('kunjungan')
            .select('id, tanggal, jam_rencana, tujuan, nama_yang_ditemui, status, layanan:layanan_saran_id(nama), tiket_antrean(nomor_display, tanggal, status)')
            .eq('pengunjung_id', pengunjungId)
            .eq('asal', 'reservasi')
            .in('status', ['terjadwal', 'menunggu', 'dilayani'])
            .gte('tanggal', hariIni)
            .order('tanggal', { ascending: true })
            .order('jam_rencana', { ascending: true, nullsFirst: false })
            .limit(1);
          if (error) throw error;
          const baris = (data ?? [])[0] as Record<string, unknown> | undefined;
          if (batal) return;
          if (!baris) {
            setKunjungan({ status: 'kosong', data: null });
          } else {
            const lay = baris.layanan as { nama?: string | null } | { nama?: string | null }[] | null;
            const namaLayanan = Array.isArray(lay) ? lay[0]?.nama ?? null : lay?.nama ?? null;
            const tanggal = String(baris.tanggal);
            setKunjungan({
              status: 'ada',
              data: {
                id: String(baris.id),
                tanggal,
                jam: typeof baris.jam_rencana === 'string' ? baris.jam_rencana.substring(0, 5) : null,
                tujuan: String(baris.tujuan ?? 'loket'),
                namaYangDitemui: (baris.nama_yang_ditemui as string | null) ?? null,
                layanan: namaLayanan,
                status: String(baris.status),
                nomorAntrean: tanggal === hariIni ? pilihTiket(baris.tiket_antrean, hariIni) : null,
              },
            });
          }
        } catch {
          if (!batal) setKunjungan({ status: 'tak-tersedia', data: null });
        }
      }

      // Lencana Notifikasi: hitung yang dibuat setelah terakhir dilihat. Tanpa penyimpanan lokal, tanpa lencana.
      try {
        const dilihat = bacaDilihat(user.id);
        if (!dilihat.tersedia) return;
        let q = supabase
          .from('notifikasi')
          .select('id', { count: 'exact', head: true })
          .eq('tujuan_user_id', user.id);
        if (dilihat.nilai) q = q.gt('created_at', dilihat.nilai);
        const { count, error } = await q;
        if (!batal && !error && typeof count === 'number') setBelumDilihat(count);
      } catch {
        /* lencana opsional */
      }
    }

    let sedangMemuat = false;
    async function segarkan() {
      if (sedangMemuat) return;
      sedangMemuat = true;
      try {
        await muat();
      } catch {
        if (batal) return;
        setSiap(true);
        setKunjungan({ status: 'tak-tersedia', data: null });
      } finally {
        sedangMemuat = false;
      }
    }
    const saatTerlihat = () => {
      if (document.visibilityState === 'visible') void segarkan();
    };
    void segarkan();
    document.addEventListener('visibilitychange', saatTerlihat);
    return () => {
      batal = true;
      document.removeEventListener('visibilitychange', saatTerlihat);
    };
  }, [pathname]);

  const tandaiNotifikasiDilihat = useCallback(() => {
    if (!userId) return;
    try {
      window.localStorage.setItem(kunciNotifikasiDilihat(userId), new Date().toISOString());
    } catch {
      /* penyimpanan tidak tersedia: lencana tidak pernah ditampilkan */
    }
    setBelumDilihat(0);
  }, [userId]);

  return { siap, nama, email, kunjungan, belumDilihat, tandaiNotifikasiDilihat };
}
