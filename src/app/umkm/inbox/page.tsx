'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Store,
  Inbox,
  Check,
  X,
  Mail,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import styles from './inbox.module.css';

interface Inquiry {
  id: string;
  listing_id: string;
  listing_nama: string;
  from_email: string;
  from_nama: string | null;
  pesan: string;
  status: string;
  created_at: string;
  updated_at: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'no_session' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; inquiries: Inquiry[] };

interface PendingAction {
  inquiryId: string;
  status: 'approved' | 'rejected';
}

function statusBadge(status: string) {
  if (status === 'approved') {
    return { label: 'Disetujui', icon: CheckCircle2, cls: styles.badgeApproved };
  }
  if (status === 'rejected') {
    return { label: 'Ditolak', icon: XCircle, cls: styles.badgeRejected };
  }
  return { label: 'Menunggu', icon: Clock, cls: styles.badgePending };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function UmkmInboxPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ kind: 'no_session' });
        return;
      }

      // RLS "umkm_inquiry_select_owner" hanya mengembalikan inquiry
      // milik listing yang dimiliki caller (via umkm_listing_owner).
      // Join listing_umkm untuk dapat nama listing.
      const { data, error } = await supabase
        .from('umkm_inquiry')
        .select(`
          id,
          listing_id,
          from_email,
          from_nama,
          pesan,
          status,
          created_at,
          updated_at,
          listing_umkm!inner(nama_umkm)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }

      const inquiries: Inquiry[] = (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const listing = r.listing_umkm as Record<string, unknown> | null;
        return {
          id: r.id as string,
          listing_id: r.listing_id as string,
          listing_nama: (listing?.nama_umkm as string) ?? '—',
          from_email: r.from_email as string,
          from_nama: (r.from_nama as string) ?? null,
          pesan: r.pesan as string,
          status: r.status as string,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        };
      });

      setState({ kind: 'ready', inquiries });
    }
    load();
  }, []);

  const handleAction = async (inquiryId: string, status: 'approved' | 'rejected') => {
    setPending({ inquiryId, status });
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/umkm/inquiry/${inquiryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json?.error ?? 'Gagal memperbarui inquiry.');
        return;
      }
      // Update local state
      if (state.kind === 'ready') {
        setState({
          kind: 'ready',
          inquiries: state.inquiries.map((i) =>
            i.id === inquiryId
              ? { ...i, status, updated_at: new Date().toISOString() }
              : i,
          ),
        });
      }
      if (status === 'approved') {
        const inq = state.kind === 'ready'
          ? state.inquiries.find((i) => i.id === inquiryId)
          : null;
        setActionSuccess(
          inq
            ? `Inquirer telah diberi tahu. Anda dapat menghubungi mereka di ${inq.from_email}.`
            : 'Inquiry disetujui.',
        );
      } else {
        setActionSuccess('Inquiry ditolak.');
      }
    } catch {
      setActionError('Gagal memperbarui inquiry. Periksa koneksi Anda.');
    } finally {
      setPending(null);
    }
  };

  if (state.kind === 'loading') {
    return (
      <div className={styles.inboxPage}>
        <div className={styles.inboxContainer}>
          <div className={styles.loadingBox}>
            <Loader2 size={32} className={styles.spinner} />
            <p>Memuat pesan masuk…</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'no_session') {
    return (
      <div className={styles.inboxPage}>
        <div className={styles.inboxContainer}>
          <div className={styles.noticeBox}>
            <Mail size={32} />
            <h2>Anda perlu masuk untuk melihat pesan masuk</h2>
            <p>
              Pesan masuk listing UMKM hanya dapat diakses oleh pemilik listing
              yang login via magic-link. Minta link edit di halaman UMKM, lalu
              buka link tersebut untuk masuk.
            </p>
            <Link
              href="/umkm?edit_login_required=1"
              className="btn btn--primary"
              onClick={() => { void router; }}
            >
              <ArrowLeft size={16} />
              Kembali ke daftar UMKM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.inboxPage}>
        <div className={styles.inboxContainer}>
          <div className={styles.noticeBox}>
            <AlertCircle size={32} />
            <h2>Terjadi kesalahan</h2>
            <p>{state.message}</p>
            <Link href="/umkm" className={styles.backBtn}>
              <ArrowLeft size={16} />
              Kembali ke daftar UMKM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.inboxPage}>
      <div className={styles.inboxContainer}>
        <Link href="/umkm" className={styles.backBtn}>
          <ArrowLeft size={16} />
          Kembali ke daftar UMKM
        </Link>

        <PageHeader
          title="Pesan Masuk UMKM"
          description="Pesan dari pengunjung untuk listing UMKM Anda. Setujui untuk membuka kontak, atau tolak jika tidak relevan."
        >
          <Inbox size={24} color="var(--text-tertiary)" />
        </PageHeader>

        {actionError && (
          <div className={styles.errorBox}>
            <AlertCircle size={18} />
            <span>{actionError}</span>
          </div>
        )}
        {actionSuccess && (
          <div className={styles.successBox}>
            <CheckCircle2 size={18} />
            <span>{actionSuccess}</span>
          </div>
        )}

        {state.inquiries.length === 0 ? (
          <div className="empty-state">
            <Inbox size={48} className="empty-state__icon" />
            <h3 className="empty-state__title">Belum ada pesan masuk</h3>
            <p>Pesan dari pengunjung akan muncul di sini setelah mereka mengirim inquiry ke listing Anda.</p>
          </div>
        ) : (
          <div className={styles.inquiryList}>
            {state.inquiries.map((inq) => {
              const badge = statusBadge(inq.status);
              const StatusIcon = badge.icon;
              const isPending = inq.status === 'pending';
              const acting = pending?.inquiryId === inq.id;
              return (
                <div key={inq.id} className={styles.inquiryCard}>
                  <div className={styles.inquiryHeader}>
                    <div className={styles.inquiryHeaderLeft}>
                      <Store size={16} />
                      <span className={styles.inquiryListingName}>{inq.listing_nama}</span>
                    </div>
                    <span className={cn(badge.cls)}>
                      <StatusIcon size={12} />
                      {badge.label}
                    </span>
                  </div>

                  <div className={styles.inquiryMeta}>
                    <span className={styles.inquiryFrom}>
                      <Mail size={12} />
                      {inq.from_nama ? `${inq.from_nama} · ` : ''}{inq.from_email}
                    </span>
                    <span className={styles.inquiryDate}>{formatDate(inq.created_at)}</span>
                  </div>

                  <p className={styles.inquiryPesan}>{inq.pesan}</p>

                  {isPending && (
                    <div className={styles.inquiryActions}>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={() => handleAction(inq.id, 'approved')}
                        disabled={acting}
                        aria-label={`Setujui pesan dari ${inq.from_email}`}
                      >
                        {acting && pending?.status === 'approved' ? (
                          <Loader2 size={14} className={styles.spinner} />
                        ) : (
                          <Check size={14} />
                        )}
                        Setujui
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => handleAction(inq.id, 'rejected')}
                        disabled={acting}
                        aria-label={`Tolak pesan dari ${inq.from_email}`}
                      >
                        {acting && pending?.status === 'rejected' ? (
                          <Loader2 size={14} className={styles.spinner} />
                        ) : (
                          <X size={14} />
                        )}
                        Tolak
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
