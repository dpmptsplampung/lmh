'use client';

// Status jadwal petugas chat Layanan percakapan (rencana refaktor 2026-11-11 tugas 6.3; keputusan di DB, Fase 5): spanduk
// "di luar jam" dan pilihan teks bot. Dimuat saat percakapan dibuka lalu disegarkan tiap STATUS_SEGAR_MS; selama tab
// tersembunyi tidak ada permintaan, dan satu pemuatan dilakukan saat tab terlihat lagi (SPEC 6.3).
import { useEffect, useRef, useState } from 'react';
import type { StatusLayananChat } from '@/lib/chat/status-layanan';
import { adalahUuid, ambilStatusLayananChat } from '@/lib/data/chat-pengunjung';

export const STATUS_SEGAR_MS = 60_000;

export function useStatusLayanan({ aktif, layananId }: { aktif: boolean; layananId: string }) {
  const [mentah, setMentah] = useState<{ layananId: string; status: StatusLayananChat } | null>(null);
  // Status milik Layanan lain (percakapan sebelumnya) tidak dipakai.
  const status = mentah && mentah.layananId === layananId ? mentah.status : null;
  const tutup = status ? !status.buka : false;
  const tutupRef = useRef(false);
  useEffect(() => {
    tutupRef.current = tutup;
  }, [tutup]);

  useEffect(() => {
    if (!aktif || !adalahUuid(layananId)) return;
    let batal = false;
    const muat = async () => {
      const h = await ambilStatusLayananChat(layananId);
      // Tanpa status (galat/balasan tak sah): tidak ada spanduk; DB tetap penegak.
      if (!batal && h.data) setMentah({ layananId, status: h.data });
    };
    void muat();
    const t = setInterval(() => {
      if (!document.hidden) void muat();
    }, STATUS_SEGAR_MS);
    const terlihat = () => {
      if (!document.hidden) void muat();
    };
    document.addEventListener('visibilitychange', terlihat);
    return () => {
      batal = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', terlihat);
    };
  }, [aktif, layananId]);

  return { status, tutup, tutupRef };
}
