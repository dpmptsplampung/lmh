'use client';

// Peran akun, daftar layanan, dan Pengaturan bot halaman Kelola FAQ (refaktor G8, tugas 8.2). Hook tanpa JSX: pemuatan lewat
// lib/data/faq.ts, aturan akses turunan di ../_logika/aksesFaq.ts. Galat baca peran dibedakan dari "memang tanpa akses"
// (roleError -> ErrorRetry); gagal memuat layanan tidak memblokir Front Office (hanya butuh FAQ umum). Selama peran belum
// terbukti, semua jalur tulis ditolak (RBAC Tahap 0: bot hidup/mati = Admin saja, dijaga di handler, bukan hanya di UI).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { muatLayananFaq, muatProfilFaq, ubahBotLayanan, type LayananFaq } from '@/lib/data/faq';
import { lingkupFaq, turunkanAksesFaq } from '../_logika/aksesFaq';

type Toast = (pesan: string, jenis?: 'success' | 'error' | 'warning' | 'info') => void;

export interface OpsiAksesFaq {
  toast: Toast;
}

export function useAksesFaq({ toast }: OpsiAksesFaq) {
  const [layananList, setLayananList] = useState<LayananFaq[]>([]);
  const [layananSelesai, setLayananSelesai] = useState(false); // daftar layanan sudah dimuat (sukses/gagal)
  const [layananError, setLayananError] = useState(false);
  const [layananMuatKe, setLayananMuatKe] = useState(0);
  const [layananMemuat, setLayananMemuat] = useState(false);
  const [role, setRole] = useState<string | null>(null); // null = belum dimuat (atau gagal dimuat: lihat roleError)
  const [roleError, setRoleError] = useState(false); // gagal membaca peran (jaringan/galat DB) != memang tanpa akses
  const [roleMuatKe, setRoleMuatKe] = useState(0);
  const [roleMemuat, setRoleMemuat] = useState(false);
  const [layananPetugasId, setLayananPetugasId] = useState<string | null>(null);
  const [botPilih, setBotPilih] = useState(''); // layanan di panel Pengaturan bot ('' = belum memilih)
  const [togglingBot, setTogglingBot] = useState(false);

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  // Muat layanan (diulang saat layananMuatKe naik). Kegagalan tidak memblokir Front Office; untuk admin/petugas
  // ditampilkan ErrorRetry (lihat layananGagalBlokir), bukan toast saja.
  useEffect(() => {
    let batal = false;
    muatLayananFaq(createClient()).then((h) => {
      if (batal) return;
      setLayananList(h.error ? [] : h.data);
      setLayananError(!!h.error);
      setLayananSelesai(true);
      setLayananMemuat(false);
    });
    return () => {
      batal = true;
    };
  }, [layananMuatKe]);

  // Peran (+ layanan untuk petugas) dari tabel petugas.
  useEffect(() => {
    let batal = false;
    muatProfilFaq(createClient()).then((h) => {
      if (batal) return;
      if (h.error) {
        setRoleError(true);
        toastRef.current('Gagal memuat hak akses Anda', 'error');
      } else {
        setLayananPetugasId(h.data.layananId);
        setRole(h.data.role);
        setRoleError(false);
      }
      setRoleMemuat(false);
    });
    return () => {
      batal = true;
    };
  }, [roleMuatKe]);

  const muatUlangLayanan = () => {
    if (layananMemuat) return;
    setLayananMemuat(true);
    setLayananMuatKe((n) => n + 1);
  };

  const muatUlangRole = () => {
    if (roleMemuat) return;
    setRoleMemuat(true);
    setRoleMuatKe((n) => n + 1);
  };

  const akses = useMemo(
    () => turunkanAksesFaq({ role, layananPetugasId, layananList, layananSelesai, layananError, botPilih }),
    [role, layananPetugasId, layananList, layananSelesai, layananError, botPilih],
  );
  // Identitas stabil selama peran/layanan petugas tidak berubah (menggerakkan muat ulang daftar FAQ).
  const lingkup = useMemo(() => lingkupFaq(role, layananPetugasId), [role, layananPetugasId]);

  // Bot hidup/mati per layanan (Admin saja; dijaga di handler, bukan hanya di UI).
  const ubahBot = async (id: string, aktifSekarang: boolean) => {
    if (!akses.isAdmin || togglingBot) return;
    setTogglingBot(true);
    const baru = !aktifSekarang;
    const h = await ubahBotLayanan(createClient(), id, baru);
    if (h.error) {
      toast(`Gagal memperbarui status bot. ${h.error.pesan}`, 'error');
    } else {
      setLayananList((prev) => prev.map((l) => (l.id === id ? { ...l, chatbot_aktif: baru } : l)));
      toast(baru ? 'Bot layanan ini diaktifkan.' : 'Bot layanan ini dinonaktifkan.', 'success');
    }
    setTogglingBot(false);
  };

  return {
    ...akses,
    lingkup,
    /** null = belum dimuat. */
    role,
    roleError,
    roleMemuat,
    layananMemuat,
    togglingBot,
    setBotPilih,
    muatUlangRole,
    muatUlangLayanan,
    ubahBot,
  };
}

export type AksesFaqHook = ReturnType<typeof useAksesFaq>;
