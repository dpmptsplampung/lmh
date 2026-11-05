'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './Toast.module.css';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ikonToast: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

/** Sukses, peringatan, dan info hilang sendiri; galat menetap sampai ditutup (A8). */
export const DURASI_TOAST_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => {
      // Galat menetap, jadi galat yang sama tidak ditumpuk berulang.
      if (type === 'error' && prev.some((t) => t.type === 'error' && t.message === message)) return prev;
      return [...prev, { id, message, type }];
    });
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={styles.wadah} data-toast="wadah">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: (id: string) => void }) {
  const [dijeda, setDijeda] = useState(false);
  const menetap = toast.type === 'error';
  // Penjemput stabil: timer tidak diulang tiap provider dirender ulang.
  const tutupRef = useRef(onClose);
  useEffect(() => {
    tutupRef.current = onClose;
  });

  useEffect(() => {
    if (menetap || dijeda) return;
    const timer = setTimeout(() => tutupRef.current(toast.id), DURASI_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, menetap, dijeda]);

  // Jeda saat disorot atau difokus (WCAG 2.2.1). Listener asli: kartu hanya wadah pesan, bukan kontrol.
  const kartu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = kartu.current;
    if (!el) return;
    const jeda = () => setDijeda(true);
    const lanjut = () => setDijeda(false);
    el.addEventListener('mouseenter', jeda);
    el.addEventListener('mouseleave', lanjut);
    el.addEventListener('focusin', jeda);
    el.addEventListener('focusout', lanjut);
    return () => {
      el.removeEventListener('mouseenter', jeda);
      el.removeEventListener('mouseleave', lanjut);
      el.removeEventListener('focusin', jeda);
      el.removeEventListener('focusout', lanjut);
    };
  }, []);

  const Icon = ikonToast[toast.type];
  const isError = toast.type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-toast="kartu"
      data-varian={toast.type}
      className={cn(styles.kartu, styles[toast.type])}
      ref={kartu}
    >
      <Icon size={20} className={styles.ikon} aria-hidden />
      <span className={styles.pesan}>{toast.message}</span>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose(toast.id);
        }}
        className={styles.tutup}
        style={{ minWidth: '44px', minHeight: '44px' }}
        aria-label="Tutup notifikasi"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
