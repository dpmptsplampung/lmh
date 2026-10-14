'use client';

// Penanganan Saya (Front Office; Tahap B, kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §6.2, §2.4, §2.5).
// Menampilkan tahap FO yang sedang saya pegang (status `berjalan`) beserta riwayat hari ini (WIB).
// Penutupan tahap hanya lewat RPC: "Selesaikan" (fo_selesai: topik + catatan wajib) atau "Eskalasi" (fo_eskalasi:
// layanan tujuan, topik, catatan wajib; tiket baru terbit di sini, mis. OS-014). Hasil eskalasi (nomor tiket, peringatan
// bila belum ada petugas layanan yang hadir) tetap tampil sampai ditutup agar nomor dapat disampaikan ke pengunjung.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, RotateCcw, UserRound, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import FoEskalasiDialog from '@/components/admin/FoEskalasiDialog';
import FoSelesaiForm from '@/components/admin/FoSelesaiForm';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  awalHariWIBIso,
  formatJamWIB,
  galatPerluMuatUlang,
  galatSesiTidakSah,
  labelSaluran,
  pesanGalatFo,
  satu,
  type HasilEskalasi,
  type LayananTujuan,
  type TopikFo,
} from '@/lib/fo-penanganan';
import styles from '../fo-halaman.module.css';

interface KunjunganEmbed {
  nama: string;
  asal_instansi: string | null;
  keperluan: string | null;
  layanan_saran_id: string | null;
}

interface PenangananBerjalan {
  id: string;
  kunjungan_id: string;
  tahap_ke: number;
  peran_tahap: string;
  layanan_id: string | null;
  saluran: string;
  tiket_id: string | null;
  status: string;
  mulai_at: string | null;
  kunjungan: KunjunganEmbed | KunjunganEmbed[] | null;
}

interface PenangananRiwayat {
  id: string;
  kunjungan_id: string;
  tahap_ke: number;
  saluran: string;
  status: string;
  hasil: string | null;
  topik: string | null;
  catatan: string | null;
  mulai_at: string | null;
  selesai_at: string | null;
  kunjungan: { nama: string; asal_instansi: string | null } | { nama: string; asal_instansi: string | null }[] | null;
}

interface TiketHasilEskalasi {
  penanganan_asal_id: string;
  nomor_display: string;
  layanan_id: string;
}

type Hasil =
  | { jenis: 'selesai'; nama: string }
  | { jenis: 'eskalasi'; nama: string; hasil: HasilEskalasi };

export default function PenangananFoPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [berjalan, setBerjalan] = useState<PenangananBerjalan[]>([]);
  const [riwayat, setRiwayat] = useState<PenangananRiwayat[]>([]);
  const [tiketPerTahap, setTiketPerTahap] = useState<Record<string, TiketHasilEskalasi>>({});
  const [topik, setTopik] = useState<TopikFo[]>([]);
  const [layanan, setLayanan] = useState<LayananTujuan[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [formSelesaiId, setFormSelesaiId] = useState<string | null>(null);
  const [eskalasiUntuk, setEskalasiUntuk] = useState<PenangananBerjalan | null>(null);
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const hasilRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  // Referensi (topik FO, layanan tujuan) jarang berubah: dimuat sekali, bukan tiap refetch realtime.
  const referensiDimuat = useRef(false);
  const tombolSelesaiRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const fokusKeTombolSelesai = useRef<string | null>(null);

  const muat = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Belum masuk');
      const { data: saya, error: eSaya } = await supabase
        .from('petugas')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (eSaya) throw eSaya;
      if (!saya) throw new Error('Akun petugas tidak ditemukan');
      const petugasId = (saya as { id: string }).id;

      const [resBerjalan, resRiwayat] = await Promise.all([
        supabase
          .from('penanganan')
          .select(
            'id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, mulai_at, kunjungan:kunjungan_id(nama, asal_instansi, keperluan, layanan_saran_id)',
          )
          .eq('penangan_id', petugasId)
          .eq('peran_tahap', 'fo')
          .eq('status', 'berjalan')
          .order('mulai_at', { ascending: true }),
        supabase
          .from('penanganan')
          .select(
            'id, kunjungan_id, tahap_ke, saluran, status, hasil, topik, catatan, mulai_at, selesai_at, kunjungan:kunjungan_id(nama, asal_instansi)',
          )
          .eq('penangan_id', petugasId)
          .eq('peran_tahap', 'fo')
          .in('status', ['selesai', 'batal'])
          .gte('mulai_at', awalHariWIBIso())
          .order('selesai_at', { ascending: false }),
      ]);
      if (resBerjalan.error) throw resBerjalan.error;
      if (resRiwayat.error) throw resRiwayat.error;
      const dataBerjalan = (resBerjalan.data ?? []) as unknown as PenangananBerjalan[];
      const dataRiwayat = (resRiwayat.data ?? []) as unknown as PenangananRiwayat[];

      // Nomor tiket hasil eskalasi untuk baris riwayat 'dieskalasi' (tiket.penanganan_asal_id = tahap FO itu).
      const petaTiket: Record<string, TiketHasilEskalasi> = {};
      const idDieskalasi = dataRiwayat.filter((r) => r.hasil === 'dieskalasi').map((r) => r.id);
      if (idDieskalasi.length > 0) {
        const { data: tiket } = await supabase
          .from('tiket_antrean')
          .select('penanganan_asal_id, nomor_display, layanan_id')
          .in('penanganan_asal_id', idDieskalasi);
        for (const t of (tiket ?? []) as unknown as TiketHasilEskalasi[]) petaTiket[t.penanganan_asal_id] = t;
      }

      let dataTopik: TopikFo[] | null = null;
      let dataLayanan: LayananTujuan[] | null = null;
      if (!referensiDimuat.current) {
        const [resTopik, resLayanan] = await Promise.all([
          supabase
            .from('topik_penanganan')
            .select('id, nama, urut')
            .eq('aktif', true)
            .is('layanan_id', null)
            .order('urut')
            .order('nama'),
          supabase
            .from('layanan')
            .select('id, nama, prefiks_antrean, status_tampilan')
            .eq('aktif', true)
            .eq('punya_antrean', true)
            .order('nama'),
        ]);
        if (resTopik.error) throw resTopik.error;
        if (resLayanan.error) throw resLayanan.error;
        dataTopik = (resTopik.data ?? []) as unknown as TopikFo[];
        dataLayanan = ((resLayanan.data ?? []) as unknown as (LayananTujuan & { status_tampilan?: string })[])
          .filter((l) => l.status_tampilan !== 'nonaktif')
          .map((l) => ({ id: l.id, nama: l.nama, prefiks_antrean: l.prefiks_antrean }));
      }

      if (seq !== seqRef.current) return; // respons lama tidak boleh menimpa yang lebih baru
      setBerjalan(dataBerjalan);
      setRiwayat(dataRiwayat);
      setTiketPerTahap(petaTiket);
      if (dataTopik && dataLayanan) {
        setTopik(dataTopik);
        setLayanan(dataLayanan);
        referensiDimuat.current = true;
      }
      setGalatMuat(null);
    } catch (e) {
      console.error('Gagal memuat penanganan FO:', e);
      if (seq === seqRef.current) setGalatMuat('Gagal memuat data penanganan. Periksa koneksi lalu coba lagi.');
    } finally {
      if (seq === seqRef.current) setMemuat(false);
    }
  }, []);

  useEffect(() => {
    // Muat awal (fetch ke sistem eksternal; setState terjadi setelah await, bukan sinkron).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat();
  }, [muat]);

  useRealtimeRefetch(muat, { table: 'penanganan', pollMs: 30_000 });

  // Hasil tindakan menerima fokus (pembaca layar/keyboard langsung sampai ke nomor tiket) setelah dialog menutup.
  useEffect(() => {
    if (hasil) hasilRef.current?.focus();
  }, [hasil]);

  // Form selesai ditutup lewat Batal: kembalikan fokus ke tombol yang membukanya.
  useEffect(() => {
    if (formSelesaiId === null && fokusKeTombolSelesai.current) {
      tombolSelesaiRef.current.get(fokusKeTombolSelesai.current)?.focus();
      fokusKeTombolSelesai.current = null;
    }
  }, [formSelesaiId]);

  // Galat RPC yang berarti sesi tidak sah -> login; tampilan basi -> muat ulang.
  const tanganiGalatSistem = useCallback((e: unknown) => {
    if (galatSesiTidakSah(e)) {
      toast(pesanGalatFo(e), 'error');
      router.replace(urlLoginAlasan('tidak_terdaftar'));
      return;
    }
    if (galatPerluMuatUlang(e)) void muat();
  }, [muat, router, toast]);

  const namaDari = (b: PenangananBerjalan) => satu(b.kunjungan)?.nama ?? 'pengunjung';

  const berhasilSelesai = (b: PenangananBerjalan) => {
    setFormSelesaiId(null);
    setHasil({ jenis: 'selesai', nama: namaDari(b) });
    void muat();
  };

  const berhasilEskalasi = (b: PenangananBerjalan, h: HasilEskalasi) => {
    setEskalasiUntuk(null);
    setHasil({ jenis: 'eskalasi', nama: namaDari(b), hasil: h });
    void muat();
  };

  const namaLayanan = (id: string | null) => layanan.find((l) => l.id === id)?.nama ?? null;

  const labelHasil = (r: PenangananRiwayat): string => {
    if (r.status === 'batal') return 'Dibatalkan';
    if (r.hasil === 'dieskalasi') {
      const t = tiketPerTahap[r.id];
      if (!t) return 'Dieskalasi';
      const tujuan = namaLayanan(t.layanan_id);
      return `Dieskalasi → ${t.nomor_display}${tujuan ? ` (${tujuan})` : ''}`;
    }
    if (r.hasil === 'selesai') return 'Selesai di FO';
    return r.hasil ?? 'Selesai';
  };

  return (
    <>
      <PageHeader
        title="Penanganan Saya"
        description="Pengunjung yang sedang Anda tangani sebagai Front Office dan riwayat hari ini."
      />
      <div className={styles.halaman}>
        {/* Pengumuman hasil tindakan; bertahan sampai ditutup agar nomor tiket tidak hilang seperti toast. */}
        <div role="status" aria-live="polite">
          {hasil && (
            <div ref={hasilRef} tabIndex={-1} className={styles.hasil}>
              {hasil.jenis === 'selesai' ? (
                <p className={styles.hasilJudul}>Penanganan {hasil.nama} selesai dicatat.</p>
              ) : (
                <>
                  <p className={styles.hasilJudul}>
                    {hasil.nama} dieskalasi ke {hasil.hasil.layanan_nama}. Berikan nomor antrean ini kepada pengunjung:
                  </p>
                  <span className={styles.nomorTiket} data-testid="nomor-tiket">{hasil.hasil.nomor_display}</span>
                </>
              )}
              <div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHasil(null)}>
                  <X size={14} aria-hidden="true" /> Tutup pemberitahuan
                </button>
              </div>
            </div>
          )}
        </div>
        {hasil?.jenis === 'eskalasi' && !hasil.hasil.petugas_hadir && (
          <p role="alert" className={styles.kembali}>
            <strong>Perhatian:</strong> belum ada petugas {hasil.hasil.layanan_nama} yang absen hadir hari ini. Pengunjung
            mungkin perlu menunggu lebih lama. Beri tahu pengunjung, atau hubungi petugas layanan tersebut.
          </p>
        )}

        {galatMuat && (
          <p role="alert" className={styles.galatMuat}>
            <span>{galatMuat}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setMemuat(true); void muat(); }}>
              <RotateCcw size={14} aria-hidden="true" /> Coba lagi
            </button>
          </p>
        )}

        <section className={styles.seksi} aria-labelledby="judul-berjalan">
          <h2 id="judul-berjalan" className={styles.judulSeksi}>
            <UserRound size={18} aria-hidden="true" /> Sedang ditangani
            <span className={styles.jumlah}>{berjalan.length}</span>
          </h2>
          {memuat ? (
            <p role="status" className={styles.kosong}>Memuat penanganan…</p>
          ) : berjalan.length === 0 && !galatMuat ? (
            <p className={styles.kosong}>
              Belum ada pengunjung yang sedang Anda tangani. Ambil dari <Link href="/admin/fo/kotak-masuk">Kotak Masuk</Link>{' '}
              atau pindai QR reservasi di <Link href="/admin/scan">Scan QR</Link>.
            </p>
          ) : (
            <ul className={styles.daftar}>
              {berjalan.map((b) => {
                const k = satu(b.kunjungan);
                const nama = k?.nama ?? 'Pengunjung';
                const formTerbuka = formSelesaiId === b.id;
                return (
                  <li key={b.id} className={styles.kartu}>
                    <div className={styles.kartuBaris}>
                      <div>
                        <h3 className={styles.nama}>{nama}</h3>
                        <p className={styles.meta}>{k?.asal_instansi ?? 'Instansi tidak tercatat'}</p>
                      </div>
                      <div>
                        <span className={styles.lencana}>{labelSaluran(b.saluran)}</span>
                        <p className={styles.meta}>Mulai {formatJamWIB(b.mulai_at)} WIB</p>
                      </div>
                    </div>
                    {k?.keperluan && <p className={styles.keperluan}>Keperluan: {k.keperluan}</p>}
                    {b.saluran === 'chat' ? (
                      <p className={styles.meta}>Penanganan lewat chat diselesaikan dari halaman Live Chat.</p>
                    ) : formTerbuka ? (
                      <FoSelesaiForm
                        penangananId={b.id}
                        namaPengunjung={nama}
                        topik={topik}
                        onBerhasil={() => berhasilSelesai(b)}
                        onBatal={() => { fokusKeTombolSelesai.current = b.id; setFormSelesaiId(null); }}
                        onGalatSistem={tanganiGalatSistem}
                      />
                    ) : (
                      <div className={styles.aksiKartu}>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) tombolSelesaiRef.current.set(b.id, el);
                            else tombolSelesaiRef.current.delete(b.id);
                          }}
                          className="btn btn--primary btn--sm"
                          onClick={() => setFormSelesaiId(b.id)}
                          aria-label={`Selesaikan penanganan ${nama}`}
                        >
                          <CheckCircle2 size={14} aria-hidden="true" /> Selesaikan
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setEskalasiUntuk(b)}
                          aria-label={`Eskalasi ${nama} ke layanan`}
                        >
                          <ArrowRight size={14} aria-hidden="true" /> Eskalasi ke layanan
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.seksi} aria-labelledby="judul-riwayat">
          <h2 id="judul-riwayat" className={styles.judulSeksi}>
            Riwayat hari ini
            <span className={styles.jumlah}>{riwayat.length}</span>
          </h2>
          {riwayat.length === 0 ? (
            <p className={styles.kosong}>Belum ada penanganan yang selesai hari ini.</p>
          ) : (
            <div className={styles.tabelWadah}>
              <table className={styles.tabel}>
                <caption>Riwayat penanganan Front Office hari ini</caption>
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Pengunjung</th>
                    <th scope="col">Hasil</th>
                    <th scope="col">Topik</th>
                    <th scope="col">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((r) => {
                    const k = satu(r.kunjungan);
                    return (
                      <tr key={r.id}>
                        <td>{formatJamWIB(r.mulai_at)}–{formatJamWIB(r.selesai_at)}</td>
                        <td>
                          {k?.nama ?? '-'}
                          <br />
                          <span className={styles.meta}>{labelSaluran(r.saluran)}</span>
                        </td>
                        <td>{labelHasil(r)}</td>
                        <td>{r.topik ?? '-'}</td>
                        <td>{r.catatan ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {eskalasiUntuk && (
        <FoEskalasiDialog
          key={eskalasiUntuk.id}
          penangananId={eskalasiUntuk.id}
          namaPengunjung={namaDari(eskalasiUntuk)}
          layananSaranId={satu(eskalasiUntuk.kunjungan)?.layanan_saran_id ?? null}
          layanan={layanan}
          topik={topik}
          onClose={() => setEskalasiUntuk(null)}
          onBerhasil={(h) => berhasilEskalasi(eskalasiUntuk, h)}
          onGalatSistem={tanganiGalatSistem}
        />
      )}
    </>
  );
}
