'use client';

// Panel rincian satu pengaduan (Admin/FO): isi lengkap, penangan (Tangani, Ambil alih), linimasa berurut waktu, dan SATU formulir aksi.
// Petugas layanan hanya membaca isi (tanpa linimasa dan tanpa aksi). Linimasa datang dari RPC linimasa_pengaduan lewat
// GET /api/admin/pengaduan/[id]/linimasa; bila migrasi 202611030013 belum diterapkan, panel menampilkan pesan jelas.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlarmClock, ExternalLink, History, UserCheck, UserCog } from 'lucide-react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Field from '@/components/ui/Field';
import Galat from '@/components/ui/Galat';
import Lencana from '@/components/ui/Lencana';
import PanelSamping from '@/components/ui/PanelSamping';
import Skeleton from '@/components/ui/Skeleton';
import StatusKosong from '@/components/ui/StatusKosong';
import Tombol from '@/components/ui/Tombol';
import { formatTanggal, formatTanggalWaktu } from '@/lib/utils';
import { tampilWaktuLaporan } from '@/lib/waktu-anonim';
import {
  STATUS_LABEL, STATUS_PENJELASAN, namaPelapor, statusTertutup, teksSisaHariKerja,
  type EntriLinimasa, type PengaduanKerja,
} from '@/lib/pengaduan/tampilan';
import TanggapanPengaduan from './TanggapanPengaduan';
import styles from './PanelPengaduan.module.css';

interface Props {
  row: PengaduanKerja;
  /** 'tinjau' = Admin/FO (boleh bertindak); 'baca' = petugas layanan. */
  mode: 'tinjau' | 'baca';
  /** Id petugas yang sedang masuk (untuk membedakan "Anda" dari penangan lain). */
  sayaId: string | null;
  /** Fitur kerja (penangan, SLA hari kerja, linimasa) aktif di basis data. */
  fiturKerja: boolean;
  onClose: () => void;
  /** Dipanggil setelah aksi berhasil agar daftar dan baris dimuat ulang. */
  onBerubah: () => void;
  onToast: (pesan: string, jenis: 'success' | 'error' | 'warning') => void;
}

type Muat = { tahap: 'memuat' } | { tahap: 'siap'; entri: EntriLinimasa[] } | { tahap: 'galat'; pesan: string } | { tahap: 'belum' };

function teksAksiPenangan(e: Extract<EntriLinimasa, { jenis: 'penangan' }>): string {
  const oleh = e.oleh_nama?.trim() || 'Seseorang';
  if (e.aksi === 'ambil_alih') {
    const dari = e.dari_nama?.trim();
    return `${oleh} mengambil alih${dari ? ` dari ${dari}` : ''}${e.alasan ? `. Alasan: ${e.alasan}` : ''}`;
  }
  if (e.aksi === 'otomatis') return `${e.ke_nama?.trim() || oleh} menjadi penangan karena mengubah status`;
  return `${e.ke_nama?.trim() || oleh} menangani pengaduan ini`;
}

export default function PanelPengaduan({ row, mode, sayaId, fiturKerja, onClose, onBerubah, onToast }: Props) {
  const [linimasa, setLinimasa] = useState<Muat>({ tahap: 'memuat' });
  const [sibuk, setSibuk] = useState(false);
  const [bukaAmbilAlih, setBukaAmbilAlih] = useState(false);
  const [alasan, setAlasan] = useState('');
  const [galatAmbilAlih, setGalatAmbilAlih] = useState('');
  const tinjau = mode === 'tinjau';
  const tutup = statusTertutup(row.status);

  const muatLinimasa = useCallback(async () => {
    if (!tinjau) return;
    setLinimasa({ tahap: 'memuat' });
    try {
      const res = await fetch(`/api/admin/pengaduan/${row.id}/linimasa`);
      const json = (await res.json().catch(() => ({}))) as { entri?: EntriLinimasa[]; error?: string; kode?: string };
      if (res.status === 409 && json.kode === 'MIGRASI_BELUM_DITERAPKAN') { setLinimasa({ tahap: 'belum' }); return; }
      if (!res.ok) { setLinimasa({ tahap: 'galat', pesan: json.error ?? 'Riwayat tidak dapat dimuat.' }); return; }
      setLinimasa({ tahap: 'siap', entri: json.entri ?? [] });
    } catch {
      setLinimasa({ tahap: 'galat', pesan: 'Gangguan jaringan. Riwayat tidak dapat dimuat.' });
    }
  }, [row.id, tinjau]);

  useEffect(() => {
    void Promise.resolve().then(muatLinimasa);
  }, [muatLinimasa, row.status, row.penangan_id]);

  // Buka berkas lewat endpoint berotorisasi (URL singkat bertanda tangan). Tab dibuka lebih dulu secara sinkron
  // supaya tidak diblokir peramban, lalu diarahkan ke URL; tanpa opener agar halaman admin tidak bisa dikendalikan.
  const [membuka, setMembuka] = useState<string | null>(null);
  const bukaBerkas = async (kunci: string, lampiranId?: string) => {
    if (membuka) return;
    setMembuka(kunci);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const qs = lampiranId ? `?lampiran_id=${encodeURIComponent(lampiranId)}` : '';
      const res = await fetch(`/api/admin/pengaduan/${row.id}/lampiran${qs}`);
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        tab?.close();
        onToast(json.error ?? 'Berkas tidak dapat dibuka.', 'error');
        return;
      }
      if (tab) tab.location.href = json.url;
      else window.open(json.url, '_blank', 'noopener,noreferrer');
    } catch {
      tab?.close();
      onToast('Gangguan jaringan. Berkas tidak dapat dibuka.', 'error');
    } finally {
      setMembuka(null);
    }
  };

  const aksiPenangan = async (jalur: 'tangani' | 'ambil-alih', body?: unknown) => {
    setSibuk(true);
    try {
      const res = await fetch(`/api/admin/pengaduan/${row.id}/${jalur}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; kode?: string; penangan_nama?: string | null };
      if (!res.ok) {
        const pesan = json.kode === 'PENANGAN_SUDAH_ADA'
          ? `Pengaduan ini sudah ditangani ${json.penangan_nama ?? 'orang lain'}. Muat ulang, lalu ambil alih bila perlu.`
          : (json.error ?? 'Aksi gagal');
        onToast(pesan, 'error');
        if (res.status === 409) onBerubah();
        return;
      }
      onToast(jalur === 'tangani' ? 'Anda sekarang menangani pengaduan ini' : 'Penangan sudah dialihkan ke Anda', 'success');
      setBukaAmbilAlih(false);
      setAlasan('');
      onBerubah();
    } catch {
      onToast('Gangguan jaringan. Coba lagi.', 'error');
    } finally {
      setSibuk(false);
    }
  };

  const kirimAmbilAlih = (e: React.FormEvent) => {
    e.preventDefault();
    const bersih = alasan.trim();
    if (bersih.length < 5) { setGalatAmbilAlih('Tulis alasan singkat, minimal 5 karakter.'); return; }
    setGalatAmbilAlih('');
    void aksiPenangan('ambil-alih', { alasan: bersih });
  };

  const sisa = teksSisaHariKerja(row.sisa_hari_kerja, row.sla_status);
  const sayaPenangan = !!sayaId && row.penangan_id === sayaId;

  return (
    <PanelSamping
      terbuka
      onTutup={onClose}
      dikunci={sibuk}
      lebar="lebar"
      judul={<>Pengaduan <span className={styles.nomor}>{row.nomor_tiket}</span></>}
      deskripsi={<><strong>{STATUS_LABEL[row.status] ?? row.status}.</strong> {STATUS_PENJELASAN[row.status] ?? ''}</>}
    >
      <div className={styles.badan}>
          <dl className={styles.meta}>
            <div><dt>Layanan</dt><dd>{row.layanan_nama ?? (row.layanan_id ? 'Layanan tidak terbaca' : 'Tidak terkait layanan')}</dd></div>
            <div><dt>Pelapor</dt><dd>{namaPelapor(row)}</dd></div>
            <div><dt>Masuk</dt><dd>{tampilWaktuLaporan(row.created_at, row.anonim)}</dd></div>
            <div>
              <dt>Batas</dt>
              <dd>
                {tutup || !row.batas_aktif ? '-' : formatTanggal(row.batas_aktif)}
                {sisa && (
                  <span className={styles.slaBaris}>
                    {row.sla_status === 'terlambat' ? <Lencana nada="bahaya" ikon={AlarmClock}>{sisa}</Lencana>
                      : row.sla_status === 'mendekati' ? <Lencana nada="peringatan" ikon={AlarmClock}>{sisa}</Lencana>
                        : <Lencana nada="sukses">{sisa}</Lencana>}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <section aria-label="Isi pengaduan">
            <h3 className={styles.sub}>Isi pengaduan</h3>
            <p className={styles.isi}>{row.isi}</p>
          </section>

          {tinjau && row.ada_bukti === true && (
            <section aria-label="Bukti dari pelapor">
              <h3 className={styles.sub}>Bukti dari pelapor</h3>
              <Tombol ukuran="kecil" varian="sekunder" ikon={ExternalLink} memuat={membuka === 'bukti'} disabled={membuka !== null} onClick={() => void bukaBerkas('bukti')}>
                Buka bukti dari pelapor
              </Tombol>
            </section>
          )}

          {tinjau && fiturKerja && (
            <section aria-label="Penangan" className={styles.penangan}>
              <h3 className={styles.sub}>Penangan</h3>
              {row.penangan_id ? (
                <p className={styles.barisPenangan}>
                  <UserCheck size={16} aria-hidden="true" />
                  <span>{sayaPenangan ? 'Anda yang menangani' : `Ditangani ${row.penangan_nama ?? 'petugas lain'}`}{row.penangan_sejak ? ` sejak ${formatTanggal(row.penangan_sejak)}` : ''}</span>
                  {!sayaPenangan && !tutup && !bukaAmbilAlih && (
                    <Tombol ukuran="kecil" varian="sekunder" ikon={UserCog} onClick={() => setBukaAmbilAlih(true)} disabled={sibuk}>
                      Ambil alih
                    </Tombol>
                  )}
                </p>
              ) : (
                <p className={styles.barisPenangan}>
                  <span>Belum ada penangan.</span>
                  {!tutup && (
                    <Tombol ukuran="kecil" memuat={sibuk} onClick={() => void aksiPenangan('tangani')}>
                      Tangani
                    </Tombol>
                  )}
                </p>
              )}
              {bukaAmbilAlih && (
                <form onSubmit={kirimAmbilAlih} className={styles.formAlih} noValidate>
                  <Field
                    label="Alasan mengambil alih"
                    bantuan="Alasan dicatat di riwayat dan terlihat oleh Admin dan Front Office."
                    galat={galatAmbilAlih || undefined}
                  >
                    <textarea
                      className="input"
                      rows={2}
                      maxLength={500}
                      value={alasan}
                      onChange={(e) => setAlasan(e.target.value)}
                      disabled={sibuk}
                    />
                  </Field>
                  <div className={styles.aksiBaris}>
                    <Tombol type="submit" ukuran="kecil" memuat={sibuk}>Ambil alih</Tombol>
                    <Tombol ukuran="kecil" varian="hantu" onClick={() => { setBukaAmbilAlih(false); setAlasan(''); setGalatAmbilAlih(''); }} disabled={sibuk}>Batal</Tombol>
                  </div>
                </form>
              )}
            </section>
          )}

          {tinjau && (
            <section aria-label="Riwayat">
              <h3 className={styles.sub}>Riwayat</h3>
              {linimasa.tahap === 'memuat' && <div role="status"><Skeleton bentuk="baris" jumlah={3} label="Memuat riwayat…" /></div>}
              {linimasa.tahap === 'belum' && (
                <CatatanKeadaan jenis="menunggu-migrasi">Riwayat lengkap belum aktif karena pembaruan basis data belum diterapkan.</CatatanKeadaan>
              )}
              {linimasa.tahap === 'galat' && <Galat pesan={linimasa.pesan} onRetry={() => void muatLinimasa()} />}
              {linimasa.tahap === 'siap' && linimasa.entri.length === 0 && <StatusKosong ikon={History} judul="Belum ada riwayat." />}
              {linimasa.tahap === 'siap' && linimasa.entri.length > 0 && (
                <ol className={styles.linimasa}>
                  {linimasa.entri.map((e, i) => (
                    <li key={`${e.jenis}-${e.waktu}-${i}`} className={styles.entri}>
                      <time dateTime={e.waktu} className={styles.waktu}>{formatTanggalWaktu(e.waktu)} WIB</time>
                      {e.jenis === 'tanggapan' && (
                        <div>
                          <p className={styles.entriJudul}>
                            Tanggapan{e.oleh_nama ? ` dari ${e.oleh_nama}` : ''}{e.status_baru ? `, status menjadi ${STATUS_LABEL[e.status_baru] ?? e.status_baru}` : ''}
                          </p>
                          <p className={styles.isi}>{e.isi}</p>
                          {e.lampiran && e.lampiran.length > 0 && (
                            <p className={styles.redup}>
                              Lampiran:{' '}
                              {e.lampiran.map((l, n) => (
                                <Fragment key={l.id ?? `${l.nama}-${n}`}>
                                  {n > 0 && ', '}
                                  {l.id ? (
                                    <button
                                      type="button"
                                      className={styles.tautanLampiran}
                                      aria-label={`Buka lampiran ${l.nama}`}
                                      disabled={membuka !== null}
                                      onClick={() => void bukaBerkas(l.id as string, l.id)}
                                    >
                                      {l.nama}
                                    </button>
                                  ) : l.nama}
                                </Fragment>
                              ))}
                            </p>
                          )}
                        </div>
                      )}
                      {e.jenis === 'status' && (
                        <p className={styles.entriJudul}>
                          Status {e.status_lama ? `dari ${STATUS_LABEL[e.status_lama] ?? e.status_lama} ` : ''}menjadi {STATUS_LABEL[e.status_baru ?? ''] ?? e.status_baru}
                          {e.oleh_nama ? ` oleh ${e.oleh_nama}` : ''}{e.catatan ? `. ${e.catatan}` : ''}
                        </p>
                      )}
                      {e.jenis === 'penangan' && <p className={styles.entriJudul}>{teksAksiPenangan(e)}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {tinjau && (
            <TanggapanPengaduan
              key={`${row.id}-${row.status}`}
              pengaduanId={row.id}
              bisaEmail={row.bisa_dihubungi === true && !row.anonim}
              statusSaatIni={row.status}
              onTersimpan={(peringatan) => {
                if (peringatan) onToast(peringatan, 'warning');
                else onToast('Tersimpan', 'success');
                // Tanggapan berstatus Tetap tidak mengubah status/penangan, jadi efek linimasa tidak terpicu sendiri.
                void muatLinimasa();
                onBerubah();
              }}
              onGalat={(pesan) => onToast(pesan, 'error')}
            />
          )}
      </div>
    </PanelSamping>
  );
}
