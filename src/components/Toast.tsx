'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

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

const toastConfig: Record<ToastType, {
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
  iconColor: string;
}> = {
  success: {
    icon: CheckCircle,
    bg: 'var(--color-success-50)',
    border: 'var(--color-success-500)',
    text: 'var(--color-success-700)',
    iconColor: 'var(--color-success-500)',
  },
  error: {
    icon: AlertCircle,
    bg: 'var(--color-danger-50)',
    border: 'var(--color-danger-500)',
    text: 'var(--color-danger-700)',
    iconColor: 'var(--color-danger-500)',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'var(--color-warning-50)',
    border: 'var(--color-warning-500)',
    text: 'var(--color-warning-600)',
    iconColor: 'var(--color-warning-500)',
  },
  info: {
    icon: Info,
    bg: 'var(--color-primary-50)',
    border: 'var(--color-primary-500)',
    text: 'var(--color-primary-700)',
    iconColor: 'var(--color-primary-500)',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 'var(--z-toast, 1400)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const config = toastConfig[toast.type];
  const Icon = config.icon;

  const isError = toast.type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        background: config.bg,
        borderLeft: `4px solid ${config.border}`,
        borderRadius: '0.5rem',
        padding: '1rem 1.25rem',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        maxWidth: '400px',
        minWidth: '300px',
        pointerEvents: 'auto',
        animation: 'toastSlideIn 0.3s ease-out',
      }}
    >
      <Icon size={20} color={config.iconColor} style={{ flexShrink: 0 }} aria-hidden />
      <span
        style={{
          fontSize: '0.875rem',
          color: config.text,
          fontWeight: 500,
          flex: 1,
        }}
      >
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-neutral-400)',
          flexShrink: 0,
          minWidth: '44px',
          minHeight: '44px',
        }}
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
