'use client';

import { useState, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Loader2, Shield, Lock, User, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { resolveLoginEmail, normalizeUsername, PESAN_LOGIN_GAGAL } from '@/lib/akun/login';
import styles from './login.module.css';

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [lupa, setLupa] = useState(false);
  const [lupaInfo, setLupaInfo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error') === 'auth' ? 'Gagal masuk. Silakan coba lagi.' : errorMessage;

  // Tujuan setelah login (mis. ?next=/chat dari halaman yang butuh login)
  const rawNext = searchParams.get('next');
  const nextPath = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const supabase = createClient();

      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`
        : '/auth/callback';

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (authError) {
        throw authError;
      }
    } catch {
      setErrorMessage('Gagal memulai proses masuk. Silakan coba lagi.');
      setLoading(false);
    }
  };

  // Login staf/akun layanan: username ATAU email + sandi. Semua galat = pesan seragam (tidak
  // membocorkan apakah username ada). Login Google pengunjung tidak lewat sini.
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Nama pengguna dan kata sandi wajib diisi');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: resolveLoginEmail(email),
        password: password,
      });

      if (authError || !data?.user) throw new Error('login');

      const { data: petugas } = await supabase
        .from('petugas')
        .select('role, wajib_ganti_sandi')
        .eq('auth_user_id', data.user.id)
        .maybeSingle();

      if (petugas?.wajib_ganti_sandi) {
        router.push('/admin/profil?ganti=1');
      } else if (petugas && (petugas.role === 'admin' || petugas.role === 'petugas' || petugas.role === 'front_office')) {
        router.push('/admin');
      } else {
        router.push(nextPath ?? '/me');
      }
    } catch {
      setErrorMessage(PESAN_LOGIN_GAGAL);
      setLoading(false);
    }
  };

  // Lupa sandi: jawaban selalu seragam, server tidak membocorkan keberadaan akun.
  const handleLupa = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = normalizeUsername(email);
    if (!username) {
      setErrorMessage('Nama pengguna wajib diisi');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setLupaInfo('');
    try {
      const res = await fetch('/api/auth/lupa-sandi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (res.status === 429) {
        setErrorMessage('Terlalu sering mencoba. Silakan coba lagi beberapa menit lagi.');
      } else if (res.ok) {
        setLupaInfo(
          'Jika akun tersebut memiliki email notifikasi yang sudah terverifikasi, tautan pemulihan telah dikirim. Bila email tidak diterima, hubungi Admin untuk atur ulang sandi.',
        );
      } else {
        setErrorMessage('Permintaan gagal. Silakan coba lagi.');
      }
    } catch {
      setErrorMessage('Gagal menghubungi server. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const resetMessages = () => {
    setErrorMessage('');
    setLupaInfo('');
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginGlow} />
      <div className={styles.loginGlow2} />

      {/* Spacer atas untuk menyeimbangkan layout */}
      <div className={styles.topSpacer} />

      <div className={styles.loginCard}>
        <div className={styles.loginHeader}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
            <Image
              src="/logo.png"
              alt="Lampung Maju Hub Logo"
              width={200}
              height={90}
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
          <p className={styles.loginSubtitle}>
            {isAdminLogin
              ? lupa
                ? 'Atur ulang kata sandi akun operator. Tautan dikirim ke email notifikasi yang sudah terverifikasi.'
                : 'Masuk ke Panel Operator & Admin DPMPTSP Provinsi Lampung'
              : 'Silakan masuk dengan Google untuk mengakses layanan digital DPMPTSP Provinsi Lampung'}
          </p>
        </div>

        <div className={styles.loginBody}>
          {error && (
            <div className={styles.loginError} role="alert">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          {lupaInfo && (
            <div className={`${styles.loginError} ${styles.loginSuccess}`} role="status">
              <CheckCircle size={16} />
              {lupaInfo}
            </div>
          )}

          {loading ? (
            <div className={styles.loadingState}>
              <Loader2 size={32} className="animate-pulse" />
              <span>{isAdminLogin ? (lupa ? 'Mengirim permintaan...' : 'Memproses masuk...') : 'Mengarahkan ke Google...'}</span>
            </div>
          ) : (
            <>
              {isAdminLogin ? (
                /* Form masuk username (atau email) + kata sandi untuk Admin/Petugas/akun layanan */
                <form onSubmit={lupa ? handleLupa : handleEmailLogin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required" htmlFor="email">
                      <User size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                      Nama pengguna atau email
                    </label>
                    <input
                      id="email"
                      type="text"
                      className="form-input"
                      placeholder="contoh: helpdesk-oss"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                    />
                  </div>

                  {!lupa && (
                    <div className="form-group">
                      <label className="form-label form-label--required" htmlFor="password">
                        <Lock size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                        Kata sandi
                      </label>
                      <input
                        id="password"
                        type="password"
                        className="form-input"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn btn--primary btn--lg"
                    style={{ width: '100%', marginTop: 'var(--space-2)' }}
                  >
                    {lupa ? 'Kirim Tautan Pemulihan' : 'Masuk Operator'}
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setLupa(!lupa);
                      resetMessages();
                    }}
                  >
                    {lupa ? 'Kembali ke Masuk' : 'Lupa kata sandi?'}
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setIsAdminLogin(false);
                      setLupa(false);
                      resetMessages();
                    }}
                  >
                    <ArrowLeft size={14} />
                    Kembali ke Masuk Pengunjung
                  </button>
                </form>
              ) : (
                /* Masuk Pengunjung (Google OAuth) */
                <>
                  <div style={{ textAlign: 'center', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Gunakan akun Google aktif Anda untuk mendaftarkan kedatangan atau membuat reservasi kunjungan.
                  </div>

                  <button
                    className={styles.googleBtn}
                    onClick={handleGoogleLogin}
                    type="button"
                  >
                    <svg className={styles.googleLogo} viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    Masuk dengan Google
                  </button>

                  <div className={styles.loginDivider}>
                    <span>Keamanan Data</span>
                  </div>

                  <p className={styles.loginInfo}>
                    <Shield size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                    Data Anda dilindungi dan hanya digunakan untuk keperluan pelayanan DPMPTSP Provinsi Lampung.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer halaman login */}
      <div className={styles.loginFooter}>
        <Link href="/kebijakan-privasi" className={styles.privacyLink}>
          Kebijakan Privasi
        </Link>
        {!isAdminLogin && (
          <button
            type="button"
            className={styles.adminLink}
            onClick={() => {
              setIsAdminLogin(true);
              resetMessages();
            }}
          >
            Akses Operator & Admin &rarr;
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <LoginContent />
    </Suspense>
  );
}
