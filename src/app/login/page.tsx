'use client';

import { useState } from 'react';
import { Building2, AlertCircle, Loader2, Shield, Lock, Mail, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import styles from './login.module.css';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Cek URL params untuk error
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'auth' && !error) {
      setError('Gagal login. Silakan coba lagi.');
    }
  }

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const supabase = createClient();

      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
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
      setError('Gagal memulai proses login. Silakan coba lagi.');
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email dan Password wajib diisi');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (authError) throw authError;

      if (data.user) {
        // Cek role petugas
        const { data: petugas, error: dbError } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', data.user.id)
          .single();

        if (dbError || !petugas) {
          window.location.href = '/me';
        } else if (petugas.role === 'admin' || petugas.role === 'petugas') {
          window.location.href = '/admin';
        } else {
          window.location.href = '/me';
        }
      }
    } catch (err: any) {
      setError(err.message || 'Email atau Password salah. Silakan coba lagi.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginGlow} />
      <div className={styles.loginGlow2} />

      {/* Spacer atas untuk menyeimbangkan layout */}
      <div className={styles.topSpacer} />

      <div className={styles.loginCard}>
        <div className={styles.loginHeader}>
          <div className={styles.loginIcon}>
            <Building2 size={32} />
          </div>
          <h1 className={styles.loginTitle}>{APP_NAME}</h1>
          <p className={styles.loginSubtitle}>
            {isAdminLogin 
              ? 'Masuk ke Panel Operator & Admin DPMPTSP Provinsi Lampung'
              : 'Silakan login dengan Google untuk mengakses layanan digital DPMPTSP Provinsi Lampung'}
          </p>
        </div>

        <div className={styles.loginBody}>
          {error && (
            <div className={styles.loginError}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {loading ? (
            <div className={styles.loadingState}>
              <Loader2 size={32} className="animate-pulse" />
              <span>{isAdminLogin ? 'Memproses login...' : 'Mengarahkan ke Google...'}</span>
            </div>
          ) : (
            <>
              {isAdminLogin ? (
                /* Form Login Email/Password untuk Admin/Petugas */
                <form onSubmit={handleEmailLogin} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label form-label--required" htmlFor="email">
                      <Mail size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                      Email Petugas
                    </label>
                    <input
                      id="email"
                      type="email"
                      className="form-input"
                      placeholder="contoh@lampungprov.go.id"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label form-label--required" htmlFor="password">
                      <Lock size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      className="form-input"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn--primary btn--lg"
                    style={{ width: '100%', marginTop: 'var(--space-2)' }}
                  >
                    Masuk Operator
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ marginTop: 'var(--space-2)' }}
                    onClick={() => {
                      setIsAdminLogin(false);
                      setError('');
                    }}
                  >
                    <ArrowLeft size={14} />
                    Kembali ke Login Pengunjung
                  </button>
                </form>
              ) : (
                /* Login Pengunjung (Google OAuth) */
                <>
                  <div style={{ textAlign: 'center', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    Gunakan akun Google aktif Anda untuk memulai check-in atau membuat reservasi kunjungan.
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

      {/* Footer tersembunyi di bawah kanan (harus scroll di handphone) */}
      <div className={styles.loginFooter}>
        {!isAdminLogin && (
          <button
            type="button"
            className={styles.adminLink}
            onClick={() => {
              setIsAdminLogin(true);
              setError('');
            }}
          >
            Akses Operator & Admin &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
