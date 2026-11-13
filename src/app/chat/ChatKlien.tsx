'use client';

// Pulau klien /chat (rencana refaktor 2026-11-11 tugas 6.4 dan 6.5): merakit hook (mesin keadaan, sesi, pesan, kirim, status
// layanan, daftar percakapan) dan meneruskan hasilnya ke bagian tampilan di `_bagian/`. page.tsx (server) memuat Layanan dan
// FAQ publik dan mengoperkannya sebagai `layananAwal`/`faqAwal`; tanpa itu (null/kosong) data dimuat dari browser.
import { useState } from 'react';
import styles from './chat.module.css';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import type { FaqChat, LayananChat } from '@/lib/data/chat-pengunjung';
import { modeBot, modePercakapan } from './_logika/mesinChat';
import { hanyaBaca as hitungHanyaBaca, idPesanPengunjungTerakhir, layananPercakapan, placeholderPesan, tampilanAktif as hitungTampilanAktif } from './_logika/turunan';
import { useDaring } from './_hook/useDaring';
import { usePengunjung } from './_hook/usePengunjung';
import { useReferensiChat } from './_hook/useReferensiChat';
import { useMesinChat } from './_hook/useMesinChat';
import { usePesan } from './_hook/usePesan';
import { bacaParamLayanan, useSesiChat, type PersetujuanChat } from './_hook/useSesiChat';
import { useDaftarPercakapan } from './_hook/useDaftarPercakapan';
import { useStatusLayanan } from './_hook/useStatusLayanan';
import { useKirim } from './_hook/useKirim';
import BilahAtas from './_bagian/BilahAtas';
import JendelaPercakapan from './_bagian/JendelaPercakapan';
import LayarAwal from './_bagian/LayarAwal';

const CONSENT_VERSION = '1.0';

export interface ChatKlienProps {
  /** Layanan chat dari server; null/tidak ada = dimuat dari browser. */
  layananAwal?: LayananChat[] | null;
  /** FAQ aktif seluruh layanan dari server; null/tidak ada = dimuat dari browser per layanan. */
  faqAwal?: FaqChat[] | null;
}

export default function ChatKlien({ layananAwal = null, faqAwal = null }: ChatKlienProps) {
  const isOnline = useDaring();
  const pengunjung = usePengunjung();
  const referensi = useReferensiChat({ layanan: layananAwal, faq: faqAwal });
  const mesin = useMesinChat();
  const { keadaan } = mesin;
  const { sesiId, status: sesiStatus, layananId: selectedLayananId } = keadaan;
  const pesan = usePesan(mesin);

  // I8: persetujuan PDP wajib sebelum percakapan baru. Percakapan yang dibuka dari daftar menandainya tercentang.
  const [consentGiven, setConsentGiven] = useState(false);
  const sesi = useSesiChat({
    mesin,
    pesan,
    layanan: referensi.layanan,
    muatFaq: referensi.muatFaq,
    pengunjungId: pengunjung.pengunjungId,
    namaPengunjung: pengunjung.nama,
    daring: isOnline,
    onPercakapanDibuka: () => setConsentGiven(true),
  });
  const daftar = useDaftarPercakapan({
    aktif: !pengunjung.memeriksa && !referensi.memuatLayanan && pengunjung.masuk,
    pengunjungId: pengunjung.pengunjungId,
    layanan: referensi.layanan,
    onPertama: sesi.putuskanAwal,
  });
  const jadwal = useStatusLayanan({ aktif: keadaan.tampilan === 'percakapan', layananId: selectedLayananId });
  const { status: statusLayanan, tutup } = jadwal;

  const sesiLayanan = layananPercakapan(referensi.layanan, keadaan.sesiLayananId, selectedLayananId);
  const botAktif = sesiLayanan?.chatbot_aktif === true;
  const sesiLayananNama = referensi.layanan.find((l) => l.id === keadaan.sesiLayananId)?.nama;
  // Layanan yang sudah diarsipkan / tidak lagi punya chat: percakapan hanya bisa dibaca.
  const hanyaBaca = hitungHanyaBaca({
    tampilan: keadaan.tampilan, memuatLayanan: referensi.memuatLayanan, galatLayanan: referensi.galatLayanan, adaLayanan: !!sesiLayanan,
  });
  const kiriman = useKirim({
    mesin, pesan, pastikanSesi: sesi.pastikanSesi, daring: isOnline, hanyaBaca, botAktif, tutupRef: jadwal.tutupRef,
  });

  // S1/K11: baris consent_log yang di-insert useSesiChat SEBELUM sesi dibuat (gagal = sesi tidak dibuat). subjek_ref diisi
  // hook dari baris pengunjung/auth (bukan 'anon'). Tanpa centang tidak ada baris, sehingga percakapan baru tidak dimulai.
  const persetujuan = (): PersetujuanChat | null => {
    if (!consentGiven) return null;
    return { tujuan: 'chat_followup', disetujui: true, versi_kebijakan: CONSENT_VERSION };
  };
  const percakapanTerpilih = daftar.daftar.find((d) => d.layananId === selectedLayananId);
  const mulaiSesi = () => void sesi.mulaiSesi({ persetujuan: persetujuan(), ada: percakapanTerpilih });

  // Halaman riwayat lebih lama berjangkar pada sesi terbuka, atau sesi terakhir percakapan bila semua sesi selesai.
  const sesiTerakhirPercakapan = percakapanTerpilih?.sesiTerakhirId;

  // A-10: layanan terpilih yang sudah punya percakapan dibuka langsung (tanpa centang persetujuan lagi).
  const adaPercakapanTerpilih = !!selectedLayananId && !!percakapanTerpilih;

  // A-03: parameter ?layanan= mentah (id atau nama) diteruskan lewat `next` agar konteks tidak hilang saat login.
  const layananUrlMentah = bacaParamLayanan();
  const masukDenganGoogle = () => {
    const next = layananUrlMentah ? encodeURIComponent(`/chat?layanan=${encodeURIComponent(layananUrlMentah)}`) : '/chat';
    pengunjung.masukDenganGoogle(next);
  };

  const tampilanAktif = hitungTampilanAktif({
    tampilan: keadaan.tampilan, memeriksa: pengunjung.memeriksa, masuk: pengunjung.masuk, daftarSiap: daftar.siap,
  });
  const mode = modePercakapan(keadaan, { tutup, hanyaBaca });

  return (
    <div className={styles.chatPage} data-tema="dasbor">
      <BilahAtas />

      <div className={styles.chatContainer}>
        {tampilanAktif !== 'percakapan' && (
          <LayarAwal
            tampilan={tampilanAktif}
            daftar={{
              items: daftar.daftar,
              dibaca: daftar.dibaca,
              memuat: daftar.memuat,
              galat: daftar.galat,
              onCobaLagi: daftar.muatUlang,
              onBuka: sesi.bukaPercakapan,
              onBaru: () => sesi.tampilkan('baru', true),
            }}
            baru={{
              galatSetup: keadaan.galat.setup,
              onKembaliKeDaftar: () => sesi.tampilkan('daftar'),
              formulir: {
                memeriksa: pengunjung.memeriksa,
                masuk: pengunjung.masuk,
                nama: pengunjung.nama,
                onNama: pengunjung.setNama,
                layananUrlMentah,
                onMasukGoogle: masukDenganGoogle,
                layanan: referensi.layanan,
                layananId: selectedLayananId,
                onPilihLayanan: sesi.pilihLayanan,
                memuatLayanan: referensi.memuatLayanan,
                galatLayanan: referensi.galatLayanan,
                onCobaLagiLayanan: referensi.cobaLagiLayanan,
                layananBerpercakapan: daftar.daftar.map((d) => d.layananId),
                adaPercakapanTerpilih,
                consentGiven,
                onConsent: (dicentang) => {
                  setConsentGiven(dicentang);
                  sesi.hapusGalatConsent();
                },
                galatConsent: keadaan.galat.consent,
                onCobaLagiConsent: mulaiSesi,
                memulai: keadaan.memulai,
                daring: isOnline,
                onMulai: mulaiSesi,
              },
            }}
          />
        )}

        {tampilanAktif === 'percakapan' && (
          <JendelaPercakapan
            status={{
              mode,
              tutup,
              botAktif,
              hanyaBaca,
              daring: isOnline,
              sesiLayananNama,
              statusLayanan,
              onKembali: () => { sesi.kembali(); daftar.muatUlang(); },
              onMintaPetugas: kiriman.mintaPetugas,
            }}
            daftarPesan={pesan.pesan}
            idTerkirim={idPesanPengunjungTerakhir(pesan.pesan)}
            mengetik={kiriman.mengetik}
            riwayat={{
              galat: pesan.galatRiwayat,
              memuat: pesan.memuatRiwayat,
              adaLebih: pesan.adaLebih,
              onCobaLagi: () => pesan.cobaLagiRiwayat(sesiTerakhirPercakapan),
              onMuatLebihLama: () => void pesan.muatLebihLama(sesiTerakhirPercakapan),
            }}
            faq={{
              aktif: modeBot(sesiStatus, tutup, botAktif) && !!sesiId,
              galat: referensi.galatFaq,
              memuat: referensi.memuatFaq,
              daftar: referensi.faq,
              onCobaLagi: () => void referensi.muatFaq(keadaan.sesiLayananId ?? selectedLayananId),
              onPilih: kiriman.kirimTeks,
            }}
            masukan={{
              placeholder: placeholderPesan({ daring: isOnline, hanyaBaca, sesiId, status: sesiStatus }),
              nonaktif: hanyaBaca || !isOnline || kiriman.mengirimFoto,
              onKirim: kiriman.kirimTeks,
              onKirimFoto: (berkas) => void kiriman.kirimFoto(berkas),
            }}
            onKirimUlang={kiriman.kirimUlang}
          />
        )}
      </div>
    </div>
  );
}
