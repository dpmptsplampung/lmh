'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  MessageCircle,
  CalendarPlus,
  Store,
  FileText,
  ArrowRight,
  LogOut,
  Calendar,
  Clock,
  MapPin,
  User,
  QrCode,
  Users,
  Globe,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import { getSiteSettings } from '@/lib/site-settings';
import { waLink } from '@/lib/utils';
import { useToast } from '@/components/Toast';
import QRCodeDisplay from '@/components/QRCode';
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
  tanggal_rencana: string;
  jam_rencana: string | null;
  keperluan: string | null;
  qr_token: string;
  status: string;
  layanan?: { nama: string } | null;
}

interface QueuePosition {
  posisi: number;
  total_menunggu: number;
}

export default function MeDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [reservasiList, setReservasiList] = useState<Reservasi[]>([]);
  const [loading, setLoading] = useState(true);
  const [waHref, setWaHref] = useState(() => waLink(WA_NUMBER, WA_DEFAULT_MESSAGE));
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();

    async function loadData() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setLoading(false);
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

      const { data: reservasi } = await supabase
        .from('visit')
        .select('id, tujuan, nama_yang_ditemui, tanggal_rencana, jam_rencana, keperluan, qr_token, status, layanan(nama)')
        .eq('pengunjung_id', pengunjung?.id || '')
        .eq('asal', 'reservasi')
        .in('status', ['terjadwal', 'menunggu', 'dilayani'])
        .order('tanggal_rencana', { ascending: true });

      const normalized: Reservasi[] = (reservasi || []).map((r) => ({
        ...r,
        layanan: Array.isArray(r.layanan) ? r.layanan[0] || null : r.layanan,
      }));
      setReservasiList(normalized);

      const today = new Date().toISOString().split('T')[0];
      const todayVisit = normalized.find(
        (r) => r.tanggal_rencana === today && (r.status === 'menunggu' || r.status === 'dilayani'),
      );
      if (todayVisit) {
        try {
          const { data: queueData, error: queueError } = await supabase.rpc('get_queue_position', {
            p_qr_token: todayVisit.qr_token,
          });
          if (!queueError && Array.isArray(queueData) && queueData.length > 0) {
            const row = queueData[0] as QueuePosition;
            if (typeof row.posisi === 'number' && typeof row.total_menunggu === 'number') {
              setQueuePosition({ posisi: row.posisi, total_menunggu: row.total_menunggu });
            }
          }
        } catch {
          // RPC belum tersedia — blok posisi antrean disembunyikan
        }
      }

      const settings = await getSiteSettings(['wa_number', 'wa_default_message']);
      setWaHref(waLink(settings.wa_number, settings.wa_default_message));

      setLoading(false);
    }

    loadData().catch(() => {
      toast('Gagal memuat data. Silakan refresh halaman.', 'error');
      setLoading(false);
    });
  }, [toast]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      terjadwal: { label: '📅 Terjadwal', className: 'badge--menunggu' },
      menunggu: { label: '✓ Hadir', className: 'badge--aktif' },
      dilayani: { label: '● Dilayani', className: 'badge--published' },
      selesai: { label: '✓ Selesai', className: 'badge--selesai' },
      batal: { label: '✕ Batal', className: 'badge--nonaktif' },
    };
    return map[status] || { label: status, className: 'badge--draft' };
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className={styles.mePage}>
        <div className={styles.navbar}>
          <div className={styles.navBrand} style={{ display: 'flex', alignItems: 'center' }}>
            <Image 
              src="/logo.png" 
              alt="Lampung Maju Hub Logo" 
              width={120} 
              height={50} 
              style={{ objectFit: 'contain' }} 
              priority
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-20)' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.mePage}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <Link href="/" className={styles.navBrand} style={{ display: 'flex', alignItems: 'center' }}>
          <Image 
            src="/logo.png" 
            alt="Lampung Maju Hub Logo" 
            width={120} 
            height={50} 
            style={{ objectFit: 'contain' }} 
            priority
          />
        </Link>

        <div className={styles.navUser}>
          <div className={styles.navUserInfo}>
            {user?.foto_url ? (
              <Image
                src={user.foto_url}
                alt=""
                width={40}
                height={40}
                className={styles.navAvatar}
                referrerPolicy="no-referrer"
                unoptimized
              />
            ) : (
              <div className={styles.navAvatarFallback}>
                {user?.nama?.charAt(0)?.toUpperCase() || 'P'}
              </div>
            )}
            <div>
              <div className={styles.navUserName}>{user?.nama}</div>
              <div className={styles.navUserEmail}>{user?.email}</div>
            </div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Keluar</span>
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Selamat datang, {user?.nama?.split(' ')[0]}! 👋
        </h1>
        <p className={styles.heroSubtitle}>
          Pilih layanan yang Anda butuhkan atau rencanakan kedatangan Anda ke kantor DPMPTSP.
        </p>
      </section>

      {queuePosition && (
        <section style={{ padding: '0 var(--space-8)', maxWidth: 'var(--max-content-width)', margin: '0 auto var(--space-8)', width: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-5) var(--space-6)',
            background: 'var(--color-primary-50)',
            border: '1px solid var(--color-primary-100)',
            borderRadius: 'var(--radius-xl)',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-primary-600)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Users size={24} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--color-primary-700)' }}>
                Posisi antrean Anda: {queuePosition.posisi} dari {queuePosition.total_menunggu}
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                Kunjungan hari ini sedang dalam antrean pelayanan.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Action Cards */}
      <section className={styles.actionsSection}>
        <div className={styles.actionsGrid}>
          {/* WhatsApp */}
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionCard}
          >
            <div className={`${styles.actionIconWrap} ${styles.actionIconWa}`}>
              <MessageCircle size={26} />
            </div>
            <div>
              <div className={styles.actionTitle}>Chat via WhatsApp</div>
              <p className={styles.actionDescription}>
                Tanya langsung ke petugas DPMPTSP melalui WhatsApp. Respon cepat di jam kerja.
              </p>
            </div>
            <ArrowRight size={18} className={styles.actionArrow} />
          </a>

          {/* Reservasi */}
          <Link href="/me/reservasi" className={styles.actionCard}>
            <div className={`${styles.actionIconWrap} ${styles.actionIconReservasi}`}>
              <CalendarPlus size={26} />
            </div>
            <div>
              <div className={styles.actionTitle}>Rencanakan Kedatangan</div>
              <p className={styles.actionDescription}>
                Reservasi kunjungan online, dapatkan QR code, dan langsung dilayani saat tiba di kantor.
              </p>
            </div>
            <ArrowRight size={18} className={styles.actionArrow} />
          </Link>

          {/* UMKM */}
          <Link href="/umkm" className={styles.actionCard}>
            <div className={`${styles.actionIconWrap} ${styles.actionIconUmkm}`}>
              <Store size={26} />
            </div>
            <div>
              <div className={styles.actionTitle}>Matchmaking UMKM</div>
              <p className={styles.actionDescription}>
                Cari kebutuhan usaha — bahan baku, kemitraan, pemasaran, dan lebih banyak lagi.
              </p>
            </div>
            <ArrowRight size={18} className={styles.actionArrow} />
          </Link>

          {/* Gallery */}
          <Link href="/gallery" className={styles.actionCard}>
            <div className={`${styles.actionIconWrap} ${styles.actionIconGallery}`}>
              <FileText size={26} />
            </div>
            <div>
              <div className={styles.actionTitle}>Investment Gallery</div>
              <p className={styles.actionDescription}>
                Jelajahi potensi investasi Provinsi Lampung — dokumen profil tersedia online.
              </p>
            </div>
            <ArrowRight size={18} className={styles.actionArrow} />
          </Link>

          {/* Website Utama */}
          <Link href="/" className={styles.actionCard}>
            <div className={`${styles.actionIconWrap} ${styles.actionIconWebsite}`}>
              <Globe size={26} />
            </div>
            <div>
              <div className={styles.actionTitle}>Website Utama</div>
              <p className={styles.actionDescription}>
                Kembali ke halaman utama — informasi layanan, estimasi antrean, dan konten publik.
              </p>
            </div>
            <ArrowRight size={18} className={styles.actionArrow} />
          </Link>
        </div>
      </section>

      {/* Reservasi Aktif */}
      <section className={styles.reservasiSection}>
        <h2 className={styles.sectionTitle}>
          <QrCode size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }} />
          Reservasi Aktif
        </h2>

        {reservasiList.length > 0 ? (
          <div className={styles.reservasiList}>
            {reservasiList.map((r) => {
              const statusInfo = getStatusLabel(r.status);
              return (
                <div key={r.id} className={styles.reservasiCard}>
                  <div className={styles.reservasiQr}>
                    <QRCodeDisplay value={r.qr_token} size={100} />
                  </div>
                  <div className={styles.reservasiInfo}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>
                        {r.tujuan === 'loket'
                          ? r.layanan?.nama || 'Loket Layanan'
                          : `Bertemu: ${r.nama_yang_ditemui}`}
                      </span>
                      <span className={`badge ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </div>

                    <div className={styles.reservasiMeta}>
                      <Calendar size={14} className={styles.reservasiMetaIcon} />
                      {formatDate(r.tanggal_rencana)}
                    </div>

                    {r.jam_rencana && (
                      <div className={styles.reservasiMeta}>
                        <Clock size={14} className={styles.reservasiMetaIcon} />
                        {r.jam_rencana.substring(0, 5)} WIB
                      </div>
                    )}

                    {r.tujuan === 'loket' && (
                      <div className={styles.reservasiMeta}>
                        <MapPin size={14} className={styles.reservasiMetaIcon} />
                        Menuju loket layanan
                      </div>
                    )}

                    {r.tujuan === 'bertemu_seseorang' && (
                      <div className={styles.reservasiMeta}>
                        <User size={14} className={styles.reservasiMetaIcon} />
                        Bertemu {r.nama_yang_ditemui}
                      </div>
                    )}

                    {r.keperluan && (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                        {r.keperluan}
                      </p>
                    )}

                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
                      Tunjukkan QR code ini ke petugas saat tiba di kantor
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyReservasi}>
            <CalendarPlus size={40} className={styles.emptyIcon} />
            <h3 style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>Belum Ada Reservasi</h3>
            <p style={{ fontSize: 'var(--text-sm)' }}>
              Rencanakan kedatangan Anda untuk mendapatkan QR code dan pelayanan lebih cepat.
            </p>
            <Link href="/me/reservasi" className="btn btn--primary" style={{ marginTop: 'var(--space-4)' }}>
              <CalendarPlus size={16} />
              Buat Reservasi
            </Link>
          </div>
        )}
      </section>

      {/* Floating Live Chat */}
      <Link href="/chat" className={styles.floatingChat} aria-label="Buka Live Chat">
        <MessageCircle size={20} />
        <span>Live Chat</span>
      </Link>
    </div>
  );
}
