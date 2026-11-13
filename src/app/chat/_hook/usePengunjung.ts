'use client';

// Identitas pengunjung chat (rencana refaktor 2026-11-11 tugas 6.3): cek login sekali saat halaman dibuka, lalu baris
// `pengunjung` (dibuat bila belum ada) lewat lib/data/chat-pengunjung.ts.
//
// Chat WAJIB login Google untuk PENGUNJUNG (keputusan pemilik): sesi anonim dan akun tanpa identitas Google (bukti dari
// data Auth, bukan user_metadata) diperlakukan seperti belum masuk. STAF sah (role di JWT) tetap boleh.
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { layakMemakaiChat, punyaIdentitasGoogle } from '@/lib/chat/identitas-google';
import {
  ambilPenggunaChat,
  buatProfilPengunjung,
  mulaiMasukGoogle,
  muatProfilPengunjung,
} from '@/lib/data/chat-pengunjung';

export function usePengunjung() {
  const [memeriksa, setMemeriksa] = useState(true);
  const [masuk, setMasuk] = useState(false);
  // K2: id baris pengunjung untuk chat_sesi.pengunjung_id agar RLS (pengunjung.auth_user_id = auth.uid()) dapat
  // memverifikasi kepemilikan sesi.
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);
  const [nama, setNama] = useState('');

  useEffect(() => {
    async function periksa() {
      try {
        const sb = createClient();
        const pengguna = await ambilPenggunaChat(sb);
        if (pengguna.error) throw pengguna.error.asli;
        const user = pengguna.data;
        if (!user || !layakMemakaiChat(user)) return;
        setMasuk(true);

        const muat = await muatProfilPengunjung(sb, user.id);
        if (muat.error) throw muat.error.asli;
        let profil = muat.data;
        const namaCadangan = user.user_metadata?.full_name || user.email?.split('@')[0];
        if (!profil) {
          // Belum ada baris pengunjung (mis. login Google pertama dan callback belum sempat membuatnya): dibuat untuk
          // user ini (policy pengunjung_self_insert). Gagal -> nama jatuh ke cadangan di bawah; cukup dicatat.
          const dibuat = await buatProfilPengunjung(sb, {
            auth_user_id: user.id,
            nama: namaCadangan || 'Pengunjung Anonim',
            email: user.email ?? null,
            provider: punyaIdentitasGoogle(user) ? 'google' : 'email',
          });
          if (dibuat.error) console.error('[chat] gagal membuat profil pengunjung', dibuat.error.asli);
          profil = dibuat.data;
        }

        if (profil?.id) setPengunjungId(profil.id);
        // Profil belum lengkap: nama Google sebagai cadangan.
        setNama(profil?.nama || namaCadangan || '');
      } catch (e) {
        console.error(e);
      } finally {
        setMemeriksa(false);
      }
    }
    void periksa();
  }, []);

  /** Login Google; `next` (sudah di-encode) membawa pengunjung kembali ke /chat dengan konteks yang sama. */
  const masukDenganGoogle = (next: string) => {
    void mulaiMasukGoogle(createClient(), `${window.location.origin}/auth/callback?next=${next}`);
  };

  return { memeriksa, masuk, pengunjungId, nama, setNama, masukDenganGoogle };
}
