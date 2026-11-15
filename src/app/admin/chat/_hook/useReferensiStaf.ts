'use client';

// Daftar referensi kotak masuk chat staf (rencana refaktor 2026-11-11 tugas 7.1/7.2): nama Layanan, nama petugas, tujuan
// teruskan (Layanan aktif yang melayani chat), dan topik Front Office. Dimuat lewat `useReferensi` dengan `ttlMs: 0`: tanpa
// cache lintas halaman (data per pengguna dibatasi RLS dan perilaku lama = muat sekali saat halaman dibuka), hanya
// penggabungan permintaan. Gagal memuat = daftar kosong (label cadangan "Layanan"/"petugas lain"), seperti halaman lama.
import { useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useReferensi } from '@/lib/data/klien/useReferensi';
import {
  muatLayananChatStaf,
  muatNamaPetugasChat,
  muatTopikFoChat,
  type PeranStaf,
} from '@/lib/data/chat-staf';
import type { LayananChatOpsi } from '@/components/admin/ChatAksiDialog';

const TANPA_CACHE = { ttlMs: 0 };

export function useReferensiStaf(role: PeranStaf | null) {
  const layanan = useReferensi('chat-staf:layanan', () => muatLayananChatStaf(createClient()), TANPA_CACHE);
  const petugas = useReferensi('chat-staf:petugas', () => muatNamaPetugasChat(createClient()), TANPA_CACHE);
  // Topik FO hanya dipakai pemegang tahap FO (Front Office / Admin).
  const pakaiTopikFo = role === 'front_office' || role === 'admin';
  const topik = useReferensi(pakaiTopikFo ? 'chat-staf:topik-fo' : null, () => muatTopikFoChat(createClient()), TANPA_CACHE);

  const layananNama = useMemo(() => Object.fromEntries((layanan.data ?? []).map((l) => [l.id, l.nama])), [layanan.data]);
  const petugasNama = useMemo(() => Object.fromEntries((petugas.data ?? []).map((p) => [p.id, p.nama])), [petugas.data]);
  // Layanan aktif ber-chat = tujuan teruskan.
  const layananChat = useMemo<LayananChatOpsi[]>(
    () => (layanan.data ?? []).filter((l) => l.aktif !== false && l.punya_chat === true).map((l) => ({ id: l.id, nama: l.nama })),
    [layanan.data],
  );
  const topikFo = useMemo(() => (pakaiTopikFo ? topik.data ?? [] : []), [pakaiTopikFo, topik.data]);

  return { layananNama, petugasNama, layananChat, topikFo };
}
