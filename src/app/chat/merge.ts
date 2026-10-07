import { useEffect, useRef } from 'react';

// Pesan chat yang dipakai halaman pengunjung & admin. `local` menandai pesan
// yang hanya ada di browser: 'pending'/'failed' = kiriman optimistic,
// 'notice' = pemberitahuan lokal (sambutan, rate-limit, error AI).
export interface ChatMsg {
  id: string;
  pengirim: 'pengunjung' | 'bot' | 'petugas';
  isi: string;
  created_at: string;
  client_uuid?: string | null;
  local?: 'pending' | 'failed' | 'notice';
  // notice sementara (mis. "masih diproses"): hilang otomatis saat pesan bot asli tiba.
  transient?: boolean;
}

export const waktuLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/**
 * Gabungkan pesan server (poll penuh atau satu event realtime) ke state.
 * - Pesan server di-union per id (urutan created_at).
 * - Pesan lokal dibuang bila sudah terwakili server: client_uuid sama, atau
 *   notice yang isinya sama persis dengan pesan bot dari server.
 * - Pesan lokal lain (pending/failed/notice) dipertahankan.
 */
export function mergeMessages(prev: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const byId = new Map<string, ChatMsg>();
  for (const m of prev) if (!m.local) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, { ...m, local: undefined });
  const server = [...byId.values()];

  const uuids = new Set(server.map((m) => m.client_uuid).filter(Boolean));
  const botTexts = new Set(server.filter((m) => m.pengirim === 'bot').map((m) => m.isi));
  const locals = prev.filter((m) => {
    if (!m.local) return false;
    if (m.client_uuid && uuids.has(m.client_uuid)) return false;
    if (m.local === 'notice' && botTexts.has(m.isi)) return false;
    if (m.transient && server.some((s) => s.pengirim === 'bot' && s.created_at >= m.created_at)) return false;
    return true;
  });

  return [...server, ...locals].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Throttle leading + trailing: panggilan pertama langsung, sisanya digabung jadi satu di akhir jendela. */
export function makeThrottle(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const tick = () => {
    timer = null;
    if (pending) {
      pending = false;
      fn();
      timer = setTimeout(tick, ms);
    }
  };
  return {
    call() {
      if (timer) {
        pending = true;
        return;
      }
      fn();
      timer = setTimeout(tick, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}

export type RtState = 'connecting' | 'ok' | 'down';

export function rtFromStatus(status: string): RtState {
  if (status === 'SUBSCRIBED') return 'ok';
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') return 'down';
  return 'connecting';
}

/** Catch-up: panggil fn setiap kali channel menjadi SUBSCRIBED (awal & reconnect). */
export function useOnSubscribed(rt: RtState, fn: () => void, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (enabled && rt === 'ok') ref.current();
  }, [rt, enabled]);
}

/**
 * Sinkronisasi cadangan: poll hanya bila realtime tidak SUBSCRIBED (fastMs),
 * atau jarang (slowMs, null = mati) saat sehat. Tab tersembunyi tidak
 * di-poll; kembali terlihat / online memicu refetch langsung.
 */
export function useFallbackPoll(
  refetch: () => void,
  rt: RtState,
  opts: { fastMs: number; slowMs: number | null; enabled?: boolean },
) {
  const fn = useRef(refetch);
  useEffect(() => {
    fn.current = refetch;
  });
  const { fastMs, slowMs, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const ms = rt === 'ok' ? slowMs : fastMs;
    const timer = ms
      ? setInterval(() => {
          if (!document.hidden) fn.current();
        }, ms)
      : null;
    const wake = () => {
      if (!document.hidden) fn.current();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [rt, fastMs, slowMs, enabled]);
}
