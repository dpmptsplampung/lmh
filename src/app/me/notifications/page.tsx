'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { MutasiError, mutasiBolehKosong, mutasiInsert } from '@/lib/supabase/mutate';
import { formatTanggalWaktu } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import Kartu from '@/components/ui/Kartu';
import Lencana, { type NadaLencana } from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Galat from '@/components/ui/Galat';
import styles from './notifications.module.css';

interface NotifRow {
  id: string;
  kanal: 'email' | 'web_push';
  subjek: string | null;
  body: string;
  status: string;
  created_at: string;
}

interface AuthUser {
  id: string;
  email?: string;
}

export default function NotificationsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [pushSupported] = useState(
    () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  );
  const [pushEnabled, setPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [galatMuat, setGalatMuat] = useState(false);
  const [percobaan, setPercobaan] = useState(0);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setLoading(false);
        // Navigasi keras disengaja: reload penuh memastikan state klien bersih saat sesi hilang.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login?redirect=/me/notifications';
        return;
      }
      setUser({ id: authUser.id, email: authUser.email });

      const { data: notifs } = await supabase
        .from('notifikasi')
        .select('id, kanal, subjek, body, status, created_at')
        .eq('tujuan_user_id', authUser.id)
        .order('created_at', { ascending: false })
        .limit(20);

      setNotifications((notifs as NotifRow[]) ?? []);

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('user_id', authUser.id);

      if (subs && subs.length > 0) setPushEnabled(true);
      setLoading(false);
    }

    load().catch(() => {
      // Gagal memuat BUKAN "belum ada notifikasi": tampilkan galat dengan "Coba lagi".
      setGalatMuat(true);
      setLoading(false);
    });
  }, [percobaan]);

  const ulangiMuat = () => {
    setGalatMuat(false);
    setLoading(true);
    setPercobaan((n) => n + 1);
  };

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {
        // non-fatal; push toggle still surfaced but may fail on enable
      });
  }, [pushSupported]);

  const handleTogglePush = async () => {
    if (!user) return;
    if (!pushSupported) return;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      if (!pushEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!publicKey) {
          setMessage('VAPID key belum dikonfigurasi.');
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
        const parsed = sub.toJSON();
        try {
          // Upsert pada endpoint. Perilaku sebenarnya (RLS `push_subscriptions`, migrasi 202607140004):
          // hanya ada policy SELECT/INSERT/DELETE, TIDAK ada UPDATE. Endpoint baru -> INSERT biasa, berhasil.
          // Endpoint yang SUDAH ada (mis. langganan browser ini masih tersimpan padahal toggle tampak mati)
          // -> jalur ON CONFLICT DO UPDATE ditolak RLS (42501), bukan menyegarkan user_id/keys.
          // Kegagalan itu ditangani di catch: langganan browser dibatalkan sehingga "coba lagi"
          // membuat langganan (endpoint) BARU yang lolos sebagai INSERT. Baris lama yang yatim
          // tidak berbahaya: dipangkas job notifikasi saat endpoint-nya 410.
          // supabase-js tidak melempar: mutasiInsert melempar bila server menolak (audit T2b),
          // sehingga toggle tidak pernah menyala untuk langganan yang tidak tersimpan.
          await mutasiInsert(
            supabase.from('push_subscriptions').upsert(
              {
                user_id: user.id,
                endpoint: parsed.endpoint,
                keys: parsed.keys,
              },
              { onConflict: 'endpoint' },
            ),
          );
        } catch (e) {
          console.error('[push] gagal menyimpan langganan ke server', e);
          // Server tidak menyimpan -> langganan browser jadi yatim (tak pernah menerima kiriman).
          // Batalkan agar keadaan browser sama dengan toggle (mati) dan percobaan berikutnya bersih.
          try {
            await sub.unsubscribe();
          } catch (errUnsub) {
            console.error('[push] gagal membatalkan langganan browser setelah penyimpanan gagal', errUnsub);
          }
          setPushEnabled(false);
          setMessage(
            e instanceof MutasiError && e.kode === 'ditolak'
              ? 'Gagal mengaktifkan notifikasi: langganan lama perangkat ini ditolak server. Silakan coba lagi untuk membuat langganan baru.'
              : 'Gagal mengaktifkan notifikasi, coba lagi',
          );
          return;
        }
        setPushEnabled(true);
        setMessage('Notifikasi push diaktifkan.');
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) {
          // Browser/perangkat ini tidak punya langganan, jadi baris yang membuat toggle aktif milik perangkat
          // lain (RLS hanya mengizinkan hapus per endpoint kita sendiri; kita tak tahu endpoint perangkat lain).
          // Jangan mengklaim dinonaktifkan: langganan di perangkat itu tetap menerima kiriman, dan toggle
          // harus tetap mencerminkan kenyataan (aktif).
          setMessage('Langganan notifikasi aktif ada di perangkat lain. Nonaktifkan dari perangkat itu.');
          return;
        }
        const endpoint = sub.endpoint;
        // Hapus di server LEBIH DULU: bila gagal, tidak ada yang berubah (browser masih berlangganan,
        // baris server masih ada) sehingga toggle tetap "aktif" = keadaan sesungguhnya dan bisa dicoba lagi.
        // mutasiBolehKosong (hanya cek error), bukan mutasiWajibBaris: penghapusan idempoten -- 0 baris berarti
        // baris sudah tak ada (mis. dipangkas job notifikasi saat endpoint 410), yaitu tujuan yang sama.
        try {
          await mutasiBolehKosong(
            supabase
              .from('push_subscriptions')
              .delete()
              .eq('user_id', user.id)
              .eq('endpoint', endpoint),
          );
        } catch (e) {
          console.error('[push] gagal menghapus langganan di server', e);
          setMessage('Gagal menonaktifkan notifikasi, coba lagi');
          return;
        }
        // Server sudah tak mengirim ke endpoint ini, jadi gagal melepas langganan browser tidak
        // mengubah status efektif (nonaktif); cukup dicatat.
        try {
          await sub.unsubscribe();
        } catch (errUnsub) {
          console.error('[push] gagal membatalkan langganan browser', errUnsub);
        }
        setPushEnabled(false);
        setMessage('Notifikasi push dinonaktifkan.');
      }
    } catch (e) {
      console.error('[push] gagal mengubah pengaturan', e);
      setMessage('Gagal mengubah pengaturan push.');
    } finally {
      setBusy(false);
    }
  };

  const nadaStatus = (status: string): { label: string; nada: NadaLencana } => {
    switch (status) {
      case 'sent':
        return { label: 'Terkirim', nada: 'sukses' };
      case 'pending':
      case 'processing':
        return { label: 'Menunggu dikirim', nada: 'peringatan' };
      case 'failed':
        return { label: 'Gagal terkirim', nada: 'bahaya' };
      case 'skipped':
        return { label: 'Dilewati', nada: 'netral' };
      default:
        return { label: status, nada: 'netral' };
    }
  };

  const formatDate = (iso: string) => {
    try {
      return formatTanggalWaktu(iso);
    } catch {
      return iso;
    }
  };

  const kepala = (
    <PageHeader
      title="Notifikasi"
      description="Kelola preferensi notifikasi dan lihat riwayat pesan Anda."
      kembali={{ href: '/me', label: 'Kembali' }}
    />
  );

  if (loading) {
    return (
      <div className={styles.page}>
        {kepala}
        <Skeleton bentuk="kartu" jumlah={2} label="Memuat notifikasi" />
      </div>
    );
  }

  if (galatMuat) {
    return (
      <div className={styles.page}>
        {kepala}
        <Galat pesan="Notifikasi belum bisa dimuat. Periksa koneksi Anda, lalu coba lagi." onRetry={ulangiMuat} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {kepala}

      <Kartu judul="Notifikasi Push">
        <div className={styles.pushCard}>
          <p className={styles.pushDesc}>
            {pushSupported
              ? 'Terima pemberitahuan langsung di browser Anda.'
              : 'Notifikasi push tidak didukung di browser ini.'}
          </p>
          <Tombol
            varian={pushEnabled ? 'sekunder' : 'utama'}
            ikon={pushEnabled ? Check : BellOff}
            disabled={!pushSupported || busy}
            data-enabled={pushEnabled}
            onClick={handleTogglePush}
            className={styles.toggleBtn}
          >
            {pushEnabled ? 'Aktif' : 'Aktifkan notifikasi push'}
          </Tombol>
        </div>
        {message && (
          <p className={styles.message} role="status">
            {message}
          </p>
        )}
      </Kartu>

      <Kartu judul="Riwayat Notifikasi">
        {notifications.length === 0 ? (
          <StatusKosong
            ikon={BellOff}
            judul="Belum ada notifikasi."
            isi="Pengingat kunjungan dan kabar layanan akan muncul di sini."
          />
        ) : (
          <ul className={styles.list}>
            {notifications.map((n) => {
              const st = nadaStatus(n.status);
              return (
                <li key={n.id} className={styles.notifItem} data-status={n.status}>
                  <span className={styles.notifIcon}>
                    {n.kanal === 'email' ? (
                      <Mail size={18} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
                    )}
                  </span>
                  <div className={styles.notifBody}>
                    <p className={styles.notifSubject}>{n.subjek || 'Notifikasi'}</p>
                    <p className={styles.notifText}>{n.body}</p>
                    <div className={styles.notifMeta}>
                      <Lencana nada="netral">{n.kanal === 'email' ? 'Email' : 'Push'}</Lencana>
                      <Lencana nada={st.nada} titik>{st.label}</Lencana>
                      <time dateTime={n.created_at}>{formatDate(n.created_at)}</time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Kartu>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
