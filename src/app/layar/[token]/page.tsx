'use client';

// WP-29 / DSP-01..07: Token-gated TV queue display.
// DSP-07: accessed via /layar/[token] — no login required.
// DSP-06/I-14: never displays nama or kontak_hp (reads v_layar_antrian).
// DSP-02: realtime updates via siaran antrean:publik + polling fallback.
// DSP-03: robust reconnection for days-long display.
// Audit T4: gangguan jaringan BUKAN token invalid — hanya jawaban RPC `false` yang eksplisit.
// Gangguan → "Menghubungkan ulang…", data terakhir dipertahankan, coba-ulang backoff eksponensial.
// Perbaikan layar TV (.tim/layar-tv/KONTRAK.md): hanya layanan yang BERJADWAL HARI INI tampil sepanjang hari
// (RPC layanan_status_hari_ini); tidak ada layanan berjadwal = kanvas terang polos; paling banyak 8 kartu per
// halaman, berganti tiap 8 detik; urutan dan nama tampil khusus layar; pita panggilan + bunyi; teks berjalan
// berisi pengumuman bergantian. Semua kartu muat SATU layar tanpa scroll (kisi dihitung, ukuran teks
// mengikuti ukuran kartu lewat container query).

import { useEffect, useState, useCallback, use } from 'react';
import { Loader2, Monitor, WifiOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { APP_NAME } from '@/lib/constants';
import { formatTanggal, formatWaktu } from '@/lib/utils';
import PanggilanTerakhir from '@/lib/layar/PanggilanTerakhir';
import { useLayarMenyala } from '@/lib/layar/useLayarMenyala';
import { backoffMs, denganBatas } from '@/lib/layar/koneksi';
import { useAntreanFeed } from '@/lib/layar/useAntreanFeed';
import { ambilStatusBuka, useRasioArea } from '@/lib/layar/layananBuka';
import {
  kisiHalaman,
  namaTampil,
  posisiKartu,
  saringBerjadwalHariIni,
  urutkanLayar,
} from '@/lib/layar/tataLayar';
import { useHalaman } from '@/lib/layar/useHalaman';
import { usePanggilanLayar } from '@/lib/layar/usePanggilanLayar';
import { useBunyi } from '@/lib/layar/useBunyi';
import { KUNCI_PENGUMUMAN_LAYAR, bacaPengumuman } from '@/lib/layar/pengaturan';
import PitaPanggilan from '@/lib/layar/PitaPanggilan';
import TeksBerjalan from '@/lib/layar/TeksBerjalan';
import styles from './layar-token.module.css';

/** Pengumuman dibaca ulang berkala agar perubahan dari halaman Layar admin sampai ke TV tanpa muat ulang. */
const SEGARKAN_PENGUMUMAN_MS = 5 * 60_000;

interface LoketStatus {
  layanan_id: string;
  layanan_nama: string;
  /** Kolom v_layar_antrian (migrasi layar TV); tidak ada sebelum migrasi diterapkan. */
  nama_layar?: string | null;
  nama_tampil?: string | null;
  urutan_layar?: number | null;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  nomor_sedang_dilayani: number | null;
  // Format 'OS-014' (2 huruf + tanda hubung + 3 digit) — diperlakukan sebagai teks buram.
  nomor_display_dilayani: string | null;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
}

type StatusToken = 'memeriksa' | 'valid' | 'tidak_valid' | 'gangguan';

/** Kisi satu halaman: jumlah kolom dan baris (setengah kartu per petak) diteruskan ke CSS lewat variabel. */
function kisiStyle(kolom: number, baris: number): React.CSSProperties {
  return { '--kolom': String(kolom), '--baris': String(baris) } as React.CSSProperties;
}

export default function LayarTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [statusToken, setStatusToken] = useState<StatusToken>('memeriksa');
  const [clock, setClock]             = useState<Date | null>(null);
  const [daftarPengumuman, setDaftarPengumuman] = useState<string[]>([]);
  // Jadwal terbaca? Tidak terbaca (RPC gagal atau belum ada) = semua layanan tampil dengan tanda kecil.
  const [jadwalDiketahui, setJadwalDiketahui] = useState(true);
  const { ref: refKisi, rasio } = useRasioArea();

  // Validasi token. Hanya `data === false` (RPC menjawab eksplisit) yang berarti tidak valid;
  // error/jaringan/timeout/jawaban tak terduga = gangguan → coba lagi dengan backoff.
  useEffect(() => {
    let batal = false;
    let gagal = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cek = async () => {
      let hasil: StatusToken = 'gangguan';
      try {
        const supabase = createClient();
        const { data, error: rpcErr } = await denganBatas(
          supabase.rpc('validate_layar_token', { p_token: token.replace(/\s/g, '') }),
        );
        if (!rpcErr) {
          if (data === true) hasil = 'valid';
          else if (data === false) hasil = 'tidak_valid';
        }
      } catch {
        hasil = 'gangguan';
      }
      if (batal) return;
      setStatusToken(hasil);
      if (hasil === 'gangguan') {
        gagal += 1;
        timer = setTimeout(() => { void cek(); }, backoffMs(gagal));
      }
    };
    void cek();

    return () => {
      batal = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  // Pengumuman teks berjalan (DSP-05): sampai 3 kunci site_settings, dibaca ulang berkala.
  useEffect(() => {
    let batal = false;
    const muat = () => {
      getSiteSettings([...KUNCI_PENGUMUMAN_LAYAR]).then(s => {
        if (!batal) setDaftarPengumuman(bacaPengumuman(s));
      }).catch(() => {});
    };
    muat();
    const t = setInterval(muat, SEGARKAN_PENGUMUMAN_MS);
    return () => { batal = true; clearInterval(t); };
  }, []);

  const ambil = useCallback(async () => {
    const supabase = createClient();
    const [hasil, status] = await Promise.all([
      supabase.from('v_layar_antrian').select('*'),
      ambilStatusBuka(supabase),
    ]);
    const semua = hasil.data as LoketStatus[] | null;
    if (semua) setJadwalDiketahui(status !== null);
    return { data: semua ? urutkanLayar(saringBerjadwalHariIni(semua, status)) : null, error: hasil.error };
  }, []);

  // Siaran realtime (debounce) + polling + backoff saat gangguan — lihat useAntreanFeed.
  const { data: lokets, updatedAt, reconnecting } = useAntreanFeed<LoketStatus>({
    aktif: statusToken === 'valid',
    ambil,
  });
  const siap = updatedAt !== null;

  // Halaman 8 kartu, berganti tiap 8 detik; kisi dihitung dari halaman PENUH agar ukuran kartu tetap.
  const { item: kartu, indeks: halamanKe, total: jumlahHalaman } = useHalaman(lokets);
  const { kolom, baris } = kisiHalaman(lokets.length, rasio);

  // Pita panggilan + bunyi ding. Bunyi baru aktif setelah satu klik (peramban memblokir suara otomatis).
  const { saatIni: panggilan, riwayat, dipanggilPada } = usePanggilanLayar({ aktif: statusToken === 'valid' });
  const { kursorTersembunyi } = useLayarMenyala();
  const kelasLayar = `${styles.screen} ${kursorTersembunyi ? styles.kursorTersembunyi : ''}`;
  const bunyi = useBunyi();
  const { ding } = bunyi;
  const idPanggilan = panggilan?.id ?? null;
  useEffect(() => {
    if (idPanggilan) ding();
  }, [idPanggilan, ding]);
  const namaLayanan = useCallback(
    (id: string) => {
      const l = lokets.find(x => x.layanan_id === id);
      return l ? namaTampil(l) : undefined;
    },
    [lokets],
  );

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- Render states ---

  if (statusToken === 'memeriksa') {
    return (
      <main data-tema="dasbor" className={kelasLayar}>
        <div className={styles.center} role="status">
          <Loader2 size={40} className={styles.spinner} />
          Memverifikasi akses…
        </div>
      </main>
    );
  }

  if (statusToken === 'gangguan') {
    return (
      <main data-tema="dasbor" className={kelasLayar}>
        <div className={styles.center} role="status">
          <WifiOff size={40} />
          <p>Menghubungkan ulang…</p>
          <p className={styles.centerCatatan}>
            Akses layar belum dapat diverifikasi karena gangguan koneksi. Mencoba lagi otomatis.
          </p>
        </div>
      </main>
    );
  }

  if (statusToken === 'tidak_valid') {
    return (
      <main data-tema="dasbor" className={kelasLayar}>
        <div className={styles.center}>
          <WifiOff size={40} />
          <p>Token tidak valid atau sudah dicabut.</p>
          <p className={styles.centerCatatan}>
            Hubungi Admin untuk mendapatkan URL layar yang baru.
          </p>
        </div>
      </main>
    );
  }

  // Tidak ada layanan berjadwal hari ini: kanvas terang polos, tanpa teks, header, atau teks berjalan.
  if (siap && lokets.length === 0) {
    return <main data-tema="dasbor" className={`${styles.layarKosong} ${kursorTersembunyi ? styles.kursorTersembunyi : ''}`} data-testid="layar-kosong" aria-hidden="true" />;
  }

  return (
    <main data-tema="dasbor" className={kelasLayar}>
      {/* Pita panggilan: di atas semua halaman, tidak menggeser tata letak */}
      <PitaPanggilan panggilan={panggilan} namaLayanan={namaLayanan} />

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <Monitor size={32} className={styles.brandIcon} aria-hidden="true" />
          <div>
            <h1 className={styles.title}>Status Antrean Layanan</h1>
            <p className={styles.subtitle}>{APP_NAME} · diperbarui otomatis</p>
          </div>
        </div>
        {clock && (
          <div className={styles.clock} suppressHydrationWarning>
            {formatWaktu(clock)}.{String(clock.getUTCSeconds()).padStart(2, '0')} WIB
            <span className={styles.clockDate}>
              {formatTanggal(clock, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
      </header>

      {/* Gangguan setelah data pernah tampil: data terakhir tetap ditampilkan */}
      <div role="status" aria-live="polite">
        {siap && reconnecting && (
          <div className={styles.reconnectBar}>
            <WifiOff size={24} aria-hidden="true" />
            Menghubungkan ulang… menampilkan data terakhir
          </div>
        )}
      </div>

      {/* Teks berjalan: 1 sampai 3 pengumuman bergantian (DSP-05) */}
      <TeksBerjalan pengumuman={daftarPengumuman} />

      {/* Body */}
      {!siap && !reconnecting && (
        <div className={styles.center} role="status">
          <Loader2 size={32} className={styles.spinner} />
          Memuat status antrean…
        </div>
      )}

      {!siap && reconnecting && (
        <div className={styles.center} role="status">
          <WifiOff size={32} />
          Menghubungkan ulang…
        </div>
      )}

      {siap && lokets.length > 0 && (
        <div
          ref={refKisi}
          className={styles.grid}
          data-testid="kisi-layanan"
          data-halaman={halamanKe + 1}
          style={kisiStyle(kolom, baris)}
        >
          {kartu.map((loket, i) => {
            const kosong = loket.antre_count === 0 && loket.dilayani_count === 0;
            const letak = posisiKartu(i, kartu.length, kolom, baris);
            return (
              <section
                key={loket.layanan_id}
                className={`${styles.loket} ${kosong ? styles.loketKosong : ''} ${clock && clock.getTime() - (dipanggilPada[loket.layanan_id] ?? 0) < 30_000 ? styles.loketDipanggil : ''}`}
                data-dipanggil={clock && clock.getTime() - (dipanggilPada[loket.layanan_id] ?? 0) < 30_000 ? 'true' : undefined}
                style={{
                  gridColumn: `${letak.kolomMulai} / span 2`,
                  gridRow: `${letak.barisMulai} / span 2`,
                }}
                aria-label={namaTampil(loket)}
              >
                <div className={styles.loketIsi}>
                  <h2 className={styles.loketName}>{namaTampil(loket)}</h2>

                  {/* Nomor yang sedang dilayani */}
                  <div className={styles.nomorBlok}>
                    <span className={styles.nomorLabel}>Dilayani</span>
                    <span className={`${styles.nomorValue} ${loket.nomor_display_dilayani ? '' : styles.nomorKosong}`}>
                      {loket.nomor_display_dilayani ?? '—'}
                    </span>
                  </div>

                  {/* Jumlah antre */}
                  <div className={styles.antreBlok}>
                    <span className={styles.antreLabel}>Antre</span>
                    <span className={`${styles.antreValue} ${loket.antre_count === 0 ? styles.antreNol : ''}`}>
                      {loket.antre_count}
                    </span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {siap && <PanggilanTerakhir riwayat={riwayat} namaLayanan={namaLayanan} />}

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.updatedIndicator}>
          <div className={`${styles.updatedDot} ${reconnecting ? styles.updatedDotGangguan : ''}`} />
          <span suppressHydrationWarning>
            {updatedAt
              ? `${reconnecting ? 'Data terakhir' : 'Diperbarui'} ${formatWaktu(updatedAt)}`
              : 'Menghubungkan…'}
          </span>
          {siap && !jadwalDiketahui && <span className={styles.tandaJadwal}>Jadwal belum terbaca</span>}
          {jumlahHalaman > 1 && (
            <span className={styles.tandaHalaman}>Halaman {halamanKe + 1} dari {jumlahHalaman}</span>
          )}
        </div>
        <div className={styles.footerKanan}>
          {bunyi.tersedia && !bunyi.aktif && (
            <button type="button" className={styles.tombolSuara} onClick={bunyi.aktifkan}>
              Aktifkan suara
            </button>
          )}
          <span>Silakan menuju layanan sesuai keperluan Anda</span>
        </div>
      </footer>
    </main>
  );
}
