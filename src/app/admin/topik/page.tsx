'use client';

// Kelola Topik Penanganan (Admin; kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §1.6 dan §6.5).
// Topik dipilih FO saat menyelesaikan/mengeskalasi kunjungan (layanan_id NULL = topik Front Office) dan oleh petugas
// layanan saat menyelesaikan tiket hasil eskalasi (topik milik layanannya). Admin menulis LANGSUNG lewat PostgREST
// (RLS topik_penanganan_admin_tulis), tanpa RPC. Topik yang sudah terpakai TIDAK dihapus: nonaktifkan (aktif=false);
// nama topik disalin ke baris penanganan saat ditutup, jadi mengganti nama / menonaktifkan tidak mengubah riwayat.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Loader2, Plus, Pencil, Power } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import RoleNote from '@/components/admin/RoleNote';
import FormDialog from '@/components/admin/FormDialog';
import { useToast } from '@/components/Toast';
import { createClient } from '@/lib/supabase/client';
import { MutasiError, mutasiInsert, mutasiWajibBaris, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';

const FO = '__fo__';
const NAMA_MIN = 2;
const NAMA_MAX = 100;
const URUT_MAX = 9999;

interface Topik {
  id: string;
  layanan_id: string | null;
  nama: string;
  aktif: boolean;
  urut: number;
}

interface LayananOpsi {
  id: string;
  nama: string;
}

type Dialog = { mode: 'tambah' } | { mode: 'ubah'; topik: Topik } | null;

/** Pesan galat penyimpanan topik: bentrok nama (23505) dan pelanggaran CHECK panjang nama (23514) dijelaskan. */
function pesanGalatSimpan(err: unknown): string {
  if (err instanceof MutasiError) {
    const kode = (err.asal as { code?: unknown } | undefined)?.code;
    if (kode === '23505') return 'Sudah ada topik dengan nama itu pada cakupan ini (huruf besar/kecil dianggap sama).';
    if (kode === '23514') return `Nama topik harus ${NAMA_MIN}-${NAMA_MAX} karakter.`;
  }
  return `Gagal menyimpan topik. ${pesanMutasi(err)}`;
}

function FormTopik({
  dialog, cakupanNama, urutAwal, namaSudahAda, onClose, onSimpan,
}: {
  dialog: Exclude<Dialog, null>;
  cakupanNama: string;
  urutAwal: number;
  /** true bila nama (tanpa beda huruf) sudah dipakai topik lain pada cakupan yang sama. */
  namaSudahAda: (nama: string) => boolean;
  onClose: () => void;
  onSimpan: (nama: string, urut: number) => Promise<string | null>;
}) {
  const idDasar = useId();
  const edit = dialog.mode === 'ubah' ? dialog.topik : null;
  const [nama, setNama] = useState(edit?.nama ?? '');
  const [urut, setUrut] = useState(String(edit?.urut ?? urutAwal));
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [galatNama, setGalatNama] = useState<string | null>(null);
  const [galatUrut, setGalatUrut] = useState<string | null>(null);

  const kirim = async () => {
    const namaBersih = nama.trim();
    const urutAngka = Number(urut);
    const gNama = namaBersih.length < NAMA_MIN || namaBersih.length > NAMA_MAX
      ? `Nama topik harus ${NAMA_MIN}-${NAMA_MAX} karakter.`
      : namaSudahAda(namaBersih) ? 'Sudah ada topik dengan nama itu pada cakupan ini.' : null;
    const gUrut = urut.trim() === '' || !Number.isInteger(urutAngka) || urutAngka < 0 || urutAngka > URUT_MAX
      ? `Urutan harus bilangan bulat 0-${URUT_MAX}.`
      : null;
    setGalatNama(gNama);
    setGalatUrut(gUrut);
    if (gNama || gUrut) return;
    setGalat(null);
    setMengirim(true);
    const hasil = await onSimpan(namaBersih, urutAngka);
    setMengirim(false);
    if (hasil) setGalat(hasil);
  };

  return (
    <FormDialog
      judul={dialog.mode === 'tambah' ? 'Tambah topik' : 'Ubah topik'}
      deskripsi={`Cakupan: ${cakupanNama}.`}
      labelKirim="Simpan"
      mengirim={mengirim}
      galat={galat}
      onClose={onClose}
      onSubmit={kirim}
    >
      {() => (
        <>
          <div className="form-group">
            <label htmlFor={`${idDasar}-nama`} className="form-label form-label--required">Nama topik</label>
            <input
              id={`${idDasar}-nama`}
              className="form-input"
              value={nama}
              maxLength={NAMA_MAX}
              disabled={mengirim}
              aria-required="true"
              aria-invalid={galatNama ? true : undefined}
              aria-describedby={galatNama ? `${idDasar}-nama-bantuan ${idDasar}-nama-galat` : `${idDasar}-nama-bantuan`}
              onChange={(e) => { setNama(e.target.value); setGalatNama(null); setGalat(null); }}
              data-autofocus
            />
            <small id={`${idDasar}-nama-bantuan`} style={{ color: 'var(--text-tertiary)' }}>
              {NAMA_MIN}-{NAMA_MAX} karakter, unik pada cakupan ini.
            </small>
            {galatNama && (
              <p id={`${idDasar}-nama-galat`} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' }}>
                {galatNama}
              </p>
            )}
          </div>
          <div className="form-group">
            <label htmlFor={`${idDasar}-urut`} className="form-label form-label--required">Urutan tampil</label>
            <input
              id={`${idDasar}-urut`}
              className="form-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={URUT_MAX}
              step={1}
              value={urut}
              disabled={mengirim}
              aria-required="true"
              aria-invalid={galatUrut ? true : undefined}
              aria-describedby={galatUrut ? `${idDasar}-urut-bantuan ${idDasar}-urut-galat` : `${idDasar}-urut-bantuan`}
              onChange={(e) => { setUrut(e.target.value); setGalatUrut(null); setGalat(null); }}
            />
            <small id={`${idDasar}-urut-bantuan`} style={{ color: 'var(--text-tertiary)' }}>
              Angka kecil tampil lebih dulu. Topik &ldquo;Lainnya&rdquo; biasanya diberi urutan 99.
            </small>
            {galatUrut && (
              <p id={`${idDasar}-urut-galat`} role="alert" style={{ color: 'var(--color-danger-600)', fontSize: 12, margin: '4px 0 0' }}>
                {galatUrut}
              </p>
            )}
          </div>
        </>
      )}
    </FormDialog>
  );
}

export default function KelolaTopikPage() {
  const { toast } = useToast();
  const idPilih = useId();
  const [topik, setTopik] = useState<Topik[]>([]);
  const [layanan, setLayanan] = useState<LayananOpsi[]>([]);
  const [loading, setLoading] = useState(true);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [cakupan, setCakupan] = useState<string>(FO);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sibuk, setSibuk] = useState<ReadonlySet<string>>(new Set());
  const [pengumuman, setPengumuman] = useState('');

  const muat = useCallback(async () => {
    try {
      const supabase = createClient();
      const [t, l] = await Promise.all([
        supabase.from('topik_penanganan').select('id, layanan_id, nama, aktif, urut').order('urut').order('nama'),
        supabase.from('layanan').select('id, nama').order('nama'),
      ]);
      if (t.error) throw t.error;
      if (l.error) throw l.error;
      setTopik((t.data ?? []) as Topik[]);
      setLayanan((l.data ?? []) as LayananOpsi[]);
      setGalatMuat(null);
    } catch {
      setGalatMuat('Gagal memuat topik penanganan. Muat ulang halaman atau coba lagi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muat();
  }, [muat]);

  const layananId = cakupan === FO ? null : cakupan;
  const namaCakupan = cakupan === FO ? 'Front Office' : layanan.find((l) => l.id === cakupan)?.nama ?? 'Layanan';
  const daftar = useMemo(
    () => topik.filter((t) => (t.layanan_id ?? FO) === cakupan),
    [topik, cakupan],
  );
  const jumlahPerCakupan = useMemo(() => {
    const peta = new Map<string, number>();
    for (const t of topik) peta.set(t.layanan_id ?? FO, (peta.get(t.layanan_id ?? FO) ?? 0) + 1);
    return peta;
  }, [topik]);

  const urutBerikut = useMemo(() => {
    const biasa = daftar.filter((t) => t.urut < 99).map((t) => t.urut);
    return biasa.length ? Math.min(98, Math.max(...biasa) + 1) : 1;
  }, [daftar]);

  const simpan = async (nama: string, urut: number): Promise<string | null> => {
    const supabase = createClient();
    try {
      if (dialog?.mode === 'ubah') {
        const ubah = dialog.topik;
        await mutasiWajibBaris(
          supabase.from('topik_penanganan').update({ nama, urut }).eq('id', ubah.id).select('id'),
        );
        toast(`Topik "${nama}" diperbarui`, 'success');
      } else {
        await mutasiInsert(
          supabase.from('topik_penanganan').insert({ layanan_id: layananId, nama, urut, aktif: true }).select('id'),
        );
        toast(`Topik "${nama}" ditambahkan`, 'success');
      }
      setDialog(null);
      await muat();
      return null;
    } catch (e) {
      if (perluMuatUlang(e)) await muat();
      return pesanGalatSimpan(e);
    }
  };

  const ubahAktif = async (t: Topik) => {
    if (sibuk.has(t.id)) return;
    setSibuk((s) => new Set(s).add(t.id));
    setPengumuman(`${t.aktif ? 'Menonaktifkan' : 'Mengaktifkan'} topik ${t.nama}…`);
    try {
      const supabase = createClient();
      await mutasiWajibBaris(
        supabase.from('topik_penanganan').update({ aktif: !t.aktif }).eq('id', t.id).select('id'),
      );
      toast(`Topik "${t.nama}" ${t.aktif ? 'dinonaktifkan' : 'diaktifkan'}`, 'success');
      await muat();
    } catch (e) {
      toast(`Gagal mengubah status topik. ${pesanMutasi(e)}`, 'error');
      if (perluMuatUlang(e)) await muat();
    } finally {
      setSibuk((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
      setPengumuman('');
    }
  };

  return (
    <>
      <PageHeader
        title="Topik Penanganan"
        description="Daftar topik yang dipilih Front Office dan petugas layanan saat menyelesaikan penanganan"
      >
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => setDialog({ mode: 'tambah' })}
          disabled={loading || galatMuat !== null}
        >
          <Plus size={14} aria-hidden="true" /> Tambah topik
        </button>
      </PageHeader>

      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <RoleNote>
          Hanya Admin yang dapat mengelola topik. Topik yang sudah pernah dipakai tidak dihapus: nonaktifkan agar tidak
          muncul lagi di pilihan. Riwayat penanganan menyimpan salinan nama topik, jadi mengubah nama atau
          menonaktifkan tidak mengubah data lama.
        </RoleNote>

        <div className="form-group" style={{ maxWidth: 420, marginBottom: 'var(--space-4)' }}>
          <label htmlFor={idPilih} className="form-label">Cakupan topik</label>
          <select
            id={idPilih}
            className="form-select"
            value={cakupan}
            onChange={(e) => setCakupan(e.target.value)}
          >
            <option value={FO}>Front Office ({jumlahPerCakupan.get(FO) ?? 0})</option>
            {layanan.map((l) => (
              <option key={l.id} value={l.id}>{l.nama} ({jumlahPerCakupan.get(l.id) ?? 0})</option>
            ))}
          </select>
        </div>

        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="status" aria-label="Memuat">
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} aria-hidden="true" />
            </div>
          ) : galatMuat ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }} role="alert" className="form-error">
              {galatMuat}
            </div>
          ) : daftar.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Belum ada topik untuk {namaCakupan}. Pilih &ldquo;Tambah topik&rdquo; untuk membuatnya.
            </div>
          ) : (
            <table className="table">
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
                Topik penanganan {namaCakupan}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Topik</th>
                  <th scope="col">Urutan</th>
                  <th scope="col">Status</th>
                  <th scope="col">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {daftar.map((t) => {
                  const sedang = sibuk.has(t.id);
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.nama}</td>
                      <td>{t.urut}</td>
                      <td>
                        <span className={`badge ${t.aktif ? 'badge--aktif' : 'badge--nonaktif'}`}>
                          {t.aktif ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            aria-label={`Ubah topik ${t.nama}`}
                            onClick={() => setDialog({ mode: 'ubah', topik: t })}
                            disabled={sedang}
                          >
                            <Pencil size={14} aria-hidden="true" /> Ubah
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`${t.aktif ? 'Nonaktifkan' : 'Aktifkan'} topik ${t.nama}`}
                            onClick={() => ubahAktif(t)}
                            disabled={sedang}
                            aria-busy={sedang}
                          >
                            <Power size={14} aria-hidden="true" /> {sedang ? 'Memproses…' : t.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p
        role="status"
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
      >
        {pengumuman}
      </p>

      {dialog && (
        <FormTopik
          key={dialog.mode === 'ubah' ? dialog.topik.id : 'tambah'}
          dialog={dialog}
          cakupanNama={namaCakupan}
          urutAwal={urutBerikut}
          namaSudahAda={(nama) =>
            daftar.some(
              (t) => t.nama.trim().toLowerCase() === nama.toLowerCase() && !(dialog.mode === 'ubah' && t.id === dialog.topik.id),
            )
          }
          onClose={() => setDialog(null)}
          onSimpan={simpan}
        />
      )}
    </>
  );
}
