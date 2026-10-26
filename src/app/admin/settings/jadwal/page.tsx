'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarDays, Plus, Trash2, Loader2, Save } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { mutasiWajibBaris, mutasiInsert, MutasiError, pesanMutasi } from '@/lib/supabase/mutate';
import { perluMuatUlang } from '@/components/admin/mutasi-ui';
import { useToast } from '@/components/Toast';
import { todayWIB } from '@/lib/time';

interface Layanan {
  id: string;
  nama: string;
  is_ptsp: boolean;
  aktif?: boolean;
}

// Satu baris per hari (1 = Senin ... 7 = Minggu), sama dengan jadwal_standby yang dibaca gerbang DB.
interface HariJadwal {
  hari: number;
  aktif: boolean;
  jam_mulai: string; // 'HH:MM'
  jam_selesai: string; // 'HH:MM'
}

interface JadwalStandbyRow {
  hari: number;
  jam_mulai: string;
  jam_selesai: string;
  aktif: boolean;
}

interface HariLibur {
  tanggal: string;
  keterangan: string | null;
}

const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
// Sama dengan jam_tutup_layanan() di DB; trigger menolak jam selesai di atas ini.
const JAM_TUTUP_MAKS = '16:00';
const JAM_MULAI_BAWAAN = '08:00';
const JAM_SELESAI_BAWAAN = '15:30';

const hhmm = (t: string) => t.slice(0, 5);

function barisKosong(): HariJadwal[] {
  return NAMA_HARI.map((_, i) => ({
    hari: i + 1,
    aktif: false,
    jam_mulai: JAM_MULAI_BAWAAN,
    jam_selesai: JAM_SELESAI_BAWAAN,
  }));
}

// Hari tanpa baris di DB = tidak aktif (jam bawaan hanya untuk mempermudah bila diaktifkan).
function dariBaris(rows: JadwalStandbyRow[]): HariJadwal[] {
  const hasil = barisKosong();
  for (const r of rows) {
    const i = r.hari - 1;
    if (i < 0 || i > 6) continue;
    hasil[i] = { hari: r.hari, aktif: r.aktif, jam_mulai: hhmm(r.jam_mulai), jam_selesai: hhmm(r.jam_selesai) };
  }
  return hasil;
}

// Trigger DB menilai SETIAP baris yang ditulis (termasuk aktif = false), jadi semua hari divalidasi.
function validasiJadwal(hari: HariJadwal[]): string | null {
  for (const h of hari) {
    const nama = NAMA_HARI[h.hari - 1];
    if (!h.jam_mulai || !h.jam_selesai) return `Jam buka dan jam tutup hari ${nama} wajib diisi.`;
    if (h.jam_selesai > JAM_TUTUP_MAKS) {
      return `Jam tutup hari ${nama} tidak boleh lewat pukul ${JAM_TUTUP_MAKS} WIB.`;
    }
    if (h.jam_mulai >= h.jam_selesai) return `Jam buka hari ${nama} harus lebih awal dari jam tutup.`;
  }
  return null;
}

// Galat validasi dari trigger DB (22023 JADWAL_TIDAK_VALID) -> pesan yang bisa dibaca Admin.
function pesanGalatJadwal(e: unknown): string {
  if (e instanceof MutasiError) {
    const asal = e.asal as { code?: string; message?: string } | undefined;
    if (asal?.code === '22023') {
      const m = /JADWAL_TIDAK_VALID:\s*(.+)/.exec(asal.message ?? '');
      if (m) return `Jadwal tidak valid: ${m[1].trim()}.`;
    }
  }
  return pesanMutasi(e);
}

function formatTanggal(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export default function AdminJadwalPage() {
  const { toast } = useToast();
  const [layananList, setLayananList] = useState<Layanan[]>([]);
  const [selectedLayananId, setSelectedLayananId] = useState('');
  const [jadwal, setJadwal] = useState<HariJadwal[] | null>(null);
  const [liburList, setLiburList] = useState<HariLibur[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [galatJadwal, setGalatJadwal] = useState<string | null>(null);
  // Gagal memuat (bukan gagal menyimpan): editor disembunyikan agar jadwal kosong palsu tak bisa disimpan.
  const [galatMuatJadwal, setGalatMuatJadwal] = useState<string | null>(null);
  const [galatMuatLibur, setGalatMuatLibur] = useState<string | null>(null);

  const [liburTanggal, setLiburTanggal] = useState('');
  const [liburKeterangan, setLiburKeterangan] = useState('');
  const [adding, setAdding] = useState(false);

  // Hanya muatan terakhir yang boleh mengisi layar (ganti layanan cepat-cepat).
  const muatanTerakhir = useRef(0);

  const loadJadwal = useCallback(async (layananId: string) => {
    const muatan = ++muatanTerakhir.current;
    setJadwal(null);
    setGalatMuatJadwal(null);
    setGalatJadwal(null);
    let rows: JadwalStandbyRow[] | null = null;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('jadwal_standby')
        .select('hari, jam_mulai, jam_selesai, aktif')
        .eq('layanan_id', layananId);
      if (!error) rows = (data ?? []) as JadwalStandbyRow[];
    } catch {
      rows = null;
    }
    if (muatan !== muatanTerakhir.current) return;
    if (rows === null) {
      // Jangan render jadwal kosong (semua hari nonaktif): menyimpannya akan menutup layanan.
      setGalatMuatJadwal('Jadwal layanan ini tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.');
      return;
    }
    setJadwal(dariBaris(rows));
  }, []);

  // Hari libur nasional berlaku global; daftar dimulai dari hari ini (WIB).
  const loadLibur = useCallback(async () => {
    setGalatMuatLibur(null);
    let rows: HariLibur[] | null = null;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('hari_libur')
        .select('tanggal, keterangan')
        .gte('tanggal', todayWIB())
        .order('tanggal');
      if (!error) rows = (data ?? []) as HariLibur[];
    } catch {
      rows = null;
    }
    if (rows === null) {
      setGalatMuatLibur('Daftar hari libur tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.');
      return;
    }
    setLiburList(rows);
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // RBAC Tahap 0: jadwal & libur dikelola Admin saja (FO & petugas hanya melihat).
        const { data: p } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        setCanEdit(p?.role === 'admin');
      }

      const { data } = await supabase
        .from('layanan')
        .select('id, nama, is_ptsp, aktif')
        .order('nama');
      const list = (data ?? []) as Layanan[];
      setLayananList(list);
      await Promise.all([
        list.length > 0 ? (setSelectedLayananId(list[0].id), loadJadwal(list[0].id)) : Promise.resolve(),
        loadLibur(),
      ]);
      setLoading(false);
    }
    init();
  }, [loadJadwal, loadLibur]);

  const handleSelectLayanan = async (id: string) => {
    // Jadwal layanan sebelumnya langsung dikosongkan (di dalam loadJadwal) agar tak bisa tersimpan ke layanan baru.
    setSelectedLayananId(id);
    await loadJadwal(id);
  };

  const ubahHari = (hari: number, patch: Partial<HariJadwal>) => {
    if (!canEdit) return;
    setJadwal((prev) => prev && prev.map((h) => (h.hari === hari ? { ...h, ...patch } : h)));
    setGalatJadwal(null);
  };

  const handleSaveJadwal = async () => {
    if (!canEdit || !jadwal || !selectedLayananId) return;
    const galat = validasiJadwal(jadwal);
    if (galat) {
      setGalatJadwal(galat);
      toast(galat, 'error');
      return;
    }
    setSaving(true);
    setGalatJadwal(null);
    try {
      const supabase = createClient();
      const rows = jadwal.map((h) => ({
        layanan_id: selectedLayananId,
        hari: h.hari,
        jam_mulai: `${h.jam_mulai}:00`,
        jam_selesai: `${h.jam_selesai}:00`,
        aktif: h.aktif,
      }));
      // .select + mutasiWajibBaris: upsert yang tidak menyentuh baris/ditolak = bukan sukses.
      await mutasiWajibBaris(
        supabase.from('jadwal_standby').upsert(rows, { onConflict: 'layanan_id,hari' }).select('hari'),
      );
      toast('Jadwal layanan disimpan.', 'success');
    } catch (e) {
      const pesan = `Gagal menyimpan jadwal. ${pesanGalatJadwal(e)}`;
      setGalatJadwal(pesan);
      toast(pesan, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLibur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !liburTanggal || adding) return;
    setAdding(true);
    try {
      const supabase = createClient();
      await mutasiInsert(
        supabase.from('hari_libur').insert({
          tanggal: liburTanggal,
          keterangan: liburKeterangan.trim() || null,
        }),
      );
      setLiburTanggal('');
      setLiburKeterangan('');
      await loadLibur();
      toast('Hari libur ditambahkan.', 'success');
    } catch (err) {
      const duplikat = err instanceof MutasiError && (err.asal as { code?: string } | undefined)?.code === '23505';
      toast(
        `Gagal menambah hari libur. ${duplikat ? 'Tanggal itu sudah ada dalam daftar.' : pesanMutasi(err)}`,
        'error',
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteLibur = async (tanggal: string) => {
    if (!canEdit) return;
    try {
      const supabase = createClient();
      // .select + mutasiWajibBaris: DELETE yang ditolak RLS = 0 baris tanpa error -> bukan sukses.
      await mutasiWajibBaris(supabase.from('hari_libur').delete().eq('tanggal', tanggal).select('tanggal'));
      await loadLibur();
      toast('Hari libur dihapus.', 'success');
    } catch (e) {
      toast(`Gagal menghapus hari libur. ${pesanMutasi(e)}`, 'error');
      // Ditolak/0 baris: daftar di layar kemungkinan basi -> muat ulang.
      if (perluMuatUlang(e)) await loadLibur();
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Jadwal Layanan" description="Jadwal mingguan per layanan dan hari libur nasional" />
        <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <Loader2 size={24} className="animate-pulse" style={{ margin: '0 auto' }} aria-label="Memuat jadwal" role="img" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Jadwal Layanan"
        description="Atur jam layanan per hari untuk setiap layanan, dan hari libur nasional."
      />

      <div style={{ padding: 'var(--space-8)', maxWidth: '860px' }}>
        <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Antrian (walk-in dan reservasi) ditutup di luar jadwal dan pada hari libur. Live chat tetap bisa dipakai; di luar jadwal, bot yang menjawab.
        </p>

        {!canEdit && (
          <div
            role="status"
            style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              borderLeft: '4px solid var(--color-primary-500)',
              background: 'var(--color-primary-50)',
              color: 'var(--color-primary-700)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Jadwal ini ditetapkan Admin sesuai SOP dan jadwal resmi. Anda hanya dapat melihatnya. Hubungi Admin bila ada perubahan.
          </div>
        )}

        <div className="form-group" style={{ maxWidth: '420px' }}>
          <label className="form-label" htmlFor="jadwalLayanan">Layanan</label>
          <select
            id="jadwalLayanan"
            className="form-input"
            value={selectedLayananId}
            onChange={(e) => handleSelectLayanan(e.target.value)}
          >
            {layananList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}{l.is_ptsp ? ' (PTSP)' : ''}{l.aktif === false ? ' (diarsipkan)' : ''}
              </option>
            ))}
          </select>
        </div>

        {!jadwal && !galatMuatJadwal && selectedLayananId && (
          <p role="status" style={{ marginTop: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            Memuat jadwal...
          </p>
        )}

        {galatMuatJadwal && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--space-4)',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              borderLeft: '4px solid var(--color-error-500, #b91c1c)',
              color: 'var(--color-error-700, #991b1b)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <p style={{ marginBottom: 'var(--space-2)' }}>{galatMuatJadwal}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => loadJadwal(selectedLayananId)}>
              Coba lagi
            </button>
          </div>
        )}

        {jadwal && (
          <section
            className="table-wrapper"
            aria-labelledby="judulJadwal"
            style={{ padding: 'var(--space-6)', marginTop: 'var(--space-4)' }}
          >
            <h3 id="judulJadwal" style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <CalendarDays size={18} aria-hidden="true" /> Jadwal mingguan
            </h3>
            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              Centang hari layanan buka. Jam tutup paling lambat pukul {JAM_TUTUP_MAKS} WIB.
            </p>

            <table className="table">
              <thead>
                <tr><th scope="col">Hari</th><th scope="col">Jam buka</th><th scope="col">Jam tutup</th></tr>
              </thead>
              <tbody>
                {jadwal.map((h) => {
                  const nama = NAMA_HARI[h.hari - 1];
                  const bisaUbahJam = canEdit && h.aktif;
                  return (
                    <tr key={h.hari}>
                      <th scope="row" style={{ fontWeight: 'inherit', textAlign: 'left' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: '44px' }}>
                          <input
                            type="checkbox"
                            checked={h.aktif}
                            disabled={!canEdit}
                            onChange={(e) => ubahHari(h.hari, { aktif: e.target.checked })}
                          />
                          {nama}
                        </label>
                      </th>
                      <td>
                        <input
                          type="time" className="form-input" aria-label={`Jam buka ${nama}`}
                          value={h.jam_mulai} disabled={!bisaUbahJam}
                          onChange={(e) => ubahHari(h.hari, { jam_mulai: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="time" className="form-input" aria-label={`Jam tutup ${nama}`}
                          value={h.jam_selesai} max={JAM_TUTUP_MAKS} disabled={!bisaUbahJam}
                          onChange={(e) => ubahHari(h.hari, { jam_selesai: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {galatJadwal && (
              <p
                role="alert"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  borderLeft: '4px solid var(--color-error-500, #b91c1c)',
                  color: 'var(--color-error-700, #991b1b)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                {galatJadwal}
              </p>
            )}

            {canEdit && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <button type="button" className="btn btn--primary" onClick={handleSaveJadwal} disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-pulse" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Simpan jadwal
                </button>
              </div>
            )}
          </section>
        )}

        <section
          className="table-wrapper"
          aria-labelledby="judulLibur"
          style={{ padding: 'var(--space-6)', marginTop: 'var(--space-6)' }}
        >
          <h3 id="judulLibur" style={{ marginBottom: 'var(--space-2)' }}>Hari libur nasional</h3>
          <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            Berlaku untuk semua layanan. Antrian ditutup pada tanggal ini. Daftar dimulai dari hari ini.
          </p>

          {canEdit && (
            <form onSubmit={handleAddLibur} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="liburTanggal">Tanggal</label>
                <input
                  id="liburTanggal" type="date" className="form-input" required min={todayWIB()}
                  value={liburTanggal} onChange={(e) => setLiburTanggal(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: '200px' }}>
                <label className="form-label" htmlFor="liburKeterangan">Keterangan</label>
                <input
                  id="liburKeterangan" type="text" className="form-input" maxLength={120}
                  placeholder="Contoh: Hari Raya Idul Fitri"
                  value={liburKeterangan} onChange={(e) => setLiburKeterangan(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn--primary" disabled={adding}>
                <Plus size={16} aria-hidden="true" /> Tambah
              </button>
            </form>
          )}

          {galatMuatLibur ? (
            <div role="alert" style={{ color: 'var(--color-error-700, #991b1b)', fontSize: 'var(--text-sm)' }}>
              <p style={{ marginBottom: 'var(--space-2)' }}>{galatMuatLibur}</p>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => loadLibur()}>
                Coba lagi
              </button>
            </div>
          ) : liburList.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
              Belum ada hari libur nasional yang akan datang.{canEdit ? ' Tambahkan tanggalnya di atas.' : ''}
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tanggal</th>
                  <th scope="col">Keterangan</th>
                  {canEdit && <th scope="col">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {liburList.map((lb) => (
                  <tr key={lb.tanggal}>
                    <td>{formatTanggal(lb.tanggal)}</td>
                    <td>{lb.keterangan || '—'}</td>
                    {canEdit && (
                      <td>
                        <button
                          type="button" className="btn btn--ghost btn--sm"
                          onClick={() => handleDeleteLibur(lb.tanggal)}
                          aria-label={`Hapus hari libur ${formatTanggal(lb.tanggal)}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
