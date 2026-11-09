'use client';

// Beranda saya (pengunjung) — hierarki:
// 1. Kunjungan hari ini (paling mendesak bila sedang menunggu/dilayani)
// 2. Reservasi mendatang + QR code (tujuan utama halaman)
// 3. Pintasan (reservasi, chat, pengaduan, info layanan)
// Menu, identitas, dan Keluar ada di cangkang (_cangkang/CangkangPengunjung).

import { useEffect, useState } from 'react';
import { todayWIB } from '@/lib/time';
import {
  MessageCircle,
  MessagesSquare,
  CalendarPlus,
  Calendar,
  Clock,
  MapPin,
  User,
  QrCode,
  Users,
  AlertCircle,
  ChevronRight,
  FileQuestion,
  BookOpen,
  Map,
  CalendarCheck,
  Store,
} from 'lucide-react';
import Link from 'next/link';
import type { ElementType } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { formatTanggal, waLink } from '@/lib/utils';
import { WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import QRCodeDisplay from '@/components/QRCode';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import styles from './me.module.css';

interface UserProfile {
  nama: string;
  email: string;
  foto_url: string | null;
}

interface Reservasi {
  id: string;
  tujuan: string;
  nama_yang_ditemui: string | null;
  tanggal: string;
  jam_rencana: string | null;
  qr_token: string;
  status: string;
  layanan?: { nama: string } | null;
}

interface QueuePosition {
  posisi: number;
  total_menunggu: number;
}


const STATUS_LENCANA: Record<string, { label: string; nada: NadaLencana }> = {
  terjadwal: { label: 'Terjadwal', nada: 'info' },
  menunggu: { label: 'Hadir, menunggu', nada: 'peringatan' },
  dilayani: { label: 'Sedang dilayani', nada: 'sukses' },
  selesai: { label: 'Selesai', nada: 'netral' },
  batal: { label: 'Batal', nada: 'netral' },
  no_show: { label: 'Hangus, tidak hadir', nada: 'bahaya' },
};

interface Pintasan {
  label: string;
  href: string;
  ikon: ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
  nada: 'primer' | 'sukses' | 'peringatan' | 'info' | 'bahaya';
  eksternal?: boolean;
}

function judulReservasi(r: Reservasi): string {
  return r.tujuan === 'loket' ? r.layanan?.nama || 'Loket Layanan' : `Bertemu: ${r.nama_yang_ditemui}`;
}

function tanggalPanjang(tanggal: string): string {
  return formatTanggal(`${tanggal}T12:00:00+07:00`, { weekday: 'long' });
}

export default function MeDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [reservasiList, setReservasiList] = useState<Reservasi[]>([]);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState(false);
  const [waHref, setWaHref] = useState(() => waLink(WA_NUMBER, WA_DEFAULT_MESSAGE));
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);

  const [percobaan, setPercobaan] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let batal = false;

    async function muat() {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) {
          setLoading(false);
          // Navigasi keras disengaja: reload penuh memastikan state klien bersih saat sesi hilang.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = '/login?redirect=/me';
          return;
        }

        const { data: pengunjung, error: profileError } = await supabase
          .from('pengunjung')
          .select('id, nama, email, foto_url')
          .eq('auth_user_id', authUser.id)
          .single();

        if (profileError || !pengunjung) {
          setUser({
            nama: authUser.user_metadata?.full_name || 'Pengunjung',
            email: authUser.email || '',
            foto_url: authUser.user_metadata?.avatar_url || null,
          });
        } else {
          setUser({
            nama: pengunjung.nama,
            email: pengunjung.email,
            foto_url: pengunjung.foto_url,
          });
        }

        // Reservasi aktif = baris `kunjungan` (bukan `visit`; kontrak FO §6.6). Filter pengunjung_id eksplisit
        // karena staf yang membuka /me lolos RLS baca semua kunjungan.
        let normalized: Reservasi[] = [];
        if (pengunjung?.id) {
          const { data: reservasi, error: reservasiError } = await supabase
            .from('kunjungan')
            .select('id, tujuan, nama_yang_ditemui, tanggal, jam_rencana, qr_token, status, layanan_saran_id')
            .eq('pengunjung_id', pengunjung.id)
            .eq('asal', 'reservasi')
            .in('status', ['terjadwal', 'menunggu', 'dilayani'])
            .order('tanggal', { ascending: true });
          if (reservasiError) throw reservasiError;

          // Nama layanan saran: kunjungan hanya menyimpan id (bukan tiket), jadi dicari terpisah.
          const idLayanan = (reservasi ?? [])
            .map((r) => r.layanan_saran_id as string | null)
            .filter((id, i, semua): id is string => !!id && semua.indexOf(id) === i);
          const namaLayanan: Record<string, string> = {};
          if (idLayanan.length > 0) {
            const { data: layananRows } = await supabase.from('v_layanan_publik').select('id, nama').in('id', idLayanan);
            (layananRows ?? []).forEach((l) => {
              if (l.id && l.nama) namaLayanan[l.id as string] = l.nama as string;
            });
          }
          normalized = (reservasi ?? []).map((r) => ({
            id: r.id,
            tujuan: r.tujuan ?? 'loket',
            nama_yang_ditemui: r.nama_yang_ditemui,
            tanggal: r.tanggal,
            jam_rencana: r.jam_rencana,
            qr_token: r.qr_token,
            status: r.status,
            layanan: r.layanan_saran_id && namaLayanan[r.layanan_saran_id] ? { nama: namaLayanan[r.layanan_saran_id] } : null,
          }));
        }
        setReservasiList(normalized);

        // Find today's active visit (menunggu/dilayani) for queue position
        const today = todayWIB();
        const todayActive = normalized.find(
          (r) => r.tanggal === today && (r.status === 'menunggu' || r.status === 'dilayani'),
        );

        if (todayActive) {
          try {
            const { data: queueData, error: queueError } = await supabase.rpc('get_queue_position', {
              p_qr_token: todayActive.qr_token,
            });
            if (!queueError && Array.isArray(queueData) && queueData.length > 0) {
              const row = queueData[0] as QueuePosition;
              if (typeof row.posisi === 'number' && typeof row.total_menunggu === 'number') {
                setQueuePosition({ posisi: row.posisi, total_menunggu: row.total_menunggu });
              }
            }
          } catch { /* RPC belum tersedia */ }
        }

        const settings = await getSiteSettings(['wa_number', 'wa_default_message']);
        setWaHref(waLink(settings.wa_number, settings.wa_default_message));

        setLoading(false);
      } catch {
        // Gagal memuat BUKAN keadaan kosong: tampilkan galat dengan "Coba lagi".
        if (!batal) {
          setGalat(true);
          setLoading(false);
        }
      }
    }

    void muat();
    return () => {
      batal = true;
    };
  }, [percobaan]);

  const ulangi = () => {
    setGalat(false);
    setLoading(true);
    setPercobaan((n) => n + 1);
  };

  const hariIni = todayWIB();
  const upcomingReservasi = reservasiList.filter((r) => r.status === 'terjadwal' && r.tanggal >= hariIni);
  const todayReservasi = reservasiList.filter(
    (r) => r.tanggal === hariIni && (r.status === 'menunggu' || r.status === 'dilayani'),
  );

  const pintasan: Pintasan[] = [
    { label: 'Buat Reservasi', href: '/me/reservasi', ikon: CalendarPlus, nada: 'primer' },
    { label: 'Live Chat', href: '/chat', ikon: MessagesSquare, nada: 'info' },
    { label: 'Chat WhatsApp', href: waHref, ikon: MessageCircle, nada: 'sukses', eksternal: true },
    { label: 'Lacak Pengaduan', href: '/pengaduan/lacak', ikon: FileQuestion, nada: 'peringatan' },
    { label: 'Info Layanan', href: '/standar-pelayanan', ikon: BookOpen, nada: 'primer' },
    { label: 'Peta Potensi', href: '/peta-potensi', ikon: Map, nada: 'info' },
    { label: 'UMKM Saya', href: '/me/umkm', ikon: Store, nada: 'sukses' },
    { label: 'Usaha Saya', href: '/me/usaha', ikon: Store, nada: 'primer' },
    { label: 'Buat Pengaduan', href: '/pengaduan', ikon: AlertCircle, nada: 'bahaya' },
  ];

  const kepala = (
    <PageHeader
      title="Beranda saya"
      description={user ? `Halo, ${user.nama}. Kunjungan dan reservasi Anda ada di sini.` : 'Kunjungan dan reservasi Anda ada di sini.'}
    />
  );

  if (loading) {
    return (
      <div className={styles.halaman}>
        {kepala}
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat beranda" />
      </div>
    );
  }

  if (galat) {
    return (
      <div className={styles.halaman}>
        {kepala}
        <Galat pesan="Data kunjungan belum bisa dimuat. Periksa koneksi Anda, lalu coba lagi." onRetry={ulangi} />
      </div>
    );
  }

  return (
    <div className={styles.halaman}>
      {kepala}

      {/* 1. KUNJUNGAN HARI INI (bila sedang menunggu/dilayani) */}
      {todayReservasi.length > 0 && (
        <Kartu
          judul="Kunjungan Anda Hari Ini"
          aksi={
            <Lencana nada={todayReservasi[0].status === 'dilayani' ? 'sukses' : 'peringatan'} titik>
              {todayReservasi[0].status === 'dilayani' ? 'Sedang Dilayani' : 'Menunggu'}
            </Lencana>
          }
          className={styles.hariIni}
        >
          {queuePosition && (
            <div className={styles.antrean}>
              <div className={styles.angkaBox}>
                <span className={styles.angka}>{queuePosition.posisi}</span>
                <span className={styles.angkaLabel}>posisi antrean Anda</span>
              </div>
              <div className={styles.angkaBox}>
                <span className={styles.angka}>{queuePosition.total_menunggu}</span>
                <span className={styles.angkaLabel}>total menunggu</span>
              </div>
              <p className={styles.catatan}>
                <Users size={16} strokeWidth={1.75} aria-hidden="true" />
                Tunjukkan QR code ke petugas saat dipanggil
              </p>
            </div>
          )}
          <ul className={styles.daftarQr}>
            {todayReservasi.map((r) => (
              <li key={r.id} className={styles.itemQr}>
                <div className={styles.qr}>
                  <QRCodeDisplay value={r.qr_token} size={88} />
                </div>
                <div>
                  <p className={styles.namaReservasi}>{judulReservasi(r)}</p>
                  <p className={styles.meta}>{r.jam_rencana ? `${r.jam_rencana.substring(0, 5)} WIB` : 'Tanpa jam tetap'}</p>
                </div>
              </li>
            ))}
          </ul>
        </Kartu>
      )}

      <div className={styles.dua}>
        {/* 2. RESERVASI MENDATANG */}
        <Kartu
          judul={upcomingReservasi.length > 0 ? `Reservasi Mendatang (${upcomingReservasi.length})` : 'Reservasi'}
          aksi={
            upcomingReservasi.length > 0 ? (
              <Tombol varian="hantu" ukuran="kecil" href="/me/reservasi" ikon={ChevronRight}>
                Buat reservasi baru
              </Tombol>
            ) : undefined
          }
        >
          {upcomingReservasi.length > 0 ? (
            <ul className={styles.daftarReservasi}>
              {upcomingReservasi.map((r) => {
                const info = STATUS_LENCANA[r.status] ?? { label: r.status, nada: 'netral' as const };
                return (
                  <li key={r.id} className={styles.reservasi}>
                    <div className={styles.qr}>
                      <QRCodeDisplay value={r.qr_token} size={90} />
                    </div>
                    <div className={styles.reservasiInfo}>
                      <div className={styles.judulBaris}>
                        <span className={styles.namaReservasi}>{judulReservasi(r)}</span>
                        <Lencana nada={info.nada}>{info.label}</Lencana>
                      </div>
                      <p className={styles.metaBaris}>
                        <Calendar size={14} strokeWidth={1.75} aria-hidden="true" />
                        {tanggalPanjang(r.tanggal)}
                      </p>
                      {r.jam_rencana && (
                        <p className={styles.metaBaris}>
                          <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
                          {r.jam_rencana.substring(0, 5)} WIB
                        </p>
                      )}
                      {r.tujuan === 'loket' && (
                        <p className={styles.metaBaris}>
                          <MapPin size={14} strokeWidth={1.75} aria-hidden="true" />
                          Menuju loket layanan
                        </p>
                      )}
                      {r.tujuan === 'bertemu_seseorang' && (
                        <p className={styles.metaBaris}>
                          <User size={14} strokeWidth={1.75} aria-hidden="true" />
                          Bertemu {r.nama_yang_ditemui}
                        </p>
                      )}
                      <p className={styles.petunjuk}>
                        <QrCode size={14} strokeWidth={1.75} aria-hidden="true" />
                        Tunjukkan QR code ini ke petugas saat tiba
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : reservasiList.length === 0 ? (
            <StatusKosong
              ikon={CalendarCheck}
              judul="Belum ada reservasi aktif"
              isi="Reservasi online untuk mendapat QR code dan dilayani lebih cepat."
              aksi={
                <Tombol href="/me/reservasi" ikon={CalendarPlus}>
                  Buat Reservasi Sekarang
                </Tombol>
              }
            />
          ) : (
            <StatusKosong
              ikon={CalendarCheck}
              judul="Tidak ada reservasi mendatang"
              isi="Kunjungan Anda hari ini ada di kartu di atas."
              aksi={
                <Tombol varian="sekunder" href="/me/reservasi" ikon={CalendarPlus}>
                  Buat reservasi baru
                </Tombol>
              }
            />
          )}
        </Kartu>

        {/* 3. PINTASAN */}
        <Kartu judul="Pintasan">
          <ul className={styles.pintasan}>
            {pintasan.map((p) => {
              const Ikon = p.ikon;
              const isi = (
                <>
                  <span className={`${styles.ikonPintasan} ${styles[`nada_${p.nada}`]}`}>
                    <Ikon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className={styles.labelPintasan}>{p.label}</span>
                </>
              );
              return (
                <li key={p.href + p.label}>
                  {p.eksternal ? (
                    <a href={p.href} target="_blank" rel="noopener noreferrer" className={styles.itemPintasan}>
                      {isi}
                    </a>
                  ) : (
                    <Link href={p.href} className={styles.itemPintasan}>
                      {isi}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Kartu>
      </div>
    </div>
  );
}
