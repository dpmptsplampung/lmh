'use client';

// Dashboard pengunjung — hierarki:
// 1. Status antrian aktif hari ini (PALING URGENT — jika sedang menunggu)
// 2. Reservasi aktif + QR code (tujuan utama halaman)
// 3. Quick actions (buat reservasi, pengaduan, chat, standar pelayanan)
// 4. Info layanan tambahan

import { useEffect, useState } from 'react';
import { todayWIB } from '@/lib/time';
import Link from 'next/link';
import Image from 'next/image';
import {
  MessageCircle,
  CalendarPlus,
  LogOut,
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { waLink } from '@/lib/utils';
import { WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
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

      // Load active reservations
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

      // Find today's active visit (menunggu/dilayani) for queue position
      const today = todayWIB();
      const todayActive = normalized.find(
        (r) => r.tanggal_rencana === today && (r.status === 'menunggu' || r.status === 'dilayani'),
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

  const statusLabel = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      terjadwal: { label: '📅 Terjadwal', className: 'badge--menunggu' },
      menunggu:  { label: '✓ Hadir — Menunggu', className: 'badge--aktif' },
      dilayani:  { label: '● Sedang Dilayani', className: 'badge--published' },
      selesai:   { label: '✓ Selesai', className: 'badge--selesai' },
      batal:     { label: '✕ Batal', className: 'badge--nonaktif' },
    };
    return map[status] || { label: status, className: 'badge--draft' };
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

  const upcomingReservasi = reservasiList.filter(
    r => r.status === 'terjadwal'
  );
  const todayReservasi = reservasiList.filter(
    r => r.tanggal_rencana === todayWIB() && (r.status === 'menunggu' || r.status === 'dilayani')
  );

  if (loading) {
    return (
      <div className={styles.mePage}>
        <div className={styles.navbar}>
          <Link href="/" className={styles.navBrand} style={{ display: 'flex', alignItems: 'center' }}>
            <Image src="/logo.png" alt="Logo" width={120} height={50} style={{ objectFit: 'contain' }} priority />
          </Link>
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
          <Image src="/logo.png" alt="Lampung Maju Hub Logo" width={120} height={50}
            style={{ objectFit: 'contain' }} priority />
        </Link>
        <div className={styles.navUser}>
          <div className={styles.navUserInfo}>
            {user?.foto_url ? (
              <Image src={user.foto_url} alt="" width={40} height={40}
                className={styles.navAvatar} referrerPolicy="no-referrer" unoptimized />
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
            <LogOut size={16} /><span>Keluar</span>
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 'var(--max-content-width)', margin: '0 auto', padding: 'var(--space-6) var(--space-8)', width: '100%' }}>

        {/* ── 1. STATUS ANTRIAN AKTIF (jika sedang menunggu hari ini) ── */}
        {todayReservasi.length > 0 && (
          <div style={{
            marginBottom: 'var(--space-6)',
            background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-800))',
            borderRadius: 'var(--radius-2xl)',
            padding: 'var(--space-6)',
            color: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <AlertCircle size={20} style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                Kunjungan Anda Hari Ini
              </span>
              <span className="badge" style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', border: 'none' }}>
                {todayReservasi[0].status === 'dilayani' ? 'Sedang Dilayani' : 'Menunggu'}
              </span>
            </div>

            {queuePosition && (
              <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1 }}>{queuePosition.posisi}</div>
                  <div style={{ fontSize: 'var(--text-sm)', opacity: 0.85 }}>posisi antrean Anda</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1 }}>{queuePosition.total_menunggu}</div>
                  <div style={{ fontSize: 'var(--text-sm)', opacity: 0.85 }}>total menunggu</div>
                </div>
                <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    background: 'rgba(255,255,255,0.15)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-3) var(--space-4)',
                    fontSize: 'var(--text-sm)',
                  }}>
                    <Users size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                    Tunjukkan QR code ke petugas saat dipanggil
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              {todayReservasi.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                  background: 'rgba(255,255,255,0.15)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)' }}>
                  <QRCodeDisplay value={r.qr_token} size={80} />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {r.tujuan === 'loket' ? r.layanan?.nama || 'Loket Layanan' : `Bertemu: ${r.nama_yang_ditemui}`}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', opacity: 0.85 }}>
                      {r.jam_rencana ? `${r.jam_rencana.substring(0, 5)} WIB` : 'Tanpa jam tetap'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 2. RESERVASI MENDATANG ── */}
        {upcomingReservasi.length > 0 && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <QrCode size={20} />
              Reservasi Mendatang ({upcomingReservasi.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {upcomingReservasi.map((r) => {
                const statusInfo = statusLabel(r.status);
                return (
                  <div key={r.id} className={styles.reservasiCard}>
                    <div className={styles.reservasiQr}>
                      <QRCodeDisplay value={r.qr_token} size={90} />
                    </div>
                    <div className={styles.reservasiInfo}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>
                          {r.tujuan === 'loket' ? r.layanan?.nama || 'Loket Layanan' : `Bertemu: ${r.nama_yang_ditemui}`}
                        </span>
                        <span className={`badge ${statusInfo.className}`}>{statusInfo.label}</span>
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
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 'var(--space-1)' }}>
                        Tunjukkan QR code ini ke petugas saat tiba
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 3. QUICK ACTIONS ── */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          {reservasiList.length === 0 && (
            <div style={{
              background: 'var(--color-primary-50)',
              border: '1px dashed var(--color-primary-300)',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-5)',
              textAlign: 'center',
              marginBottom: 'var(--space-4)',
            }}>
              <CalendarPlus size={32} style={{ color: 'var(--color-primary-500)', marginBottom: 8 }} />
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Belum ada reservasi aktif</p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 12 }}>
                Reservasi online untuk mendapat QR code dan dilayani lebih cepat
              </p>
              <Link href="/me/reservasi" className="btn btn--primary btn--sm">
                <CalendarPlus size={16} /> Buat Reservasi Sekarang
              </Link>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
            {/* Buat Reservasi */}
            <Link href="/me/reservasi" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
              transition: 'box-shadow 0.2s',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-50)',
                color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalendarPlus size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Buat Reservasi</span>
            </Link>

            {/* Chat WhatsApp */}
            <a href={waHref} target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#dcfce7',
                color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageCircle size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Chat WhatsApp</span>
            </a>

            {/* Lacak Pengaduan */}
            <Link href="/pengaduan/lacak" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fef3c7',
                color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileQuestion size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Lacak Pengaduan</span>
            </Link>

            {/* Standar Pelayanan */}
            <Link href="/standar-pelayanan" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#ede9fe',
                color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BookOpen size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Info Layanan</span>
            </Link>

            {/* Peta Potensi */}
            <Link href="/peta-potensi" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#e0f2fe',
                color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Map size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Peta Potensi</span>
            </Link>

            {/* Buat Pengaduan */}
            <Link href="/pengaduan" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', textDecoration: 'none',
              color: 'var(--text-primary)', textAlign: 'center',
            }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fee2e2',
                color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertCircle size={22} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Buat Pengaduan</span>
            </Link>
          </div>
        </div>

        {/* ── 4. RIWAYAT RESERVASI (jika ada lebih dari yg ditampilkan) ── */}
        {reservasiList.length > 0 && upcomingReservasi.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Link href="/me/reservasi" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: 'var(--color-primary-600)', fontWeight: 600, fontSize: 'var(--text-sm)',
              textDecoration: 'none',
            }}>
              Buat reservasi baru <ChevronRight size={16} />
            </Link>
          </div>
        )}
      </div>

      {/* Floating Live Chat */}
      <Link href="/chat" className={styles.floatingChat} aria-label="Buka Live Chat">
        <MessageCircle size={20} />
        <span>Live Chat</span>
      </Link>
    </div>
  );
}