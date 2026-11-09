'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Tombol from '@/components/ui/Tombol';
import { KatalogError, katalogRequest } from './api';

export default function SukaProfil({ id, onJumlah }: { id: string; onJumlah: (value: number) => void }) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [status, setStatus] = useState<'memuat' | 'login' | 'siap' | 'ditolak' | 'galat'>('memuat');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const login = `/login?next=${encodeURIComponent(`/umkm/katalog/${id}`)}`;

  useEffect(() => {
    const controller = new AbortController();
    void katalogRequest<{ suka_saya: boolean }>(`/${id}/suka`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setLiked(value.suka_saya); setStatus('siap'); setMessage('');
      }).catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof KatalogError && error.status === 401) setStatus('login');
        else if (error instanceof KatalogError && error.status === 403) {
          setStatus('ditolak'); setMessage('Tanda suka hanya untuk pengunjung. Akun staf tidak ikut dihitung.');
        } else {
          setStatus('galat'); setMessage('Status suka belum dapat dimuat. Silakan coba lagi.');
        }
      });
    return () => controller.abort();
  }, [id, attempt]);

  const send = async () => {
    if (busy) return;
    if (status === 'login') { router.push(login); return; }
    if (status !== 'siap') return;
    setBusy(true); setMessage('');
    try {
      const result = await katalogRequest<{ suka_saya: boolean; suka: number }>(`/${id}/suka`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aktif: !liked }),
      });
      setLiked(result.suka_saya); onJumlah(result.suka);
    } catch (error) {
      if (error instanceof KatalogError && error.status === 401) { setStatus('login'); router.push(login); }
      else if (error instanceof KatalogError && error.status === 403) {
        setStatus('ditolak'); setMessage('Tanda suka hanya untuk pengunjung. Akun staf tidak ikut dihitung.');
      } else setMessage(error instanceof KatalogError ? error.message : 'Tanda suka belum tersimpan. Coba lagi.');
    } finally { setBusy(false); }
  };

  return <div>
    <Tombol varian="sekunder" aria-pressed={liked} memuat={busy}
      disabled={status === 'memuat' || status === 'ditolak' || status === 'galat'} onClick={() => void send()}>
      {liked ? 'Batalkan suka' : 'Suka'}
    </Tombol>
    {status === 'memuat' && <p role="status">Memuat status suka...</p>}
    {message && <p role="status">{message}</p>}
    {status === 'galat' && <Tombol varian="hantu" onClick={() => {
      setStatus('memuat'); setAttempt((value) => value + 1);
    }}>Coba muat status suka</Tombol>}
  </div>;
}
