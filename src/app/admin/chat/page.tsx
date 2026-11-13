'use client';

// Live Chat staf (Tahap C, Fase 5; dipecah di refaktor G7): hanya merakit. Daftar sesi + pilihan + Realtime `chat-admin` =
// _hook/useDaftarSesi, utas pesan dan balasan = usePesanSesi, aksi (ambil, ambil alih, teruskan, selesaikan) = useAksiChat,
// referensi Layanan/petugas/topik = useReferensiStaf; tampilan di _bagian/, izin dan turunan murni di _logika/izinChat.ts,
// kueri dan permintaan route di lib/data/chat-staf.ts. Lingkup hak akses ditegakkan RLS/RPC/route (boleh_chat_sesi).
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Galat from '@/components/ui/Galat';
import Tombol from '@/components/ui/Tombol';
import type { RingkasSesi } from '@/lib/data/chat-staf';
import { alasanTanpaLayanan, izinSesi, labelStatus, namaPemegang } from './_logika/izinChat';
import { useAksiChat } from './_hook/useAksiChat';
import { useDaftarSesi } from './_hook/useDaftarSesi';
import { usePesanSesi } from './_hook/usePesanSesi';
import { useReferensiStaf } from './_hook/useReferensiStaf';
import DialogChat from './_bagian/DialogChat';
import PanelDaftar from './_bagian/PanelDaftar';
import PanelPercakapan from './_bagian/PanelPercakapan';
import styles from './chat.module.css';

export default function AdminChatPage() {
  const { toast } = useToast();
  const daftar = useDaftarSesi({ toast });
  const { selectedSession: terpilih } = daftar;
  const referensi = useReferensiStaf(daftar.role);
  const pengguna = { petugasId: daftar.petugasId, role: daftar.role };

  const tahap = terpilih ? daftar.tahapMap[terpilih.id] ?? null : null;
  const izin = terpilih ? izinSesi(terpilih, tahap, pengguna) : null;
  const pesan = usePesanSesi({
    sesiId: daftar.selectedId,
    selesai: terpilih?.status === 'selesai',
    bolehBalas: !!izin?.bolehBalas,
    rt: daftar.rt,
    langganPesanBaru: daftar.langganPesanBaru,
    muatDaftar: daftar.muatUlang,
    toast,
  });
  const aksi = useAksiChat({
    sesiId: terpilih?.id ?? null,
    layananId: terpilih?.layanan_id ?? null,
    toast,
    muatDaftar: daftar.muatUlang,
    muatPesan: () => pesan.muat(),
  });

  const pemegangDari = (s: RingkasSesi) => namaPemegang(s, referensi.petugasNama);
  const namaPengunjung = terpilih ? daftar.kontak[terpilih.id] || 'Pengunjung' : '';
  const alasanLibur = alasanTanpaLayanan(aksi.statusLayanan, referensi.layananNama[terpilih?.layanan_id ?? '']);

  const pilihSesi = (s: RingkasSesi) => {
    if (s.id !== daftar.selectedId) pesan.reset();
    daftar.pilih(s);
  };

  return (
    <>
      <PageHeader title="Live Chat" description="Tangani percakapan pengunjung, teruskan ke layanan, dan catat hasil penanganan." />
      <div className={styles.halaman}>
        {daftar.role === 'petugas' && (
          <CatatanKeadaan jenis="lingkup">Menampilkan percakapan dalam lingkup layanan Anda.</CatatanKeadaan>
        )}
        {alasanLibur && (
          <div role="status" data-testid="admin-chat-hari-tanpa-layanan" id="alasan-hari-tanpa-layanan">
            <CatatanKeadaan jenis="tanpa-layanan">{alasanLibur}</CatatanKeadaan>
          </div>
        )}
        {aksi.peringatan && (
          <CatatanKeadaan jenis="info" aksi={<Tombol varian="hantu" ukuran="kecil" onClick={aksi.tutupPeringatan}>Tutup</Tombol>}>
            {aksi.peringatan}
          </CatatanKeadaan>
        )}
        {daftar.penanganGalat && <Galat pesan="Gagal memuat status penanganan chat. Periksa status sebelum mengambil tindakan." onRetry={() => void daftar.muatUlang()} />}
        <div className={styles.layout} data-selected={terpilih ? 'true' : 'false'}>
          <PanelDaftar
            sesi={daftar.sesi}
            terpilihId={daftar.selectedId}
            memuat={daftar.loading}
            dimuat={daftar.dimuat}
            galat={daftar.galat}
            onMuatUlang={() => void daftar.muatUlang()}
            rt={daftar.rt}
            tampilSelesai={daftar.tampilSelesai}
            onTampilSelesai={daftar.setTampilSelesai}
            dibuka={daftar.dibuka}
            layananNama={referensi.layananNama}
            kontak={daftar.kontak}
            labelStatus={(s) => labelStatus(s, daftar.tahapMap[s.id] ?? null)}
            pemegang={pemegangDari}
            onPilih={pilihSesi}
          />
          <PanelPercakapan
            sesi={terpilih}
            izin={izin}
            namaPengunjung={namaPengunjung}
            namaLayanan={referensi.layananNama[terpilih?.layanan_id ?? ''] || '—'}
            pemegang={terpilih ? pemegangDari(terpilih) : null}
            alasanTanpaLayanan={alasanLibur}
            sibuk={aksi.sibuk}
            onAmbil={() => void aksi.ambil()}
            onBukaDialog={aksi.bukaDialog}
            onKembali={daftar.kembali}
            utas={{
              pesan: pesan.pesan,
              adaLebih: pesan.adaLebih,
              memuatRiwayat: pesan.memuatRiwayat,
              onMuatRiwayat: () => void pesan.muatRiwayatLebihLama(),
              isian: pesan.isian,
              onIsian: pesan.setIsian,
              onKirim: (teks) => void pesan.kirim(teks),
              mengirim: pesan.mengirim,
              galatKirim: pesan.galatKirim,
              mengirimFoto: pesan.mengirimFoto,
              onKirimFoto: (berkas) => void pesan.kirimFoto(berkas),
              memuatDraf: pesan.memuatDraf,
              onDraf: () => void pesan.buatDraf(),
            }}
          />
        </div>
      </div>

      <DialogChat
        jenis={aksi.dialog}
        sesi={terpilih}
        namaPengunjung={namaPengunjung}
        pemegang={terpilih ? pemegangDari(terpilih) : null}
        layananChat={referensi.layananChat}
        topikFo={referensi.topikFo}
        peranPemilik={izin?.peranPemilik ?? 'fo'}
        layananTahapId={tahap?.layanan_id ?? null}
        onTutup={aksi.tutupDialog}
        penangan={aksi.penangan}
      />
    </>
  );
}
