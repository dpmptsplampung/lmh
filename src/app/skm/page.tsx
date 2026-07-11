'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Send,
  ClipboardList,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import styles from './skm.module.css';

interface VisitInfo {
  id: string;
  layanan_id: string | null;
  status: string;
}

type Phase = 'loading' | 'invalid_token' | 'not_selesai' | 'already_submitted' | 'form' | 'submitting' | 'submitted' | 'error';

const UNSUR = [
  { key: 'u1', label: 'U1 Persyaratan' },
  { key: 'u2', label: 'U2 Prosedur' },
  { key: 'u3', label: 'U3 Waktu' },
  { key: 'u4', label: 'U4 Biaya' },
  { key: 'u5', label: 'U5 Produk' },
  { key: 'u6', label: 'U6 Kompetensi' },
  { key: 'u7', label: 'U7 Perilaku' },
  { key: 'u8', label: 'U8 Sarana' },
  { key: 'u9', label: 'U9 Pengaduan' },
] as const;

const SCALE = [
  { value: 1, label: 'Sangat Tidak Puas' },
  { value: 2, label: 'Tidak Puas' },
  { value: 3, label: 'Puas' },
  { value: 4, label: 'Sangat Puas' },
];

type Ratings = Record<string, number>;

function SkmForm() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [visit, setVisit] = useState<VisitInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [ratings, setRatings] = useState<Ratings>({});
  const [saran, setSaran] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadVisit = useCallback(async () => {
    if (!token) {
      setPhase('invalid_token');
      return;
    }
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('visit')
        .select('id, layanan_id, status')
        .eq('qr_token', token)
        .maybeSingle();

      if (error || !data) {
        setPhase('invalid_token');
        return;
      }

      const visitInfo: VisitInfo = {
        id: data.id,
        layanan_id: data.layanan_id,
        status: data.status,
      };

      if (visitInfo.status !== 'selesai') {
        setVisit(visitInfo);
        setPhase('not_selesai');
        return;
      }

      // Check if already submitted. Best-effort only: RLS `skm_select_staff` is
      // TO authenticated, so anon visitors get null here. The submit route's
      // service-role check + the DB partial unique index (migration 031) are
      // the real enforcement; this pre-submit check is just UX for authed users.
      const { data: existing } = await supabase
        .from('skm_respons')
        .select('id')
        .eq('visit_id', visitInfo.id)
        .maybeSingle();

      if (existing) {
        setPhase('already_submitted');
        return;
      }

      setVisit(visitInfo);
      setPhase('form');
    } catch {
      setPhase('invalid_token');
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVisit();
  }, [loadVisit]);

  const allRated = UNSUR.every((u) => ratings[u.key] !== undefined);

  const handleSubmit = async () => {
    if (!visit || !allRated) return;
    setPhase('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/skm/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_id: visit.id,
          layanan_id: visit.layanan_id,
          u1: ratings.u1,
          u2: ratings.u2,
          u3: ratings.u3,
          u4: ratings.u4,
          u5: ratings.u5,
          u6: ratings.u6,
          u7: ratings.u7,
          u8: ratings.u8,
          u9: ratings.u9,
          saran: saran.trim() || undefined,
        }),
      });

      if (res.status === 201) {
        setPhase('submitted');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPhase('already_submitted');
        return;
      }
      setErrorMsg(data?.error ?? `Gagal mengirim survei (HTTP ${res.status}).`);
      setPhase('form');
    } catch {
      setErrorMsg('Gagal mengirim survei. Periksa koneksi Anda.');
      setPhase('form');
    }
  };

  if (phase === 'loading') {
    return (
      <div className={styles.loading}>
        <Loader2 size={28} className="animate-pulse" />
      </div>
    );
  }

  if (phase === 'invalid_token') {
    return (
      <div className={styles.stateBox}>
        <div className={`${styles.stateIcon} ${styles.stateIconWarn}`}>
          <AlertCircle size={32} />
        </div>
        <h2 className={styles.stateTitle}>Token Tidak Valid</h2>
        <p className={styles.stateText}>
          Link survei tidak ditemukan. Pastikan Anda membuka link yang benar
          dari QR token kunjungan Anda.
        </p>
      </div>
    );
  }

  if (phase === 'not_selesai') {
    return (
      <div className={styles.stateBox}>
        <div className={`${styles.stateIcon} ${styles.stateIconInfo}`}>
          <Clock size={32} />
        </div>
        <h2 className={styles.stateTitle}>Survei Belum Tersedia</h2>
        <p className={styles.stateText}>
          Survei kepuasan tersedia setelah layanan Anda selesai. Silakan
          kembali setelah petugas menyelesaikan layanan Anda.
        </p>
      </div>
    );
  }

  if (phase === 'already_submitted') {
    return (
      <div className={styles.stateBox}>
        <div className={`${styles.stateIcon} ${styles.stateIconSuccess}`}>
          <CheckCircle2 size={32} />
        </div>
        <h2 className={styles.stateTitle}>Terima Kasih</h2>
        <p className={styles.stateText}>
          Anda sudah mengisi survei ini. Terima kasih atas partisipasi Anda
          dalam membantu kami meningkatkan kualitas pelayanan.
        </p>
      </div>
    );
  }

  if (phase === 'submitted') {
    return (
      <div className={styles.stateBox}>
        <div className={`${styles.stateIcon} ${styles.stateIconSuccess}`}>
          <CheckCircle2 size={32} />
        </div>
        <h2 className={styles.stateTitle}>Survei Terkirim</h2>
        <p className={styles.stateText}>
          Terima kasih atas penilaian Anda. Masukan Anda sangat berharga untuk
          meningkatkan kualitas pelayanan kami.
        </p>
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link href="/" className="btn btn--ghost btn--sm">
            Kembali ke Beranda
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.skmHeader}>
        <div className={`${styles.stateIcon} ${styles.stateIconInfo}`} style={{ margin: '0 auto var(--space-4)' }}>
          <ClipboardList size={32} />
        </div>
        <h1 className={styles.skmTitle}>Survei Kepuasan Masyarakat</h1>
        <p className={styles.skmSubtitle}>
          Sesuai PermenPANRB 14/2017 — 9 Unsur Kepuasan
        </p>
      </div>

      <div className={styles.skmIntro}>
        Bapak/Ibu, mohon berikan penilaian atas layanan yang baru saja Anda
        terima. Penilaian Anda membantu kami meningkatkan kualitas pelayanan.
        Survei ini hanya dapat diisi sekali per kunjungan.
      </div>

      <div className={styles.unsurSection}>
        {UNSUR.map((u) => (
          <div key={u.key} className={styles.unsurItem}>
            <div className={styles.unsurLabel}>
              <span className={styles.unsurBadge}>{u.key.slice(1)}</span>
              {u.label}
            </div>
            <div className={styles.scaleRow} role="radiogroup" aria-label={u.label}>
              {SCALE.map((opt) => {
                const checked = ratings[u.key] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={`${styles.scaleOption} ${checked ? styles.scaleOptionChecked : ''}`}
                    onClick={() => setRatings((prev) => ({ ...prev, [u.key]: opt.value }))}
                  >
                    <span className={styles.scaleValue}>{opt.value}</span>
                    <span className={styles.scaleLabel}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.saranGroup}>
        <label className={styles.saranLabel} htmlFor="saran">
          Saran (opsional)
        </label>
        <textarea
          id="saran"
          className={styles.saranInput}
          placeholder="Tuliskan saran perbaikan untuk layanan kami..."
          value={saran}
          onChange={(e) => setSaran(e.target.value)}
          maxLength={2000}
        />
      </div>

      {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}

      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={!allRated || phase === 'submitting'}
        >
          {phase === 'submitting' ? (
            <>
              <Loader2 size={18} className="animate-pulse" />
              Mengirim...
            </>
          ) : (
            <>
              <Send size={18} />
              Kirim Survei
            </>
          )}
        </button>
      </div>
    </>
  );
}

export default function SkmPage() {
  return (
    <div className={styles.skmPage}>
      <div className={styles.skmCard}>
        <Suspense
          fallback={
            <div className={styles.loading}>
              <Loader2 size={28} className="animate-pulse" />
            </div>
          }
        >
          <SkmForm />
        </Suspense>
      </div>
    </div>
  );
}
