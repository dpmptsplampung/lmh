'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ArrowLeft, BellOff, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        setLoading(false);
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
      setMessage('Gagal memuat data. Silakan refresh halaman.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!pushSupported) return;
    navigator.serviceWorker
      .register('/sw-push.js')
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
          setBusy(false);
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
        const parsed = sub.toJSON();
        // Upsert on endpoint so re-subscribing the same browser (e.g. after
        // clearing site data) doesn't throw 23505 from the UNIQUE(endpoint)
        // constraint. Re-inserts simply refresh user_id + keys.
        await supabase.from('push_subscriptions').upsert(
          {
            user_id: user.id,
            endpoint: parsed.endpoint,
            keys: parsed.keys,
          },
          { onConflict: 'endpoint' },
        );
        setPushEnabled(true);
        setMessage('Notifikasi push diaktifkan.');
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_id', user.id);
        setPushEnabled(false);
        setMessage('Notifikasi push dinonaktifkan.');
      }
    } catch {
      setMessage('Gagal mengubah pengaturan push.');
    }
    setBusy(false);
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Link href="/me" className={styles.backLink}>
          <ArrowLeft size={16} />
          <span>Kembali</span>
        </Link>

        <header className={styles.header}>
          <Bell size={28} />
          <h1>Notifikasi</h1>
          <p className={styles.subtitle}>
            Kelola preferensi notifikasi dan lihat riwayat pesan Anda.
          </p>
        </header>

        <section className={styles.pushSection}>
          <div className={styles.pushCard}>
            <div className={styles.pushInfo}>
              <strong>Notifikasi Push</strong>
              <p className={styles.pushDesc}>
                {pushSupported
                  ? 'Terima pemberitahuan langsung di browser Anda.'
                  : 'Push not supported di browser ini.'}
              </p>
            </div>
            <button
              type="button"
              className={styles.toggleBtn}
              disabled={!pushSupported || busy}
              data-enabled={pushEnabled}
              onClick={handleTogglePush}
            >
              {pushEnabled ? (
                <>
                  <Check size={16} /> Aktif
                </>
              ) : (
                <>
                  <BellOff size={16} /> Aktifkan notifikasi push
                </>
              )}
            </button>
          </div>
          {message && <p className={styles.message}>{message}</p>}
        </section>

        <section className={styles.listSection}>
          <h2 className={styles.listTitle}>Riwayat Notifikasi</h2>
          {notifications.length === 0 ? (
            <div className={styles.empty}>
              <BellOff size={36} />
              <p>Belum ada notifikasi.</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {notifications.map((n) => (
                <li key={n.id} className={styles.notifItem} data-status={n.status}>
                  <div className={styles.notifIcon}>
                    {n.kanal === 'email' ? <Bell size={18} /> : <Bell size={18} />}
                  </div>
                  <div className={styles.notifBody}>
                    <div className={styles.notifSubject}>
                      {n.subjek || 'Notifikasi'}
                    </div>
                    <p className={styles.notifText}>{n.body}</p>
                    <div className={styles.notifMeta}>
                      <span className={styles.notifKanal}>{n.kanal}</span>
                      <span className={styles.notifStatus} data-status={n.status}>
                        {n.status}
                      </span>
                      <time>{formatDate(n.created_at)}</time>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
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
