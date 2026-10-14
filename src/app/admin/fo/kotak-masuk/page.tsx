'use client';

// Kotak Masuk Front Office (Tahap B, kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §6.1, §2.6).
// Daftar penanganan tahap FO berstatus `menunggu`: pengunjung yang DIKEMBALIKAN petugas layanan ke FO dan chat
// ber-eskalasi yang belum diambil (Tahap C). Item berkanal chat TIDAK memakai fo_ambil_dari_kotak_masuk (DB menolak
// dengan SALURAN_CHAT): diambil lewat chat_ambil di halaman Live Chat (/admin/chat?sesi=...), maka hanya ditautkan. FO mana pun boleh mengambil; pengambilan atomik di DB (fo_ambil_dari_kotak_masuk):
// yang kalah balapan menerima SUDAH_DIAMBIL -> pesan ramah + daftar dimuat ulang. Berhasil -> lanjut ke Penanganan Saya.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox, Loader2, MessageSquare, RotateCcw, UserCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefetch } from '@/lib/hooks/useRealtimeRefetch';
import { urlLoginAlasan } from '@/lib/sesi-staf';
import {
  foAmbilDariKotakMasuk,
  galatPerluMuatUlang,
  galatSesiTidakSah,
  kodeGalatFo,
  labelSaluran,
  formatJamWIB,
  formatLama,
  pesanGalatFo,
  satu,
} from '@/lib/fo-penanganan';
import styles from '../fo-halaman.module.css';

interface KunjunganRingkas {
  nama: string;
  kontak_hp: string | null;
  asal_instansi: string | null;
  keperluan: string | null;
  asal: string;
  tanggal: string;
}

interface BarisKotakMasuk {
  id: string;
  kunjungan_id: string;
  tahap_ke: number;
  saluran: string;
  chat_sesi_id: string | null;
  created_at: string;
  dibuat_oleh: string | null;
  kunjungan: KunjunganRingkas | KunjunganRingkas[] | null;
}

interface TahapSebelumnya {
  kunjungan_id: string;
  tahap_ke: number;
  catatan: string | null;
  layanan_id: string | null;
  penangan_id: string | null;
  selesai_at: string | null;
}

/** Alasan pengembalian dari tahap sebelumnya, sudah dengan nama layanan/petugas bila terbaca. */
interface Pengembalian {
  catatan: string | null;
  layananNama: string | null;
  petugasNama: string | null;
  /** Front Office yang melayani sebelum dieskalasi (tahap 'fo' terakhir sebelum item ini). */
  foNama: string | null;
}

interface TahapFoSebelumnya {
  kunjungan_id: string;
  tahap_ke: number;
  penangan_id: string | null;
}

export default function KotakMasukFoPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [baris, setBaris] = useState<BarisKotakMasuk[]>([]);
  const [pengembalian, setPengembalian] = useState<Record<string, Pengembalian>>({});
  const [memuat, setMemuat] = useState(true);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [diproses, setDiproses] = useState<ReadonlySet<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');
  // Penjaga klik ganda sebelum render ulang; `diproses` (state) hanya untuk tampilan tombol.
  const prosesRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);

  const muat = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('penanganan')
        .select(
          'id, kunjungan_id, tahap_ke, saluran, chat_sesi_id, created_at, dibuat_oleh, kunjungan:kunjungan_id(nama, kontak_hp, asal_instansi, keperluan, asal, tanggal)',
        )
        .eq('peran_tahap', 'fo')
        .eq('status', 'menunggu')
        .order('created_at', { ascending: true });
      if (error) throw error;
      const daftar = (data ?? []) as unknown as BarisKotakMasuk[];

      // Alasan pengembalian = tahap sebelumnya (tahap_ke - 1, hasil 'dikembalikan', kolom catatan) milik kunjungan yang sama.
      const alasan: Record<string, Pengembalian> = {};
      const lanjutan = daftar.filter((b) => b.tahap_ke > 1);
      if (lanjutan.length > 0) {
        const idKunjungan = lanjutan.map((b) => b.kunjungan_id);
        // Tahap FO sebelumnya (siapa FO yang melayani sebelum eskalasi): semua FO membaca semua tahap (keputusan CEO
        // 2026-10-14, RLS 202610140013). Pelengkap: kegagalannya tidak menggagalkan kotak masuk.
        const [{ data: tahap }, resFo] = await Promise.all([
          supabase
            .from('penanganan')
            .select('kunjungan_id, tahap_ke, catatan, layanan_id, penangan_id, selesai_at')
            .in('kunjungan_id', idKunjungan)
            .eq('hasil', 'dikembalikan'),
          supabase
            .from('penanganan')
            .select('kunjungan_id, tahap_ke, penangan_id')
            .in('kunjungan_id', idKunjungan)
            .eq('peran_tahap', 'fo')
            .not('penangan_id', 'is', null),
        ]);
        const sebelumnya = (tahap ?? []) as unknown as TahapSebelumnya[];
        const tahapFo = ((resFo.error ? [] : resFo.data) ?? []) as unknown as TahapFoSebelumnya[];

        // Nama layanan/petugas pelengkap: kegagalan membacanya tidak boleh menggagalkan kotak masuk.
        const idLayanan = [...new Set(sebelumnya.map((t) => t.layanan_id).filter((x): x is string => !!x))];
        const idPetugas = [...new Set(
          [...sebelumnya.map((t) => t.penangan_id), ...tahapFo.map((t) => t.penangan_id)].filter((x): x is string => !!x),
        )];
        const [resLayanan, resPetugas] = await Promise.all([
          idLayanan.length ? supabase.from('layanan').select('id, nama').in('id', idLayanan) : Promise.resolve({ data: [] }),
          idPetugas.length ? supabase.from('petugas').select('id, nama').in('id', idPetugas) : Promise.resolve({ data: [] }),
        ]);
        const namaLayanan = new Map(((resLayanan.data ?? []) as { id: string; nama: string }[]).map((l) => [l.id, l.nama]));
        const namaPetugas = new Map(((resPetugas.data ?? []) as { id: string; nama: string }[]).map((p) => [p.id, p.nama]));

        for (const b of lanjutan) {
          const t = sebelumnya.find((x) => x.kunjungan_id === b.kunjungan_id && x.tahap_ke === b.tahap_ke - 1);
          if (!t) continue;
          const fo = tahapFo
            .filter((x) => x.kunjungan_id === b.kunjungan_id && x.tahap_ke < b.tahap_ke && !!x.penangan_id)
            .sort((x, y) => y.tahap_ke - x.tahap_ke)[0];
          alasan[b.id] = {
            catatan: t.catatan,
            layananNama: t.layanan_id ? (namaLayanan.get(t.layanan_id) ?? null) : null,
            petugasNama: t.penangan_id ? (namaPetugas.get(t.penangan_id) ?? null) : null,
            foNama: fo?.penangan_id ? (namaPetugas.get(fo.penangan_id) ?? null) : null,
          };
        }
      }

      if (seq !== seqRef.current) return; // respons lama tidak boleh menimpa yang lebih baru
      setBaris(daftar);
      setPengembalian(alasan);
      setGalatMuat(null);
    } catch (e) {
      console.error('Gagal memuat kotak masuk FO:', e);
      if (seq === seqRef.current) setGalatMuat('Gagal memuat kotak masuk. Periksa koneksi lalu coba lagi.');
    } finally {
      if (seq === seqRef.current) setMemuat(false);
    }
  }, []);

  useEffect(() => {
    // Muat awal (fetch ke sistem eksternal; setState terjadi setelah await, bukan sinkron).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void muat();
  }, [muat]);

  // Realtime (postgres_changes menghormati RLS) + polling cadangan; kotak masuk segar tanpa muat ulang manual.
  useRealtimeRefetch(muat, { table: 'penanganan', pollMs: 30_000 });

  const ambil = async (b: BarisKotakMasuk) => {
    if (prosesRef.current.has(b.id)) return;
    const k = satu(b.kunjungan);
    const nama = k?.nama ?? 'pengunjung';
    prosesRef.current.add(b.id);
    setDiproses(new Set(prosesRef.current));
    setPengumuman(`Mengambil ${nama}…`);
    try {
      await foAmbilDariKotakMasuk(createClient(), b.id);
      toast(`${nama} diambil. Silakan lanjutkan penanganan.`, 'success');
      router.push('/admin/fo/penanganan');
    } catch (e) {
      console.error('Gagal mengambil dari kotak masuk:', e);
      if (galatSesiTidakSah(e)) {
        toast(pesanGalatFo(e), 'error');
        router.replace(urlLoginAlasan('tidak_terdaftar'));
      } else {
        // SUDAH_DIAMBIL = kalah balapan: bukan kesalahan pengguna, pesan ramah + tampilan disegarkan.
        toast(pesanGalatFo(e, 'Gagal mengambil pengunjung.'), kodeGalatFo(e) === 'SUDAH_DIAMBIL' ? 'info' : 'error');
        if (galatPerluMuatUlang(e)) await muat();
      }
    } finally {
      prosesRef.current.delete(b.id);
      setDiproses(new Set(prosesRef.current));
      setPengumuman('');
    }
  };

  return (
    <>
      <PageHeader
        title="Kotak Masuk Front Office"
        description="Pengunjung yang menunggu ditangani Front Office, termasuk yang dikembalikan petugas layanan."
      />
      <div className={styles.halaman}>
        {/* Pengumuman status untuk pembaca layar (aria-live), tidak tampil di layar. */}
        <div role="status" aria-live="polite" className={styles.srOnly}>
          {pengumuman}
        </div>

        {galatMuat && (
          <p role="alert" className={styles.galatMuat}>
            <span>{galatMuat}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setMemuat(true); void muat(); }}>
              <RotateCcw size={14} aria-hidden="true" /> Coba lagi
            </button>
          </p>
        )}

        <section className={styles.seksi} aria-labelledby="judul-kotak-masuk">
          <h2 id="judul-kotak-masuk" className={styles.judulSeksi}>
            <Inbox size={18} aria-hidden="true" /> Menunggu diambil
            <span className={styles.jumlah}>{baris.length}</span>
          </h2>

          {memuat ? (
            <p role="status" className={styles.kosong}>Memuat kotak masuk…</p>
          ) : baris.length === 0 && !galatMuat ? (
            <p className={styles.kosong}>Kotak masuk kosong. Tidak ada pengunjung yang menunggu Front Office.</p>
          ) : (
            <ul className={styles.daftar}>
              {baris.map((b) => {
                const k = satu(b.kunjungan);
                const alasan = pengembalian[b.id];
                const sibuk = diproses.has(b.id);
                return (
                  <li key={b.id} className={styles.kartu}>
                    <div className={styles.kartuBaris}>
                      <div>
                        <h3 className={styles.nama}>{k?.nama ?? 'Pengunjung'}</h3>
                        <p className={styles.meta}>
                          {[k?.asal_instansi, k?.kontak_hp].filter(Boolean).join(' · ') || 'Data kontak tidak tersedia'}
                        </p>
                      </div>
                      <div>
                        <span className={styles.lencana}>{labelSaluran(b.saluran)}</span>
                        <p className={styles.meta}>
                          Menunggu {formatLama(b.created_at)} (sejak {formatJamWIB(b.created_at)} WIB)
                        </p>
                      </div>
                    </div>
                    {k?.keperluan && <p className={styles.keperluan}>Keperluan: {k.keperluan}</p>}
                    {b.tahap_ke > 1 && (
                      <p className={styles.kembali}>
                        <strong>Dikembalikan</strong>
                        {alasan?.layananNama ? ` dari ${alasan.layananNama}` : ' oleh petugas layanan'}
                        {alasan?.petugasNama ? ` (${alasan.petugasNama})` : ''}
                        {alasan?.catatan ? `: ${alasan.catatan}` : '. Alasan tidak tercatat.'}
                      </p>
                    )}
                    {alasan?.foNama && (
                      <p className={styles.meta}>Sebelumnya dilayani Front Office: {alasan.foNama}</p>
                    )}
                    <div className={styles.aksiKartu}>
                      {b.saluran === 'chat' ? (
                        // Chat diambil lewat RPC chat_ambil di halaman Live Chat (bukan fo_ambil_dari_kotak_masuk).
                        <Link
                          href={b.chat_sesi_id ? `/admin/chat?sesi=${b.chat_sesi_id}` : '/admin/chat'}
                          className="btn btn--primary btn--sm"
                          aria-label={`Buka di Live Chat: ${k?.nama ?? 'pengunjung'}`}
                        >
                          <MessageSquare size={14} aria-hidden="true" />
                          Buka di Live Chat
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => void ambil(b)}
                          disabled={sibuk}
                          aria-busy={sibuk}
                          aria-label={`Ambil ${k?.nama ?? 'pengunjung'}`}
                        >
                          {sibuk
                            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            : <UserCheck size={14} aria-hidden="true" />}
                          {sibuk ? 'Mengambil…' : 'Ambil'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
