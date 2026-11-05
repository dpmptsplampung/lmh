'use client';

// A1 + A3: panel "Sekarang" di atas tabel Antrean. Menampilkan tiket yang sedang saya layani dan tiket berikutnya,
// dengan tombol yang memakai penangan halaman (panggil_tiket, layanan_mulai, selesai) tanpa logika baru.
// Pintasan satu huruf (N, U, M, S, ?) hanya aktif saat fokus ada di dalam panel dan bukan di isian (WCAG 2.1.4).

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BellRing, CheckCircle2, Keyboard, Megaphone, Play, Repeat2 } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import { cn, formatWaktu } from '@/lib/utils';
import styles from './PanelSekarang.module.css';

export interface TiketPanel {
  id: string;
  nomor_display: string;
  layananNama: string;
  namaPengunjung: string;
  /** Waktu mulai dilayani (tiket saya) atau waktu masuk/terbit (tiket berikutnya), ISO. */
  waktu: string | null;
  bolehMulai: boolean;
  bolehSelesai: boolean;
}

export interface OpsiLayananPanel {
  id: string;
  nama: string;
}

export interface PanelSekarangProps {
  /** Tiket berstatus dilayani yang saya miliki; null bila tidak ada. */
  sedangDilayani: TiketPanel | null;
  /** Tiket menunggu bernomor terkecil di Layanan terpilih; null bila tidak ada. */
  berikutnya: TiketPanel | null;
  /** Admin/FO yang melihat banyak Layanan memilih Layanan dulu. Kosong atau satu opsi = tanpa pemilih. */
  layananOpsi?: OpsiLayananPanel[];
  layananId?: string | null;
  onLayananChange?: (id: string) => void;
  /** Tiket yang tombol Panggil-nya sedang terkunci (jeda klik ganda). */
  sedangPanggil: (tiketId: string) => boolean;
  /** Tiket yang sedang diproses (Mulai/Selesai berjalan). */
  sedangProses: (tiketId: string) => boolean;
  /** Mengembalikan true bila panggilan tersiar ke layar TV. */
  onPanggil: (t: TiketPanel) => Promise<boolean | void> | boolean | void;
  onMulai: (t: TiketPanel) => unknown;
  onSelesai: (t: TiketPanel) => unknown;
  /** Front Office tidak melayani tiket: blok "Sedang saya layani" disembunyikan. */
  tanpaTiketSaya?: boolean;
  /** Waktu acuan untuk durasi berjalan (untuk tes). */
  sekarang?: () => number;
}

/** "12 mnt", "1 j 5 mnt", "< 1 mnt". Seragam di panel dan tabel. */
export function formatDurasiSingkat(menit: number): string {
  const m = Math.max(0, Math.floor(menit));
  if (m < 1) return '< 1 mnt';
  if (m < 60) return `${m} mnt`;
  const jam = Math.floor(m / 60);
  const sisa = m % 60;
  return sisa === 0 ? `${jam} j` : `${jam} j ${sisa} mnt`;
}

const BARIS_PINTASAN: Array<[string, string]> = [
  ['N', 'Panggil berikutnya'],
  ['U', 'Panggil ulang'],
  ['M', 'Mulai layanan'],
  ['S', 'Selesai'],
  ['?', 'Tampilkan atau sembunyikan daftar ini'],
];

function dalamIsian(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

export default function PanelSekarang({
  sedangDilayani,
  berikutnya,
  layananOpsi = [],
  layananId = null,
  onLayananChange,
  sedangPanggil,
  sedangProses,
  onPanggil,
  onMulai,
  onSelesai,
  tanpaTiketSaya = false,
  sekarang = Date.now,
}: PanelSekarangProps) {
  const idPemilih = useId();
  const idBantuan = useId();
  const [dipanggilId, setDipanggilId] = useState<string | null>(null);
  const [bantuan, setBantuan] = useState(false);
  const [waktuKini, setWaktuKini] = useState(() => sekarang());
  const isiRef = useRef<HTMLDivElement>(null);
  const fokusSetelahPanggil = useRef(false);

  // Durasi berjalan diperbarui per 30 detik (satuan terkecil yang tampil adalah menit).
  useEffect(() => {
    const t = setInterval(() => setWaktuKini(sekarang()), 30_000);
    return () => clearInterval(t);
  }, [sekarang]);

  // Setelah Panggil, fokus pindah ke langkah berikutnya yang masuk akal: "Mulai layanan".
  useEffect(() => {
    if (fokusSetelahPanggil.current && dipanggilId) {
      isiRef.current?.querySelector<HTMLElement>('[data-mulai]')?.focus();
    }
    fokusSetelahPanggil.current = false;
  }, [dipanggilId]);

  const sibukBerikutnya = berikutnya ? sedangProses(berikutnya.id) : false;
  const terkunciPanggil = berikutnya ? sedangPanggil(berikutnya.id) : false;
  const sudahDipanggil = !!berikutnya && dipanggilId === berikutnya.id;
  const sibukSaya = sedangDilayani ? sedangProses(sedangDilayani.id) : false;

  const panggil = async () => {
    if (!berikutnya || terkunciPanggil) return;
    const hasil = await onPanggil(berikutnya);
    if (hasil !== false) {
      fokusSetelahPanggil.current = true;
      setDipanggilId(berikutnya.id);
    }
  };
  const panggilUlang = () => {
    if (!berikutnya || !sudahDipanggil || terkunciPanggil) return;
    void onPanggil(berikutnya);
  };
  const mulai = () => {
    if (!berikutnya?.bolehMulai || sibukBerikutnya) return;
    void onMulai(berikutnya);
  };
  const selesai = () => {
    if (!sedangDilayani?.bolehSelesai || sibukSaya) return;
    void onSelesai(sedangDilayani);
  };

  const tanganiKunci = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    if (dalamIsian(e.target)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '?') {
      e.preventDefault();
      setBantuan((v) => !v);
    } else if (k === 'n') {
      e.preventDefault();
      void panggil();
    } else if (k === 'u') {
      e.preventDefault();
      panggilUlang();
    } else if (k === 'm') {
      e.preventDefault();
      mulai();
    } else if (k === 's') {
      e.preventDefault();
      selesai();
    }
  };

  const menitSejak = (iso: string | null) =>
    iso ? Math.max(0, (waktuKini - new Date(iso).getTime()) / 60000) : null;
  const durasiSaya = menitSejak(sedangDilayani?.waktu ?? null);
  const tungguBerikutnya = menitSejak(berikutnya?.waktu ?? null);
  const banyakLayanan = layananOpsi.length > 1;

  const pemilih = banyakLayanan ? (
    <div className={styles.pemilih}>
      <label htmlFor={idPemilih} className={styles.labelPemilih}>Layanan</label>
      <select
        id={idPemilih}
        className={styles.select}
        value={layananId ?? ''}
        onChange={(e) => onLayananChange?.(e.target.value)}
      >
        {layananOpsi.map((l) => (
          <option key={l.id} value={l.id}>{l.nama}</option>
        ))}
      </select>
    </div>
  ) : null;

  return (
    <Kartu
      judul="Sekarang"
      aksi={
        <div className={styles.aksiKepala}>
          {pemilih}
          <Tombol
            varian="hantu"
            ukuran="kecil"
            ikon={Keyboard}
            aria-expanded={bantuan}
            aria-controls={bantuan ? idBantuan : undefined}
            onClick={() => setBantuan((v) => !v)}
          >
            Pintasan
          </Tombol>
        </div>
      }
      className={styles.panel}
    >
      {/* Penangkap pintasan: hanya meneruskan tombol yang ditekan di dalam panel. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={isiRef} className={cn(styles.isi, tanpaTiketSaya && styles.isiTunggal)} onKeyDown={tanganiKunci}>
        {!tanpaTiketSaya && (
        <div className={styles.blok} aria-labelledby={`${idBantuan}-saya`} role="group">
          <p id={`${idBantuan}-saya`} className={styles.penanda}>Sedang saya layani</p>
          {sedangDilayani ? (
            <>
              <p className={styles.nomor}>{sedangDilayani.nomor_display}</p>
              <p className={styles.nama} title={sedangDilayani.namaPengunjung}>{sedangDilayani.namaPengunjung}</p>
              <p className={styles.meta}>
                {sedangDilayani.layananNama}
                {durasiSaya !== null && <> · Berjalan {formatDurasiSingkat(durasiSaya)}</>}
              </p>
              <div className={styles.tombol}>
                {sedangDilayani.bolehSelesai && (
                  <Tombol
                    varian="sekunder"
                    ikon={CheckCircle2}
                    onClick={selesai}
                    disabled={sibukSaya}
                    memuat={sibukSaya}
                  >
                    {sibukSaya ? 'Memproses…' : 'Selesai'}
                  </Tombol>
                )}
                {sedangDilayani.bolehSelesai && <kbd className={styles.kbd} aria-hidden="true">S</kbd>}
              </div>
            </>
          ) : (
            <p className={styles.kosong}>Belum ada tiket yang sedang Anda layani.</p>
          )}
        </div>
        )}

        <div className={styles.blok} aria-labelledby={`${idBantuan}-berikut`} role="group">
          <p id={`${idBantuan}-berikut`} className={styles.penanda}>Berikutnya</p>
          {berikutnya ? (
            <>
              <p className={styles.nomor}>
                {berikutnya.nomor_display}
                {sudahDipanggil && (
                  <Lencana nada="info" ikon={BellRing} className={styles.lencanaPanggil}>Sudah dipanggil</Lencana>
                )}
              </p>
              <p className={styles.nama} title={berikutnya.namaPengunjung}>{berikutnya.namaPengunjung}</p>
              <p className={styles.meta}>
                {berikutnya.layananNama}
                {berikutnya.waktu && <> · Masuk {formatWaktu(berikutnya.waktu)}</>}
                {tungguBerikutnya !== null && <> · Menunggu {formatDurasiSingkat(tungguBerikutnya)}</>}
              </p>
              <div className={styles.tombol}>
                <Tombol
                  varian="utama"
                  ikon={Megaphone}
                  onClick={() => void panggil()}
                  disabled={terkunciPanggil}
                  aria-keyshortcuts="N"
                >
                  {terkunciPanggil ? 'Terpanggil' : 'Panggil berikutnya'}
                </Tombol>
                <kbd className={styles.kbd} aria-hidden="true">N</kbd>
                <Tombol
                  varian="sekunder"
                  ikon={Repeat2}
                  onClick={panggilUlang}
                  disabled={!sudahDipanggil || terkunciPanggil}
                  aria-keyshortcuts="U"
                >
                  Panggil ulang
                </Tombol>
                <kbd className={styles.kbd} aria-hidden="true">U</kbd>
                {berikutnya.bolehMulai && (
                  <>
                    <Tombol
                      data-mulai="true"
                      varian="sekunder"
                      ikon={Play}
                      onClick={mulai}
                      disabled={sibukBerikutnya}
                      memuat={sibukBerikutnya}
                      aria-keyshortcuts="M"
                    >
                      {sibukBerikutnya ? 'Memproses…' : 'Mulai layanan'}
                    </Tombol>
                    <kbd className={styles.kbd} aria-hidden="true">M</kbd>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className={styles.kosong}>Tidak ada tiket yang menunggu di Layanan ini.</p>
          )}
        </div>
      </div>

      {bantuan && (
        <div id={idBantuan} className={styles.bantuan} role="region" aria-label="Daftar pintasan papan ketik">
          <p className={styles.bantuanJudul}>
            Pintasan papan ketik. Fokuskan salah satu tombol di panel ini, lalu tekan huruf berikut. Tidak aktif saat mengetik di isian.
          </p>
          <dl className={styles.daftar}>
            {BARIS_PINTASAN.map(([tombol, arti]) => (
              <div key={tombol} className={styles.barisPintasan}>
                <dt><kbd className={styles.kbd}>{tombol}</kbd></dt>
                <dd>{arti}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Kartu>
  );
}
