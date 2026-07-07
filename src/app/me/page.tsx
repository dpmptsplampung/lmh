'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME, WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import { waLink } from '@/lib/utils';
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

export default function MeDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [reservasiList, setReservasiList] = useState<Reservasi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function loadData() {
      // Get current user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      // Get profile
      const { data: profile } = await supabase
        .from('pengunjung')
        .select('nama, email, foto_url')
        .eq('auth_user_id', authUser.id)
        .single();

      if (profile) {
        setUser(profile);
      } else {
        // Fallback dari metadata Google
        setUser({
          nama: authUser.user_metadata?.full_name || 'Pengunjung',
          email: authUser.email || '',
          foto_url: authUser.user_metadata?.avatar_url || null,
        });
      }

      // Get reservasi aktif
      const { data: reservasi } = await supabase
        .from('reservasi')
        .select('id, tujuan, nama_yang_ditemui, tanggal_rencana, jam_rencana, keperluan, qr_token, status, layanan(nama)')
        .in('status', ['terjadwal', 'hadir', 'dilayani'])
        .order('tanggal_rencana', { ascending: true });

      // Normalize joined data (Supabase may return array for FK joins)
      const normalized: Reservasi[] = (reservasi || []).map((r) => ({
        ...r,
        layanan: Array.isArray(r.layanan) ? r.layanan[0] || null : r.layanan,
      }));
      setReservasiList(normalized);
      setLoading(false);
    }

    loadData();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      terjadwal: { label: '📅 Terjadwal', className: 'badge--menunggu' },
      hadir: { label: '✓ Hadir', className: 'badge--aktif' },
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
          <div className={styles.navBrand}>
            <div className={styles.navBrandIcon}><Building2 size={20} /></div>
            <span className={styles.navBrandText}>{APP_NAME}</span>
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
        <Link href="/" className={styles.navBrand}>
          <div className={styles.navBrandIcon}>
            <Building2 size={20} />
          </div>
          <span className={styles.navBrandText}>{APP_NAME}</span>
        </Link>

        <div className={styles.navUser}>
          <div className={styles.navUserInfo}>
            {user?.foto_url ? (
              <img src={user.foto_url} alt="" className={styles.navAvatar} referrerPolicy="no-referrer" />
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

      {/* Action Cards */}
      <section className={styles.actionsSection}>
        <div className={styles.actionsGrid}>
          {/* WhatsApp */}
          <a
            href={waLink(WA_NUMBER, WA_DEFAULT_MESSAGE)}
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
                Booking kunjungan online, dapatkan QR code, dan langsung dilayani saat tiba di kantor.
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
    </div>
  );
}
