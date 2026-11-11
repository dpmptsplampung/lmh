// @vitest-environment jsdom
// Karakterisasi halaman antrean admin untuk refaktor G5 (rencana 2026-11-11, tugas 5.1). Test ini mengunci perilaku yang
// BELUM tercakup antrian*.test.tsx dan harus tetap hijau saat halaman dipecah menjadi data/turunan/hook/bagian:
//   1. kumpulan kueri saat muat dan muat ulang. Asersi berbasis HIMPUNAN (jenis kueri apa saja yang dikirim, berapa kali),
//      TIDAK bergantung pada urutan, karena tugas 5.2 memparalelkannya.
//   2. galat per bagian muat (bagian mana yang menggagalkan seluruh muat, bagian mana yang diam-diam kosong).
//   3. aksi panggil / mulai / selesaikan beserta efek sampingnya (muat ulang, QR, wizard).
//   4. tujuh modal (ambil alih, alihkan, kembalikan ke FO, selesai eskalasi, koreksi, wizard pelayanan, QR survei):
//      terbuka dari tombol yang benar dengan props yang benar, menutup, dan memicu muat ulang sesuai kontraknya.
//   5. turunan tampilan (panel Sekarang, label, kepala halaman) dan rekap absen.
// Klien Supabase di sini adalah tiruan generik yang mencatat tiap kueri yang DIKIRIM (saat di-await) dan menjawab dari
// data skenario, jadi bentuk rantai (urutan .eq/.in/.order) tidak dikunci, hanya isi kueri.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';

const toastMock = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({ query: 'status=semua', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/antrian',
  useSearchParams: () => new URLSearchParams(nav.query),
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

// Fungsi muat ulang yang diberikan ke hook realtime ditangkap supaya tes dapat memicunya (event/polling) dan memeriksa opsinya.
const realtime = vi.hoisted(() => ({ refetch: null as null | (() => Promise<void>), opsi: null as unknown }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({
  useRealtimeRefetch: (fn: () => Promise<void>, opsi: unknown) => {
    realtime.refetch = fn;
    realtime.opsi = opsi;
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock('@/components/Pagination', () => ({ default: () => null }));
vi.mock('@/components/admin/CalendarBanner', () => ({ default: () => null }));
vi.mock('@/components/admin/PemberitahuanAmbilAlih', () => ({
  default: ({ petugasId }: { petugasId?: string }) => <div data-testid="pemberitahuan" data-petugas={petugasId ?? ''} />,
}));
vi.mock('@/components/WalkinWizard', () => ({
  default: ({ fixedLayananId, onSuccess, triggerLabel }: {
    fixedLayananId?: string | null; onSuccess?: () => void; triggerLabel: string;
  }) => (
    <button type="button" data-testid="walkin" data-layanan={fixedLayananId ?? ''} onClick={() => onSuccess?.()}>
      {triggerLabel}
    </button>
  ),
}));

// Panel Sekarang diuji terpisah; di sini diganti tiruan yang mengekspos props turunan sebagai atribut dan memanggil
// penangan halaman lewat tombol (mengunci batas antara halaman dan panel). Ekspor lain dipertahankan.
vi.mock('./PanelSekarang', async (importAsli) => {
  const asli = await importAsli<typeof import('./PanelSekarang')>();
  type Tiket = {
    id: string; nomor_display: string; layananNama: string; namaPengunjung: string; waktu: string | null;
    bolehMulai: boolean; bolehSelesai: boolean;
  };
  type Props = {
    sedangDilayani: Tiket | null; berikutnya: Tiket | null; layananOpsi: Array<{ id: string; nama: string }>;
    layananId: string | null; onLayananChange?: (id: string) => void; tanpaTiketSaya?: boolean;
    onPanggil: (t: Tiket) => unknown; onMulai: (t: Tiket) => unknown; onSelesai: (t: Tiket) => unknown;
  };
  return {
    ...asli,
    default: (p: Props) => (
      <div
        data-testid="panel"
        data-layanan={p.layananId ?? ''}
        data-opsi={p.layananOpsi.map((o) => `${o.id}:${o.nama}`).join('|')}
        data-tanpa-saya={String(Boolean(p.tanpaTiketSaya))}
        data-dilayani={JSON.stringify(p.sedangDilayani)}
        data-berikutnya={JSON.stringify(p.berikutnya)}
      >
        <button type="button" onClick={() => p.berikutnya && p.onPanggil(p.berikutnya)}>panel: panggil</button>
        <button type="button" onClick={() => p.berikutnya && p.onMulai(p.berikutnya)}>panel: mulai</button>
        <button type="button" onClick={() => p.sedangDilayani && p.onSelesai(p.sedangDilayani)}>panel: selesai</button>
        <select aria-label="panel: pilih layanan" value={p.layananId ?? ''} onChange={(e) => p.onLayananChange?.(e.target.value)}>
          {p.layananOpsi.map((o) => <option key={o.id} value={o.id}>{o.nama}</option>)}
        </select>
      </div>
    ),
  };
});

// Tujuh modal diganti tiruan: mengekspos props sebagai atribut, dan tombol yang mengikuti urutan panggilan komponen asli
// (`await onSuccess(); onClose()` untuk empat dialog tiket; `onSuccess(); onClose()` untuk koreksi dan wizard).
type TiketModal = Record<string, unknown>;
interface PropsDialog {
  tiket: TiketModal; mode?: string; onClose: () => void; onSuccess?: () => void | Promise<void>;
}
// Deklarasi fungsi (bukan const) agar terangkat bersama vi.mock.
function TiruanDialog({ testId, nama, tiket, mode, onClose, onSuccess }: PropsDialog & { testId: string; nama: string }) {
  return (
    <div data-testid={testId} data-mode={mode ?? ''} data-tiket={JSON.stringify(tiket)}>
      <button type="button" onClick={async () => { await onSuccess?.(); onClose(); }}>{nama}: berhasil</button>
      <button type="button" onClick={() => { void onSuccess?.(); }}>{nama}: basi</button>
      <button type="button" onClick={() => onClose()}>{nama}: tutup</button>
    </div>
  );
}
vi.mock('@/components/admin/AmbilAlihTiketModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="modal-ambil-alih" nama="ambil alih" {...p} />,
}));
vi.mock('@/components/admin/AlihkanTiketModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="modal-alihkan" nama="alihkan" {...p} />,
}));
vi.mock('@/components/admin/KembalikanKeFoModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="modal-kembalikan" nama="kembalikan" {...p} />,
}));
vi.mock('@/components/admin/SelesaiEskalasiModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="modal-selesai-eskalasi" nama="selesai eskalasi" {...p} />,
}));
vi.mock('@/components/admin/KoreksiPelayananModal', () => ({
  default: ({ isOpen, tiketId, onClose, onSuccess }: {
    isOpen: boolean; tiketId: string | null; onClose: () => void; onSuccess?: () => void;
  }) => (
    <div data-testid="modal-koreksi" data-open={String(isOpen)} data-tiket-id={tiketId ?? ''}>
      {isOpen && (
        <>
          <button type="button" onClick={() => { onSuccess?.(); onClose(); }}>koreksi: berhasil</button>
          <button type="button" onClick={() => onClose()}>koreksi: tutup</button>
        </>
      )}
    </div>
  ),
}));
vi.mock('@/components/admin/PelayananWizardModal', () => ({
  default: ({ isOpen, tiketId, onClose, onSuccess, onDataBasi }: {
    isOpen: boolean; tiketId: string | null; onClose: () => void; onSuccess?: () => void; onDataBasi?: () => void | Promise<void>;
  }) => (
    <div data-testid="modal-wizard" data-open={String(isOpen)} data-tiket-id={tiketId ?? ''}>
      {isOpen && (
        <>
          <button type="button" onClick={() => { onSuccess?.(); onClose(); }}>wizard: kunci</button>
          <button type="button" onClick={() => { void onDataBasi?.(); }}>wizard: data basi</button>
          <button type="button" onClick={() => onClose()}>wizard: tutup</button>
        </>
      )}
    </div>
  ),
}));
vi.mock('@/components/admin/SurveiQrDialog', () => ({
  default: ({ kunjunganId, onTutup }: { kunjunganId: string; onTutup: () => void }) => (
    <div data-testid="modal-qr" data-kunjungan={kunjunganId}>
      <button type="button" onClick={onTutup}>qr: tutup</button>
    </div>
  ),
}));

import AntrianPage from './page';
import { createClient } from '@/lib/supabase/client';
import { todayWIB } from '@/lib/time';

// ── Klien Supabase tiruan generik ───────────────────────────────────────────────────────────────────────────

const SAYA = 'p-saya';

type Baris = Record<string, unknown>;
type DbError = { message: string; code?: string };
type HasilDb = { data: unknown; count?: number | null; error: DbError | null };
type HasilRpc = { data: unknown; error: DbError | null };

interface Kueri {
  tabel: string;
  select: string;
  opsi: Record<string, unknown> | undefined;
  eq: Array<[string, unknown]>;
  in: Array<[string, readonly unknown[]]>;
  order: Array<[string, unknown]>;
  range: [number, number] | null;
  satu: boolean;
}

type Jenis = 'utama' | 'panel' | 'stats' | 'total' | 'profil' | 'koordinator' | 'catatan' | 'survei' | 'absensi' | 'lain';

/** Untuk apa sebuah kueri dikirim, ditentukan dari isinya (bukan dari urutan atau cara menyusunnya). */
function jenisKueri(k: Kueri): Jenis {
  if (k.tabel === 'petugas') return k.select.trim() === 'koordinator' ? 'koordinator' : 'profil';
  if (k.tabel === 'penanganan') return 'catatan';
  if (k.tabel === 'v_survei_status') return 'survei';
  if (k.tabel === 'absensi_petugas') return 'absensi';
  if (k.tabel === 'tiket_antrean') {
    if (k.opsi?.head) return 'total';
    if (k.eq.some(([kolom, nilai]) => kolom === 'status' && nilai === 'selesai')) return 'stats';
    if (k.range) return k.range[1] - k.range[0] === 199 ? 'panel' : 'utama';
  }
  return 'lain';
}

interface Skenario {
  role?: 'admin' | 'petugas' | 'front_office';
  layananId?: string | null;
  koordinator?: boolean;
  /** Isi tiket_antrean; kueri menyaring dengan .eq/.in kolom yang ada di baris lalu memotong menurut .range. */
  rows?: Baris[];
  penanganan?: Array<{ id: string; topik: string | null; catatan: string | null; penangan: { nama: string } | null }>;
  survei?: Array<{ kunjungan_id: string; status: string }>;
  absensi?: Baris[];
  rpc?: Record<string, HasilRpc | Promise<HasilRpc> | ((args: Record<string, unknown>) => HasilRpc | Promise<HasilRpc>)>;
  /** Jenis kueri yang dijawab galat; boleh diubah di tengah tes (mis. dikosongkan sebelum "Coba lagi"). */
  galat?: Set<Jenis>;
  /** Tahan jawaban kueri `jenis` ke-`nomor` (mulai 1) sampai promise yang dikembalikan selesai. */
  tahan?: (jenis: Jenis, nomor: number) => Promise<void> | undefined;
  /** Timpa jawaban kueri `jenis` ke-`nomor` (mulai 1). */
  timpa?: (jenis: Jenis, nomor: number, k: Kueri) => Partial<HasilDb> | undefined;
}

function saring(rows: Baris[], k: Kueri): Baris[] {
  let hasil = rows;
  for (const [kolom, nilai] of k.eq) {
    if (hasil.length && kolom in hasil[0]) hasil = hasil.filter((r) => r[kolom] === nilai);
  }
  for (const [kolom, daftar] of k.in) hasil = hasil.filter((r) => daftar.includes(r[kolom]));
  return hasil;
}

function buatKlien(skn: Skenario = {}) {
  const role = skn.role ?? 'admin';
  const layananId = skn.layananId === undefined ? (role === 'petugas' ? 'l-1' : null) : skn.layananId;
  const rows = skn.rows ?? [];
  const log: Kueri[] = [];
  const nomorPerJenis: Partial<Record<Jenis, number>> = {};

  const jawabDefault = (jenis: Jenis, k: Kueri): HasilDb => {
    switch (jenis) {
      case 'profil':
        return { data: { id: SAYA, role, layanan_id: layananId, layanan: { nama: 'Helpdesk OSS' } }, error: null };
      case 'koordinator':
        return { data: { koordinator: skn.koordinator ?? false }, error: null };
      case 'utama':
      case 'panel': {
        const cocok = saring(rows, k);
        const [dari, sampai] = k.range as [number, number];
        return { data: cocok.slice(dari, sampai + 1), count: cocok.length, error: null };
      }
      case 'stats': {
        const cocok = saring(rows, k);
        return {
          data: cocok.map((r) => ({ waktu_mulai_layan: r.waktu_mulai_layan, waktu_selesai: r.waktu_selesai })),
          count: cocok.length,
          error: null,
        };
      }
      case 'total':
        return { data: null, count: saring(rows, k).length, error: null };
      case 'catatan': {
        const ids = (k.in.find(([kolom]) => kolom === 'id')?.[1] ?? []) as string[];
        return { data: (skn.penanganan ?? []).filter((p) => ids.includes(p.id)), error: null };
      }
      case 'survei': {
        const ids = (k.in.find(([kolom]) => kolom === 'kunjungan_id')?.[1] ?? []) as string[];
        return { data: (skn.survei ?? []).filter((s) => ids.includes(s.kunjungan_id)), error: null };
      }
      case 'absensi':
        return { data: skn.absensi ?? [], error: null };
      default:
        return { data: [], error: null };
    }
  };

  const jawab = async (k: Kueri): Promise<HasilDb> => {
    const jenis = jenisKueri(k);
    const nomor = (nomorPerJenis[jenis] = (nomorPerJenis[jenis] ?? 0) + 1);
    const gerbang = skn.tahan?.(jenis, nomor);
    if (gerbang) await gerbang;
    if (skn.galat?.has(jenis)) return { data: null, count: null, error: { message: `boom ${jenis}` } };
    const timpaan = skn.timpa?.(jenis, nomor, k);
    return timpaan ? { data: null, count: null, error: null, ...timpaan } : jawabDefault(jenis, k);
  };

  const from = vi.fn((tabel: string) => {
    const k: Kueri = { tabel, select: '', opsi: undefined, eq: [], in: [], order: [], range: null, satu: false };
    const b: Record<string, unknown> = {};
    b.select = (s: string, o?: Record<string, unknown>) => { k.select = s; k.opsi = o; return b; };
    b.eq = (kolom: string, nilai: unknown) => { k.eq.push([kolom, nilai]); return b; };
    b.in = (kolom: string, nilai: readonly unknown[]) => { k.in.push([kolom, nilai]); return b; };
    b.order = (kolom: string, o?: unknown) => { k.order.push([kolom, o]); return b; };
    b.range = (dari: number, sampai: number) => { k.range = [dari, sampai]; return b; };
    b.single = () => { k.satu = true; return b; };
    b.maybeSingle = () => { k.satu = true; return b; };
    b.then = (selesai: (v: HasilDb) => unknown, tolak?: (e: unknown) => unknown) => {
      log.push(k);
      return jawab(k).then(selesai, tolak);
    };
    return b;
  });

  const rpcDefault: Record<string, HasilRpc> = {
    fo_antrean_daftar: { data: null, error: { code: 'PGRST202', message: 'fungsi tidak ada' } },
    panggil_tiket: { data: 'A-001', error: null },
    layanan_mulai: { data: { ok: true, sudah_milik_anda: false }, error: null },
    layanan_selesai: { data: { ok: true, is_locked: false }, error: null },
    ambil_qr_survei: { data: { status: 'tidak_ada', token: null, kedaluwarsa_pada: null, unit: null, layanan_nama: null }, error: null },
  };
  const rpc = vi.fn((nama: string, args: Record<string, unknown> = {}) => {
    const atur = skn.rpc?.[nama];
    const hasil = typeof atur === 'function' ? atur(args) : (atur ?? rpcDefault[nama] ?? { data: { ok: true }, error: null });
    return Promise.resolve(hasil);
  });

  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  vi.mocked(createClient).mockReturnValue({ auth: { getUser }, from, rpc } as unknown as ReturnType<typeof createClient>);
  return { log, from, rpc, getUser };
}

type Klien = ReturnType<typeof buatKlien>;

/** Jenis kueri yang dikirim sejak indeks `dari`, tanpa duplikat, terurut (himpunan). */
const himpunan = (klien: Klien, dari = 0): Jenis[] =>
  Array.from(new Set(klien.log.slice(dari).map(jenisKueri))).sort();
/** Jumlah kueri per jenis sejak indeks `dari`. */
const hitung = (klien: Klien, dari = 0): Partial<Record<Jenis, number>> => {
  const hasil: Partial<Record<Jenis, number>> = {};
  for (const k of klien.log.slice(dari)) hasil[jenisKueri(k)] = (hasil[jenisKueri(k)] ?? 0) + 1;
  return hasil;
};
const kueriJenis = (klien: Klien, jenis: Jenis, dari = 0) => klien.log.slice(dari).filter((k) => jenisKueri(k) === jenis);
const panggilanRpc = (klien: Klien, nama: string) =>
  (klien.rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([n]) => n === nama);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Muat ulang dari realtime/polling. */
async function segarkan() {
  await waitFor(() => expect(realtime.refetch).not.toBeNull());
  await act(async () => { await realtime.refetch!(); });
}
/** Menunggu sampai himpunan kueri sejak `dari` sama dengan `harapan` (satu putaran muat ulang). */
const tungguHimpunan = (klien: Klien, dari: number, harapan: Jenis[]) =>
  waitFor(() => expect(himpunan(klien, dari)).toEqual(harapan));
/** Memastikan tidak ada kueri baru (muat ulang) dalam jeda singkat. */
async function pastikanTanpaKueri(klien: Klien, dari: number) {
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  expect(klien.log.length).toBe(dari);
}

// Himpunan kueri satu putaran muat (tab Aktif/Semua, hari ini) dan varian lainnya.
const MUAT: Jenis[] = ['panel', 'stats', 'total', 'utama'];

// ── Data baris ───────────────────────────────────────────────────────────────────────────────────────────────

const OSS = { nama: 'Helpdesk OSS', form_pendataan: 'oss' };
const BPJS = { nama: 'BPJS Kesehatan', form_pendataan: null };
const sekarangIso = () => new Date().toISOString();

const baris = (over: Baris = {}): Baris => ({
  id: 't-1',
  kunjungan_id: 'k-1',
  legacy_visit_id: 'v-1',
  layanan_id: 'l-1',
  dilayani_oleh: null,
  penanganan_asal_id: null,
  pelayan: null,
  nomor: 1,
  nomor_display: 'A-001',
  status: 'menunggu',
  waktu_terbit: sekarangIso(),
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: OSS,
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: sekarangIso() },
  ...over,
});
const dilayaniSaya = (over: Baris = {}) =>
  baris({ status: 'dilayani', dilayani_oleh: SAYA, waktu_mulai_layan: sekarangIso(), ...over });
const dilayaniLain = (over: Baris = {}) =>
  baris({ status: 'dilayani', dilayani_oleh: 'p-lain', pelayan: { nama: 'Petugas Dua' }, waktu_mulai_layan: sekarangIso(), ...over });
const selesai = (over: Baris = {}) =>
  baris({
    status: 'selesai', dilayani_oleh: SAYA, waktu_mulai_layan: '2026-11-04T10:00:00.000Z',
    waktu_selesai: '2026-11-04T10:25:00.000Z', ...over,
  });
const eskalasi = (over: Baris = {}) => baris({ penanganan_asal_id: 'pn-fo', ...over });

// ── Pembantu tampilan ────────────────────────────────────────────────────────────────────────────────────────

const terbuka = (id: string) => {
  const e = screen.queryByTestId(id);
  return e !== null && e.getAttribute('data-open') !== 'false';
};
const dataTiket = (id: string) => JSON.parse(screen.getByTestId(id).getAttribute('data-tiket') ?? 'null') as Record<string, unknown>;
const klik = (nama: string | RegExp) => fireEvent.click(screen.getByRole('button', { name: nama }));
const muatHalaman = async (teks = 'Budi') => {
  render(<AntrianPage />);
  await screen.findByText(teks);
};

let spyError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  toastMock.mockClear();
  realtime.refetch = null;
  realtime.opsi = null;
  nav.query = 'status=semua';
  spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  spyError.mockRestore();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Kumpulan kueri
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Antrean: kumpulan kueri saat memuat dan menyegarkan (himpunan, bukan urutan)', () => {
  it('Admin, hari ini, tab Aktif: muat awal = profil + utama/panel/stats/total; muat ulang tanpa profil; realtime tiket_antrean + polling 30 dtk', async () => {
    nav.query = '';
    const klien = buatKlien({ role: 'admin', rows: [baris()] });
    await muatHalaman();
    expect(himpunan(klien)).toEqual(['panel', 'profil', 'stats', 'total', 'utama']);
    expect(klien.getUser).toHaveBeenCalledTimes(1);
    expect(realtime.opsi).toEqual({ table: 'tiket_antrean', pollMs: 30_000 });

    const tanda = klien.log.length;
    await segarkan();
    expect(himpunan(klien, tanda)).toEqual(MUAT);
    expect(hitung(klien, tanda)).toEqual({ panel: 1, stats: 1, total: 1, utama: 1 });
    expect(klien.getUser).toHaveBeenCalledTimes(1);
  });

  it('Petugas dan Front Office: penanda Koordinator dibaca sekali bersama profil; Admin tidak membacanya', async () => {
    const klien = buatKlien({ role: 'petugas', layananId: 'l-1', rows: [baris()] });
    await muatHalaman();
    expect(himpunan(klien)).toEqual(['koordinator', 'panel', 'profil', 'stats', 'total', 'utama']);
    const tanda = klien.log.length;
    await segarkan();
    expect(himpunan(klien, tanda)).toEqual(MUAT);
  });

  it.each([
    ['tab Selesai hari ini (tanpa panel, status survei dimuat)', 'status=selesai', [selesai()], ['stats', 'survei', 'total', 'utama']],
    ['tanggal lampau, tab Semua (tanpa panel)', 'status=semua&tanggal=2026-01-02', [baris()], ['stats', 'total', 'utama']],
    ['hari ini, tab Semua (dengan panel)', 'status=semua', [baris()], ['panel', 'stats', 'total', 'utama']],
  ] as Array<[string, string, Baris[], Jenis[]]>)('muat ulang: %s', async (_nama, query, rows, harapan) => {
    nav.query = query;
    const klien = buatKlien({ rows });
    await muatHalaman();
    const tanda = klien.log.length;
    await segarkan();
    expect(himpunan(klien, tanda)).toEqual(harapan);
  });

  it.each(['admin', 'petugas'] as const)('bentuk tiap kueri tiket (%s): kolom eksplisit, saringan, rentang, hitungan', async (role) => {
    nav.query = '';
    const klien = buatKlien({ role, layananId: role === 'petugas' ? 'l-1' : null, rows: [baris()] });
    await muatHalaman();
    const hariIni = todayWIB();
    const lingkup: Array<[string, unknown]> = role === 'petugas' ? [['layanan_id', 'l-1']] : [];

    const utama = kueriJenis(klien, 'utama')[0];
    for (const kolom of ['dilayani_oleh', 'kunjungan_id', 'penanganan_asal_id', 'nomor_display', 'waktu_mulai_layan',
      'layanan:layanan_id(nama, form_pendataan)', 'pelayan:dilayani_oleh(nama)', 'kunjungan(nama, asal, waktu_masuk)']) {
      expect(norm(utama.select)).toContain(kolom);
    }
    expect(utama.select).not.toContain('*');
    expect(utama.opsi).toEqual({ count: 'exact' });
    expect(utama.eq).toEqual(expect.arrayContaining([['tanggal', hariIni], ...lingkup]));
    expect(utama.eq.some(([kolom]) => kolom === 'status')).toBe(false);
    expect(utama.in).toEqual([['status', ['menunggu', 'dilayani']]]);
    expect(utama.order).toEqual([['nomor', { ascending: true }]]);
    expect(utama.range).toEqual([0, 24]);

    const panel = kueriJenis(klien, 'panel')[0];
    expect(norm(panel.select)).toBe(norm(utama.select));
    expect(panel.opsi).toEqual({ count: 'exact' });
    expect(panel.eq).toEqual(expect.arrayContaining([['tanggal', hariIni], ...lingkup]));
    expect(panel.in).toEqual([['status', ['menunggu', 'dilayani']]]);
    expect(panel.order).toEqual([['nomor', { ascending: true }]]);
    expect(panel.range).toEqual([0, 199]);

    const stats = kueriJenis(klien, 'stats')[0];
    expect(norm(stats.select)).toBe('waktu_mulai_layan, waktu_selesai');
    expect(stats.opsi).toEqual({ count: 'exact' });
    expect(stats.eq).toEqual(expect.arrayContaining([['tanggal', hariIni], ['status', 'selesai'], ...lingkup]));

    const total = kueriJenis(klien, 'total')[0];
    expect(norm(total.select)).toBe('id');
    expect(total.opsi).toEqual({ count: 'exact', head: true });
    expect(total.eq).toEqual(expect.arrayContaining([['tanggal', hariIni], ...lingkup]));
    expect(total.eq.some(([kolom]) => kolom === 'status')).toBe(false);
    expect(total.in).toEqual([]);

    if (role === 'admin') {
      for (const k of [utama, panel, stats, total]) expect(k.eq.some(([kolom]) => kolom === 'layanan_id')).toBe(false);
    }
  });

  it('halaman 2 di URL: kueri utama membaca baris 25-49; panel tetap dari awal', async () => {
    nav.query = 'status=semua&halaman=2';
    const rows = Array.from({ length: 30 }, (_, i) => baris({
      id: `t-${i + 1}`, nomor: i + 1, nomor_display: `A-${String(i + 1).padStart(3, '0')}`,
      kunjungan: { nama: `Tamu ${i + 1}`, asal: 'walk_in', waktu_masuk: sekarangIso() },
    }));
    const klien = buatKlien({ rows });
    await muatHalaman('Tamu 26');
    expect(kueriJenis(klien, 'utama')[0].range).toEqual([25, 49]);
    expect(kueriJenis(klien, 'panel')[0].range).toEqual([0, 199]);
    expect(screen.queryByText('Tamu 25')).toBeNull();
    expect(screen.getByText('Tamu 30')).toBeInTheDocument();
  });

  it('kueri lanjutan: catatan eskalasi per id tahap asal (unik) dan status survei per kunjungan selesai (unik)', async () => {
    const klien = buatKlien({
      rows: [
        eskalasi({ id: 't-1', nomor: 1 }),
        eskalasi({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan_id: 'k-2', kunjungan: { nama: 'Dewi', asal: 'walk_in', waktu_masuk: null } }),
        selesai({ id: 't-3', nomor: 3, nomor_display: 'A-003', kunjungan_id: 'k-3', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
        baris({ id: 't-4', nomor: 4, nomor_display: 'A-004', kunjungan_id: 'k-4', kunjungan: { nama: 'Eko', asal: 'walk_in', waktu_masuk: null } }),
      ],
      penanganan: [{ id: 'pn-fo', topik: 'Pertanyaan BPJS', catatan: 'Menanyakan klaim', penangan: { nama: 'Siti FO' } }],
      survei: [{ kunjungan_id: 'k-3', status: 'belum_diisi' }],
    });
    await muatHalaman();
    const catatan = kueriJenis(klien, 'catatan');
    expect(catatan).toHaveLength(1);
    expect(catatan[0].in).toEqual([['id', ['pn-fo']]]);
    for (const kolom of ['id', 'topik', 'catatan', 'penangan:penangan_id(nama)']) expect(norm(catatan[0].select)).toContain(kolom);
    expect(catatan[0].select).not.toContain('*');
    const survei = kueriJenis(klien, 'survei');
    expect(survei).toHaveLength(1);
    expect(survei[0].in).toEqual([['kunjungan_id', ['k-3']]]);
    // kedua tiket eskalasi berbagi satu tahap asal, jadi catatannya tampil di keduanya
    expect(await screen.findAllByText('Topik: Pertanyaan BPJS')).toHaveLength(2);
  });

  it.each(['admin', 'front_office'] as const)('%s lewat RPC fo_antrean_daftar: halaman 25 lalu sisanya per 200; tanpa kueri tiket_antrean; muat ulang mengulang RPC yang sama', async (role) => {
    nav.query = '';
    const semua = Array.from({ length: 60 }, (_, i) => {
      const { legacy_visit_id: _l, ...dasar } = baris({
        id: `t-${i + 1}`, nomor: i + 1, nomor_display: `A-${String(i + 1).padStart(3, '0')}`, fo_nama: 'Rina FO',
        kunjungan: { nama: `Tamu ${i + 1}`, asal: 'walk_in', waktu_masuk: sekarangIso() },
      });
      void _l;
      return dasar;
    });
    const klien = buatKlien({
      role,
      rpc: {
        fo_antrean_daftar: (a) => ({
          data: {
            rows: semua.slice(Number(a.p_lewati), Number(a.p_lewati) + Number(a.p_batas)),
            total: semua.length,
            statistik: { totalSelesai: 3, rataWaktuMenit: 5 },
          },
          error: null,
        }),
      },
    });
    await muatHalaman('Tamu 1');
    const hariIni = todayWIB();
    const argumen = () => panggilanRpc(klien, 'fo_antrean_daftar').map(([, a]) => a);
    expect(argumen()).toEqual([
      { p_tanggal: hariIni, p_layanan_id: null, p_batas: 25, p_lewati: 0 },
      { p_tanggal: hariIni, p_layanan_id: null, p_batas: 200, p_lewati: 25 },
    ]);
    expect(himpunan(klien)).toEqual(role === 'admin' ? ['profil'] : ['koordinator', 'profil']);
    expect(screen.getByText('Total Tiket').parentElement!.parentElement).toHaveTextContent('60');
    expect(screen.getByRole('columnheader', { name: 'Front Office' })).toBeInTheDocument();

    const tanda = klien.log.length;
    await segarkan();
    expect(argumen()).toHaveLength(4);
    expect(argumen().slice(2)).toEqual(argumen().slice(0, 2));
    expect(himpunan(klien, tanda)).toEqual([]);
  });

  it('Petugas tanpa Layanan: "Belum Ditugaskan", hanya profil yang dibaca (tidak ada kueri tiket)', async () => {
    const klien = buatKlien({ role: 'petugas', layananId: null, rows: [baris()] });
    render(<AntrianPage />);
    expect(await screen.findByText('Belum Ditugaskan')).toBeInTheDocument();
    expect(himpunan(klien)).toEqual(['koordinator', 'profil']);
    expect(screen.queryByTestId('panel')).toBeNull();
    expect(screen.queryByText('Total Tiket')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Galat per bagian
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Antrean: galat per bagian muat', () => {
  const WAJIB: Jenis[] = ['utama', 'panel', 'stats', 'total'];

  it.each(WAJIB)('muat awal: galat kueri %s menggagalkan seluruh muat; "Coba lagi" memulihkan', async (jenis) => {
    nav.query = '';
    const galat = new Set<Jenis>([jenis]);
    buatKlien({ rows: [baris()], galat });
    render(<AntrianPage />);
    expect(await screen.findByText(/Antrean tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Budi')).toBeNull();
    expect(screen.queryByText('Tidak ada antrean aktif')).toBeNull();
    expect(screen.queryByText('Belum Ada Antrean')).toBeNull();
    expect(screen.queryByText('Total Tiket')).toBeNull();
    expect(screen.queryByTestId('panel')).toBeNull();

    galat.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Budi')).toBeInTheDocument();
    expect(screen.queryByText(/Antrean tidak dapat dimuat/)).toBeNull();
    expect(screen.getByText('Total Tiket')).toBeInTheDocument();
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it.each(WAJIB)('muat ulang senyap: galat kueri %s -> data lama tetap, catatan pembaruan gagal, tanpa toast; pulih di muat berikutnya', async (jenis) => {
    nav.query = '';
    const galat = new Set<Jenis>();
    const klien = buatKlien({ rows: [baris()], galat });
    await muatHalaman();
    galat.add(jenis);
    const tanda = klien.log.length;
    await segarkan();
    expect(klien.log.length).toBeGreaterThan(tanda);
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText(/Pembaruan terakhir gagal/)).toBeInTheDocument();
    expect(screen.queryByText(/Antrean tidak dapat dimuat/)).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();

    galat.clear();
    await segarkan();
    expect(screen.queryByText(/Pembaruan terakhir gagal/)).toBeNull();
    expect(screen.getByText('Budi')).toBeInTheDocument();
  });

  it('catatan eskalasi gagal dibaca: diam-diam kosong (daftar, label eskalasi, dan statistik tetap; tanpa galat)', async () => {
    buatKlien({
      rows: [
        eskalasi(),
        selesai({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan_id: 'k-2', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
      ],
      penanganan: [{ id: 'pn-fo', topik: 'Pertanyaan BPJS', catatan: 'Menanyakan klaim', penangan: { nama: 'Siti FO' } }],
      galat: new Set<Jenis>(['catatan']),
    });
    await muatHalaman();
    expect(screen.getByText(/Eskalasi dari Front Office/)).toBeInTheDocument();
    expect(screen.queryByText('Topik: Pertanyaan BPJS')).toBeNull();
    expect(screen.queryByText(/tidak dapat dimuat/)).toBeNull();
    expect(screen.queryByText(/Pembaruan terakhir gagal/)).toBeNull();
    expect(screen.getByText('Total Tiket')).toBeInTheDocument();
  });

  it('status survei gagal dibaca: diam-diam kosong (daftar tetap, tanpa lencana Pesan Perilaku dan tanpa galat)', async () => {
    buatKlien({
      rows: [selesai({ kunjungan_id: 'k-9' })],
      survei: [{ kunjungan_id: 'k-9', status: 'belum_diisi' }],
      galat: new Set<Jenis>(['survei']),
    });
    await muatHalaman();
    expect(screen.queryByText('Pesan Perilaku')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tampilkan QR Pesan Perilaku/ })).toBeNull();
    expect(screen.queryByText(/tidak dapat dimuat/)).toBeNull();
    expect(screen.queryByText(/Pembaruan terakhir gagal/)).toBeNull();
  });

  it('batas 10.000 tiket pada panel (kueri lama): pesan batas, bukan "periksa koneksi", tanpa daftar parsial', async () => {
    nav.query = '';
    buatKlien({ rows: [baris()], timpa: (jenis) => (jenis === 'panel' ? { data: [baris()], count: 10_001 } : undefined) });
    render(<AntrianPage />);
    expect(await screen.findByText(/melebihi batas pemuatan 10\.000 tiket/)).toBeInTheDocument();
    expect(screen.queryByText(/Periksa koneksi/)).toBeNull();
    expect(screen.queryByText('Budi')).toBeNull();
    expect(screen.queryByTestId('panel')).toBeNull();
  });

  it('halaman panel kosong padahal hitungan masih ada (data berubah saat dimuat): galat umum, bukan daftar kosong', async () => {
    nav.query = '';
    buatKlien({ rows: [baris()], timpa: (jenis) => (jenis === 'panel' ? { data: [], count: 3 } : undefined) });
    render(<AntrianPage />);
    expect(await screen.findByText(/Antrean tidak dapat dimuat/)).toBeInTheDocument();
    expect(screen.queryByText('Belum Ada Antrean')).toBeNull();
  });

  it('panel membaca bertahap per 200 (0-199, 200-399); tiket saya di bagian akhir tetap sampai ke panel', async () => {
    nav.query = '';
    const rows = [
      ...Array.from({ length: 250 }, (_, i) => baris({
        id: `t-${i + 1}`, nomor: i + 1, nomor_display: `A-${String(i + 1).padStart(3, '0')}`,
        kunjungan: { nama: `Tamu ${i + 1}`, asal: 'walk_in', waktu_masuk: null },
      })),
      dilayaniSaya({ id: 't-251', nomor: 251, nomor_display: 'A-251', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
    ];
    const klien = buatKlien({ rows });
    render(<AntrianPage />);
    await screen.findByTestId('panel');
    expect(kueriJenis(klien, 'panel').map((k) => k.range)).toEqual([[0, 199], [200, 399]]);
    expect(JSON.parse(screen.getByTestId('panel').getAttribute('data-dilayani')!).id).toBe('t-251');
  });

  it('respons lama tidak menimpa respons yang lebih baru (nomor permintaan), apa pun urutan kueri di dalamnya', async () => {
    nav.query = '';
    const gerbang: Record<number, () => void> = {};
    const tahanan = (nomor: number) => new Promise<void>((r) => { gerbang[nomor] = r; });
    const tamu = (nama: string) => [baris({ kunjungan: { nama, asal: 'walk_in', waktu_masuk: null } })];
    const tertahan = new Map<number, Promise<void>>();
    const klien = buatKlien({
      rows: tamu('Awal'),
      tahan: (jenis, nomor) => {
        if (jenis !== 'utama' || nomor < 2) return undefined;
        const p = tahanan(nomor);
        tertahan.set(nomor, p);
        return p;
      },
      timpa: (jenis, nomor) => {
        if (jenis !== 'utama') return undefined;
        if (nomor === 2) return { data: tamu('Basi'), count: 1 };
        if (nomor === 3) return { data: tamu('Terbaru'), count: 1 };
        return undefined;
      },
    });
    await muatHalaman('Awal');

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = realtime.refetch!(); });
    act(() => { b = realtime.refetch!(); });
    await waitFor(() => expect(kueriJenis(klien, 'utama')).toHaveLength(3));
    gerbang[3]();
    await act(async () => { await b; });
    gerbang[2]();
    await act(async () => { await a; });
    expect(screen.getByText('Terbaru')).toBeInTheDocument();
    expect(screen.queryByText('Basi')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. Aksi panggil / mulai / selesaikan
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Antrean: aksi panggil, mulai, selesaikan', () => {
  it('Panggil sukses: panggil_tiket dengan id tiket, toast, TANPA muat ulang', async () => {
    const klien = buatKlien({ rows: [baris()] });
    await muatHalaman();
    const tanda = klien.log.length;
    klik('Panggil');
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Memanggil A-001…', 'success'));
    expect(panggilanRpc(klien, 'panggil_tiket')).toEqual([['panggil_tiket', { p_tiket_id: 't-1' }]]);
    await pastikanTanpaKueri(klien, tanda);
  });

  it('Panggil ditolak karena tiket tidak lagi menunggu (RPC kosong): toast galat lalu muat ulang', async () => {
    const klien = buatKlien({ rows: [baris()], rpc: { panggil_tiket: { data: [], error: null } } });
    await muatHalaman();
    const tanda = klien.log.length;
    klik('Panggil');
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('A-001 tidak dipanggil'), 'error'));
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('Panggil dari panel memakai penangan yang sama (id tiket berikutnya)', async () => {
    const klien = buatKlien({ rows: [baris({ id: 't-9', nomor_display: 'A-009' })] });
    await muatHalaman();
    klik('panel: panggil');
    await waitFor(() => expect(panggilanRpc(klien, 'panggil_tiket')).toEqual([['panggil_tiket', { p_tiket_id: 't-9' }]]));
  });

  it('Mulai Layanan (layanan berformulir): layanan_mulai, toast, muat ulang, lalu wizard terbuka untuk tiket itu', async () => {
    const klien = buatKlien({ role: 'admin', rows: [baris()] });
    await muatHalaman();
    expect(terbuka('modal-wizard')).toBe(false);
    const tanda = klien.log.length;
    klik('Mulai Layanan');
    await waitFor(() => expect(terbuka('modal-wizard')).toBe(true));
    expect(screen.getByTestId('modal-wizard').getAttribute('data-tiket-id')).toBe('t-1');
    expect(panggilanRpc(klien, 'layanan_mulai')).toEqual([['layanan_mulai', { p_tiket_id: 't-1' }]]);
    expect(toastMock).toHaveBeenCalledWith('Layanan dimulai', 'success');
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('Mulai Layanan tanpa formulir: toast info, muat ulang, wizard tetap tertutup', async () => {
    const klien = buatKlien({ role: 'admin', rows: [baris({ layanan: BPJS })] });
    await muatHalaman();
    const tanda = klien.log.length;
    klik('Mulai Layanan');
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Layanan ini tidak memiliki form pendataan', 'info'));
    expect(terbuka('modal-wizard')).toBe(false);
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('Mulai dari panel memakai penangan yang sama (layanan_mulai untuk tiket berikutnya)', async () => {
    const klien = buatKlien({ role: 'admin', rows: [baris({ id: 't-9' })] });
    await muatHalaman();
    klik('panel: mulai');
    await waitFor(() => expect(panggilanRpc(klien, 'layanan_mulai')).toEqual([['layanan_mulai', { p_tiket_id: 't-9' }]]));
    await waitFor(() => expect(terbuka('modal-wizard')).toBe(true));
  });

  it('galat Mulai yang membuat tampilan basi (SUDAH_DIAMBIL) memuat ulang; galat biasa hanya toast tanpa muat ulang', async () => {
    const klien = buatKlien({
      role: 'admin', rows: [baris()],
      rpc: { layanan_mulai: { data: null, error: { message: 'SUDAH_DIAMBIL: x', code: 'P0001' } } },
    });
    await muatHalaman();
    let tanda = klien.log.length;
    klik('Mulai Layanan');
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Tiket ini sudah ditangani petugas lain.', 'error'));
    await tungguHimpunan(klien, tanda, MUAT);
    expect(terbuka('modal-wizard')).toBe(false);

    cleanup();
    toastMock.mockClear();
    const klien2 = buatKlien({
      role: 'admin', rows: [baris()],
      rpc: { layanan_mulai: { data: null, error: { message: 'boom', code: 'XX000' } } },
    });
    await muatHalaman();
    tanda = klien2.log.length;
    klik('Mulai Layanan');
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Gagal memulai layanan.'), 'error'));
    await pastikanTanpaKueri(klien2, tanda);
  });

  it('Selesai (pemilik, tanpa pendataan, bukan eskalasi): layanan_selesai, toast, QR untuk kunjungan tiket itu, lalu muat ulang', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ layanan: BPJS, kunjungan_id: 'k-9' })] });
    await muatHalaman();
    const tanda = klien.log.length;
    klik(/^selesai$/i);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Kunjungan berhasil diselesaikan', 'success'));
    expect(panggilanRpc(klien, 'layanan_selesai')).toEqual([['layanan_selesai', { p_tiket_id: 't-1' }]]);
    expect(screen.getByTestId('modal-qr').getAttribute('data-kunjungan')).toBe('k-9');
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('Selesai dari panel menyelesaikan tiket saya lewat penangan yang sama', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ id: 't-0', layanan: BPJS })] });
    await muatHalaman();
    klik('panel: selesai');
    await waitFor(() => expect(panggilanRpc(klien, 'layanan_selesai')).toEqual([['layanan_selesai', { p_tiket_id: 't-0' }]]));
  });

  it('Selesai (layanan berformulir): membuka wizard, TANPA RPC; menguncinya membuka QR, menutup wizard, dan memuat ulang', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ kunjungan_id: 'k-8' })] });
    await muatHalaman();
    const tanda = klien.log.length;
    klik(/^selesai$/i);
    expect(terbuka('modal-wizard')).toBe(true);
    expect(screen.getByTestId('modal-wizard').getAttribute('data-tiket-id')).toBe('t-1');
    expect(panggilanRpc(klien, 'layanan_selesai')).toHaveLength(0);
    expect(terbuka('modal-qr')).toBe(false);

    klik('wizard: kunci');
    await waitFor(() => expect(terbuka('modal-qr')).toBe(true));
    expect(screen.getByTestId('modal-qr').getAttribute('data-kunjungan')).toBe('k-8');
    expect(terbuka('modal-wizard')).toBe(false);
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('Selesai (tiket eskalasi tanpa pendataan): membuka dialog topik+catatan, TANPA RPC; berhasil -> QR tetap terbuka walau dialog menutup', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ penanganan_asal_id: 'pn-fo', layanan: BPJS, kunjungan_id: 'k-7' })] });
    await muatHalaman();
    const tanda = klien.log.length;
    klik(/^selesai$/i);
    expect(terbuka('modal-selesai-eskalasi')).toBe(true);
    expect(dataTiket('modal-selesai-eskalasi')).toEqual({ id: 't-1', nomor_display: 'A-001', layanan_id: 'l-1' });
    expect(panggilanRpc(klien, 'layanan_selesai')).toHaveLength(0);

    klik('selesai eskalasi: berhasil');
    await waitFor(() => expect(terbuka('modal-selesai-eskalasi')).toBe(false));
    expect(screen.getByTestId('modal-qr').getAttribute('data-kunjungan')).toBe('k-7');
    await tungguHimpunan(klien, tanda, ['catatan', ...MUAT].sort() as Jenis[]);
  });

  it('Walk-in baru berhasil memuat ulang daftar; Petugas mengunci walk-in ke Layanannya, Admin tidak', async () => {
    const klien = buatKlien({ role: 'admin', rows: [baris()] });
    await muatHalaman();
    expect(screen.getByTestId('walkin').getAttribute('data-layanan')).toBe('');
    const tanda = klien.log.length;
    fireEvent.click(screen.getByTestId('walkin'));
    await tungguHimpunan(klien, tanda, MUAT);

    cleanup();
    buatKlien({ role: 'petugas', layananId: 'l-1', rows: [baris()] });
    await muatHalaman();
    expect(screen.getByTestId('walkin').getAttribute('data-layanan')).toBe('l-1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. Tujuh modal
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Antrean: tujuh modal (terbuka dari aksi yang benar, menutup, memicu muat ulang)', () => {
  /** Kontrak umum dialog tiket: tutup = hanya menutup; berhasil = muat ulang lalu menutup; basi = muat ulang, dialog tetap. */
  async function ujiSiklus(klien: Klien, id: string, nama: string, harapanMuat: Jenis[] = MUAT) {
    expect(terbuka(id)).toBe(true);
    let tanda = klien.log.length;
    klik(`${nama}: tutup`);
    expect(terbuka(id)).toBe(false);
    await pastikanTanpaKueri(klien, tanda);
    return {
      async buka(tombol: string | RegExp) { klik(tombol); expect(terbuka(id)).toBe(true); },
      async berhasil() {
        tanda = klien.log.length;
        klik(`${nama}: berhasil`);
        await waitFor(() => expect(terbuka(id)).toBe(false));
        await tungguHimpunan(klien, tanda, harapanMuat);
      },
      async basi() {
        tanda = klien.log.length;
        klik(`${nama}: basi`);
        await tungguHimpunan(klien, tanda, harapanMuat);
        expect(terbuka(id)).toBe(true);
      },
    };
  }

  it('1. ambil alih (Admin, tiket dilayani orang lain): mode admin, tiket {id, nomor, nama pemilik}', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniLain()] });
    await muatHalaman();
    expect(terbuka('modal-ambil-alih')).toBe(false);
    klik('Ambil alih');
    expect(screen.getByTestId('modal-ambil-alih').getAttribute('data-mode')).toBe('admin');
    expect(dataTiket('modal-ambil-alih')).toEqual({ id: 't-1', nomor_display: 'A-001', pemilik_nama: 'Petugas Dua' });
    const siklus = await ujiSiklus(klien, 'modal-ambil-alih', 'ambil alih');
    await siklus.buka('Ambil alih');
    await siklus.basi();
    await siklus.berhasil();
  });

  it('1b. ambil alih oleh Koordinator Petugas Layanan: mode koordinator_tiket, hanya tiket rekan di Layanannya', async () => {
    buatKlien({ role: 'petugas', layananId: 'l-1', koordinator: true, rows: [dilayaniLain()] });
    await muatHalaman();
    klik('Ambil alih');
    expect(screen.getByTestId('modal-ambil-alih').getAttribute('data-mode')).toBe('koordinator_tiket');
    expect(dataTiket('modal-ambil-alih').id).toBe('t-1');
  });

  it('1c. petugas biasa tidak melihat Ambil alih', async () => {
    buatKlien({ role: 'petugas', layananId: 'l-1', koordinator: false, rows: [dilayaniLain()] });
    await muatHalaman();
    expect(screen.queryByRole('button', { name: 'Ambil alih' })).toBeNull();
  });

  it('2. alihkan (Admin, tiket eskalasi menunggu/dilayani): tiket {id, nomor, layanan_id, nama layanan}', async () => {
    const klien = buatKlien({ role: 'admin', rows: [eskalasi()] });
    await muatHalaman();
    expect(terbuka('modal-alihkan')).toBe(false);
    klik('Alihkan tiket A-001 ke layanan lain');
    expect(dataTiket('modal-alihkan')).toEqual({ id: 't-1', nomor_display: 'A-001', layanan_id: 'l-1', layanan_nama: 'Helpdesk OSS' });
    const siklus = await ujiSiklus(klien, 'modal-alihkan', 'alihkan', ['catatan', ...MUAT].sort() as Jenis[]);
    await siklus.buka('Alihkan tiket A-001 ke layanan lain');
    await siklus.basi();
    await siklus.berhasil();
  });

  it('3. kembalikan ke FO (pemilik tiket eskalasi yang sedang dilayani): tiket {id, nomor, layanan_id}', async () => {
    const klien = buatKlien({ role: 'petugas', layananId: 'l-1', rows: [dilayaniSaya({ penanganan_asal_id: 'pn-fo' })] });
    await muatHalaman();
    expect(terbuka('modal-kembalikan')).toBe(false);
    klik('Kembalikan tiket A-001 ke Front Office');
    expect(dataTiket('modal-kembalikan')).toEqual({ id: 't-1', nomor_display: 'A-001', layanan_id: 'l-1' });
    const siklus = await ujiSiklus(klien, 'modal-kembalikan', 'kembalikan', ['catatan', ...MUAT].sort() as Jenis[]);
    await siklus.buka('Kembalikan tiket A-001 ke Front Office');
    await siklus.basi();
    await siklus.berhasil();
  });

  it('4. selesai eskalasi: dibuka tombol Selesai pemilik tiket eskalasi tanpa pendataan; dialog tutup/basi/berhasil', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ penanganan_asal_id: 'pn-fo', layanan: BPJS })] });
    await muatHalaman();
    expect(terbuka('modal-selesai-eskalasi')).toBe(false);
    klik(/^selesai$/i);
    const siklus = await ujiSiklus(klien, 'modal-selesai-eskalasi', 'selesai eskalasi', ['catatan', ...MUAT].sort() as Jenis[]);
    await siklus.buka(/^selesai$/i);
    await siklus.basi();
    await siklus.berhasil();
  });

  it('5. koreksi (Admin/FO, tiket selesai berformulir): terbuka untuk tiket itu; tutup tanpa muat ulang; berhasil memuat ulang lalu menutup', async () => {
    for (const role of ['admin', 'front_office'] as const) {
      cleanup();
      const klien = buatKlien({ role, rows: [selesai()] });
      await muatHalaman();
      expect(terbuka('modal-koreksi')).toBe(false);
      klik('Koreksi Data');
      expect(terbuka('modal-koreksi')).toBe(true);
      expect(screen.getByTestId('modal-koreksi').getAttribute('data-tiket-id')).toBe('t-1');
      let tanda = klien.log.length;
      klik('koreksi: tutup');
      expect(terbuka('modal-koreksi')).toBe(false);
      await pastikanTanpaKueri(klien, tanda);

      klik('Koreksi Data');
      tanda = klien.log.length;
      klik('koreksi: berhasil');
      expect(terbuka('modal-koreksi')).toBe(false);
      await tungguHimpunan(klien, tanda, ['panel', 'stats', 'survei', 'total', 'utama']);
    }
  });

  it('5b. petugas tidak mendapat tombol Koreksi Data (hanya catatan terkunci)', async () => {
    buatKlien({ role: 'petugas', layananId: 'l-1', rows: [selesai()] });
    await muatHalaman();
    expect(screen.queryByRole('button', { name: 'Koreksi Data' })).toBeNull();
    expect(screen.getByText(/Data sudah dikunci/)).toBeInTheDocument();
  });

  it.each([
    ['Form Pendataan (pemilik, dilayani)', () => [dilayaniSaya()], 'Form Pendataan'],
    ['Lihat Data (dilayani petugas lain, baca-saja)', () => [dilayaniLain()], 'Lihat Data'],
    ['Lihat Data (tiket selesai)', () => [selesai()], 'Lihat Data'],
  ] as Array<[string, () => Baris[], string]>)('6. wizard pelayanan dibuka dari tombol %s untuk tiket itu', async (_nama, rows, tombol) => {
    const klien = buatKlien({ role: 'admin', rows: rows() });
    await muatHalaman();
    expect(terbuka('modal-wizard')).toBe(false);
    klik(tombol);
    expect(terbuka('modal-wizard')).toBe(true);
    expect(screen.getByTestId('modal-wizard').getAttribute('data-tiket-id')).toBe('t-1');
    // tutup biasa: hanya menutup, tanpa QR dan tanpa muat ulang
    const tanda = klien.log.length;
    klik('wizard: tutup');
    expect(terbuka('modal-wizard')).toBe(false);
    expect(terbuka('modal-qr')).toBe(false);
    await pastikanTanpaKueri(klien, tanda);
  });

  it('6b. wizard: "data basi" memuat ulang tanpa menutup; "kunci" membuka QR tiket itu, menutup wizard, memuat ulang', async () => {
    const klien = buatKlien({ role: 'admin', rows: [dilayaniSaya({ kunjungan_id: 'k-5' })] });
    await muatHalaman();
    klik('Form Pendataan');
    let tanda = klien.log.length;
    klik('wizard: data basi');
    await tungguHimpunan(klien, tanda, MUAT);
    expect(terbuka('modal-wizard')).toBe(true);

    tanda = klien.log.length;
    klik('wizard: kunci');
    await waitFor(() => expect(terbuka('modal-qr')).toBe(true));
    expect(screen.getByTestId('modal-qr').getAttribute('data-kunjungan')).toBe('k-5');
    expect(terbuka('modal-wizard')).toBe(false);
    await tungguHimpunan(klien, tanda, MUAT);
  });

  it('7. QR Pesan Perilaku: tombol hanya untuk tiket selesai ber-status belum_diisi; tutup menutup dialog', async () => {
    buatKlien({
      role: 'admin',
      rows: [
        selesai({ id: 't-1', nomor: 1, nomor_display: 'A-001', kunjungan_id: 'k-1' }),
        selesai({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan_id: 'k-2', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
        selesai({ id: 't-3', nomor: 3, nomor_display: 'A-003', kunjungan_id: 'k-3', kunjungan: { nama: 'Eko', asal: 'walk_in', waktu_masuk: null } }),
      ],
      survei: [
        { kunjungan_id: 'k-1', status: 'belum_diisi' },
        { kunjungan_id: 'k-2', status: 'sudah_diisi' },
      ],
    });
    await muatHalaman();
    expect(terbuka('modal-qr')).toBe(false);
    expect(screen.getAllByRole('button', { name: /Tampilkan QR Pesan Perilaku/ })).toHaveLength(1);
    klik('Tampilkan QR Pesan Perilaku tiket A-001');
    expect(screen.getByTestId('modal-qr').getAttribute('data-kunjungan')).toBe('k-1');
    klik('qr: tutup');
    expect(terbuka('modal-qr')).toBe(false);
  });

  it('hanya modal yang dipicu yang terbuka: tombol satu tiket tidak membuka modal lain', async () => {
    buatKlien({ role: 'admin', rows: [dilayaniLain({ penanganan_asal_id: 'pn-fo' })] });
    await muatHalaman();
    klik('Ambil alih');
    for (const id of ['modal-alihkan', 'modal-kembalikan', 'modal-selesai-eskalasi', 'modal-koreksi', 'modal-wizard', 'modal-qr']) {
      expect(terbuka(id)).toBe(false);
    }
    expect(terbuka('modal-ambil-alih')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. Turunan tampilan dan rekap absen
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('Antrean: turunan tampilan', () => {
  it('kepala halaman, catatan peran, dan penerima pemberitahuan mengikuti profil', async () => {
    buatKlien({ role: 'admin', rows: [baris()] });
    await muatHalaman();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Antrean Semua Layanan');
    expect(screen.queryByText(/Anda melayani antrean/)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('pemberitahuan').getAttribute('data-petugas')).toBe(SAYA));
    cleanup();

    buatKlien({ role: 'petugas', layananId: 'l-1', rows: [baris()] });
    await muatHalaman();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Antrean Helpdesk OSS');
    expect(screen.getByText(/Anda melayani antrean Helpdesk OSS/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Layanan' })).toBeNull();
    cleanup();

    buatKlien({ role: 'front_office', rows: [baris()] });
    await muatHalaman();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Antrean Semua Layanan');
    expect(screen.getByRole('columnheader', { name: 'Layanan' })).toBeInTheDocument();
  });

  it('label status, asal, pemilik, dan durasi pada baris tabel', async () => {
    const dasar = (n: number, nama: string, status: string, over: Baris = {}) =>
      baris({ id: `t-${n}`, nomor: n, nomor_display: `A-${String(n).padStart(3, '0')}`, status, kunjungan: { nama, asal: 'walk_in', waktu_masuk: null }, ...over });
    buatKlien({
      role: 'admin',
      rows: [
        dasar(1, 'Tamu menunggu', 'menunggu'),
        dasar(2, 'Tamu dilayani saya', 'dilayani', { dilayani_oleh: SAYA, waktu_mulai_layan: sekarangIso() }),
        dasar(3, 'Tamu dilayani lain', 'dilayani', { dilayani_oleh: 'p-lain', pelayan: { nama: 'Petugas Dua' }, waktu_mulai_layan: sekarangIso() }),
        dasar(4, 'Tamu selesai', 'selesai', { waktu_mulai_layan: '2026-11-04T10:00:00.000Z', waktu_selesai: '2026-11-04T10:25:00.000Z' }),
        dasar(5, 'Tamu selesai tanpa mulai', 'selesai', { waktu_mulai_layan: null, waktu_selesai: '2026-11-04T10:30:00.000Z', kunjungan: { nama: 'Tamu selesai tanpa mulai', asal: 'reservasi', waktu_masuk: '2026-11-04T10:00:00.000Z' } }),
        dasar(6, 'Tamu tidak terlayani', 'tidak_terlayani'),
        dasar(7, 'Tamu no show', 'no_show'),
        dasar(8, 'Tamu batal', 'batal'),
        dasar(9, 'Tamu dikembalikan', 'dikembalikan'),
        dasar(10, 'Tamu dialihkan', 'dialihkan'),
      ],
    });
    await muatHalaman('Tamu menunggu');
    const baru = (nama: string) => within(screen.getByText(nama).closest('tr') as HTMLElement);
    expect(baru('Tamu menunggu').getByText('Menunggu')).toBeInTheDocument();
    expect(baru('Tamu menunggu').getByText('Walk-in')).toBeInTheDocument();
    expect(baru('Tamu dilayani saya').getByText('Dilayani')).toBeInTheDocument();
    expect(baru('Tamu dilayani saya').getByText('oleh Anda')).toBeInTheDocument();
    expect(baru('Tamu dilayani lain').getByText('oleh Petugas Dua')).toBeInTheDocument();
    expect(baru('Tamu selesai').getByText('Selesai')).toBeInTheDocument();
    expect(baru('Tamu selesai').getByText('25 menit')).toBeInTheDocument();
    expect(baru('Tamu selesai tanpa mulai').getByText('30 menit')).toBeInTheDocument();
    expect(baru('Tamu selesai tanpa mulai').getByText('Reservasi')).toBeInTheDocument();
    expect(baru('Tamu tidak terlayani').getByText('Tidak terlayani (petugas tidak hadir)')).toBeInTheDocument();
    expect(baru('Tamu no show').getByText('Tidak datang (warga)')).toBeInTheDocument();
    expect(baru('Tamu batal').getByText('Batal')).toBeInTheDocument();
    expect(baru('Tamu dikembalikan').getByText('Dikembalikan ke FO')).toBeInTheDocument();
    expect(baru('Tamu dialihkan').getByText('Dialihkan')).toBeInTheDocument();
  });

  it('panel Petugas: berikutnya = nomor menunggu terkecil di Layanannya, sedang saya layani = tiket saya, tanpa pilihan Layanan', async () => {
    buatKlien({
      role: 'petugas', layananId: 'l-1',
      rows: [
        baris({ id: 't-3', nomor: 3, nomor_display: 'A-003', kunjungan: { nama: 'Cici', asal: 'walk_in', waktu_masuk: '2026-11-04T01:00:00.000Z' } }),
        baris({ id: 't-2', nomor: 2, nomor_display: 'A-002', kunjungan: { nama: 'Dewi', asal: 'walk_in', waktu_masuk: '2026-11-04T02:00:00.000Z' } }),
        dilayaniSaya({ id: 't-0', nomor: 0, nomor_display: 'A-000', waktu_mulai_layan: '2026-11-04T03:00:00.000Z', kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
      ],
    });
    render(<AntrianPage />);
    const panel = await screen.findByTestId('panel');
    expect(panel.getAttribute('data-opsi')).toBe('');
    expect(panel.getAttribute('data-tanpa-saya')).toBe('false');
    expect(JSON.parse(panel.getAttribute('data-berikutnya')!)).toEqual({
      id: 't-2', nomor_display: 'A-002', layananNama: 'Helpdesk OSS', namaPengunjung: 'Dewi',
      waktu: '2026-11-04T02:00:00.000Z', bolehMulai: true, bolehSelesai: false,
    });
    expect(JSON.parse(panel.getAttribute('data-dilayani')!)).toEqual({
      id: 't-0', nomor_display: 'A-000', layananNama: 'Helpdesk OSS', namaPengunjung: 'Sari',
      waktu: '2026-11-04T03:00:00.000Z', bolehMulai: false, bolehSelesai: true,
    });
  });

  it('panel Admin: pilihan Layanan urut nama (hanya yang punya tiket menunggu); pilihan bertahan setelah muat ulang', async () => {
    buatKlien({
      role: 'admin',
      rows: [
        baris({ id: 't-1', nomor: 1, nomor_display: 'A-001', layanan_id: 'l-1', layanan: OSS }),
        baris({ id: 't-5', nomor: 5, nomor_display: 'B-005', layanan_id: 'l-2', layanan: BPJS, kunjungan: { nama: 'Eko', asal: 'walk_in', waktu_masuk: null } }),
        dilayaniSaya({ id: 't-7', nomor: 7, nomor_display: 'C-007', layanan_id: 'l-3', layanan: { nama: 'Perizinan', form_pendataan: 'perizinan' }, kunjungan: { nama: 'Sari', asal: 'walk_in', waktu_masuk: null } }),
      ],
    });
    render(<AntrianPage />);
    const panel = () => screen.getByTestId('panel');
    await screen.findByTestId('panel');
    expect(panel().getAttribute('data-opsi')).toBe('l-2:BPJS Kesehatan|l-1:Helpdesk OSS');
    expect(panel().getAttribute('data-layanan')).toBe('l-2');
    expect(JSON.parse(panel().getAttribute('data-berikutnya')!).id).toBe('t-5');
    expect(JSON.parse(panel().getAttribute('data-dilayani')!).id).toBe('t-7');

    fireEvent.change(screen.getByLabelText('panel: pilih layanan'), { target: { value: 'l-1' } });
    expect(panel().getAttribute('data-layanan')).toBe('l-1');
    expect(JSON.parse(panel().getAttribute('data-berikutnya')!).id).toBe('t-1');
    await segarkan();
    expect(panel().getAttribute('data-layanan')).toBe('l-1');
  });

  it('panel Front Office: ditandai tanpa blok "saya"; panel disembunyikan di tab Selesai dan di tanggal lain', async () => {
    buatKlien({ role: 'front_office', rows: [baris()] });
    render(<AntrianPage />);
    expect((await screen.findByTestId('panel')).getAttribute('data-tanpa-saya')).toBe('true');
    cleanup();

    nav.query = 'status=selesai';
    buatKlien({ role: 'admin', rows: [selesai()] });
    await muatHalaman();
    expect(screen.queryByTestId('panel')).toBeNull();
    cleanup();

    nav.query = 'status=semua&tanggal=2026-01-02';
    buatKlien({ role: 'admin', rows: [baris()] });
    await muatHalaman();
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});

describe('Antrean: rekapitulasi absen', () => {
  const absensi = [
    { id: 'a-1', petugas_id: 'p-1', tanggal: '2026-11-04', jam_masuk: '2026-11-04T01:00:00.000Z', jam_pulang: null, status: 'approved', petugas: { nama: 'Rina' } },
    { id: 'a-2', petugas_id: 'p-2', tanggal: '2026-11-04', jam_masuk: '2026-11-04T01:30:00.000Z', jam_pulang: '2026-11-04T09:00:00.000Z', status: 'pending', petugas: [{ nama: 'Dewi' }] },
    { id: 'a-3', petugas_id: 'p-3', tanggal: '2026-11-04', jam_masuk: null, jam_pulang: null, status: 'ditolak', petugas: { nama: 'Eko' } },
    { id: 'a-4', petugas_id: 'p-4', tanggal: '2026-11-04', jam_masuk: null, jam_pulang: null, status: 'alpa', petugas: null },
  ];
  const tombolRekap = () => screen.getByRole('button', { name: /Rekapitulasi Absen/ });

  it('dibaca hanya saat dibuka (tiap kali dibuka): kolom eksplisit, tanggal, urut jam masuk; baris dinormalkan dan diberi lencana status', async () => {
    const klien = buatKlien({ role: 'admin', rows: [baris()], absensi });
    await muatHalaman();
    expect(kueriJenis(klien, 'absensi')).toHaveLength(0);
    expect(tombolRekap()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(tombolRekap());
    expect(tombolRekap()).toHaveAttribute('aria-expanded', 'true');
    const ruang = within(await screen.findByRole('table', { name: 'Rekapitulasi absen petugas' }));
    const k = kueriJenis(klien, 'absensi');
    expect(k).toHaveLength(1);
    expect(k[0].select).not.toContain('*');
    for (const kolom of ['id', 'petugas_id', 'tanggal', 'jam_masuk', 'jam_pulang', 'status', 'petugas:petugas_id(nama)']) {
      expect(norm(k[0].select)).toContain(kolom);
    }
    expect(k[0].eq).toEqual([['tanggal', todayWIB()]]);
    expect(k[0].order).toEqual([['jam_masuk', { ascending: true }]]);
    expect(ruang.getByText('Rina')).toBeInTheDocument();
    expect(ruang.getByText('Dewi')).toBeInTheDocument();
    expect(ruang.getByText('Disetujui')).toBeInTheDocument();
    expect(ruang.getByText('Menunggu')).toBeInTheDocument();
    expect(ruang.getByText('Ditolak')).toBeInTheDocument();
    expect(ruang.getByText('Alpa')).toBeInTheDocument();
    expect(screen.getByText('4 petugas')).toBeInTheDocument();

    fireEvent.click(tombolRekap());
    expect(tombolRekap()).toHaveAttribute('aria-expanded', 'false');
    expect(kueriJenis(klien, 'absensi')).toHaveLength(1);
    fireEvent.click(tombolRekap());
    await waitFor(() => expect(kueriJenis(klien, 'absensi')).toHaveLength(2));
  });

  it('Petugas: baris dibatasi ke Layanannya (petugas.layanan_id)', async () => {
    const klien = buatKlien({ role: 'petugas', layananId: 'l-1', rows: [baris()], absensi });
    await muatHalaman();
    fireEvent.click(tombolRekap());
    await screen.findByRole('table', { name: 'Rekapitulasi absen petugas' });
    expect(kueriJenis(klien, 'absensi')[0].eq).toEqual([['tanggal', todayWIB()], ['petugas.layanan_id', 'l-1']]);
  });

  it('galat membaca absensi diam-diam kosong ("Belum ada catatan"), tanpa toast dan tanpa galat halaman', async () => {
    buatKlien({ role: 'admin', rows: [baris()], absensi, galat: new Set<Jenis>(['absensi']) });
    await muatHalaman();
    fireEvent.click(tombolRekap());
    expect(await screen.findByText('Belum ada catatan absensi untuk tanggal ini.')).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/tidak dapat dimuat/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unduh CSV' })).toBeDisabled();
  });

  it('Unduh CSV: berkas daftar_hadir_<layanan>_<tanggal>.csv berisi BOM, judul kolom, dan status berbahasa Indonesia', async () => {
    const blobs: Blob[] = [];
    const unduhan: string[] = [];
    const urlAsli = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, writable: true,
      value: (b: Blob) => { blobs.push(b); return 'blob:tiruan'; },
    });
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      unduhan.push(this.download);
    });
    try {
      buatKlien({ role: 'petugas', layananId: 'l-1', rows: [baris()], absensi });
      await muatHalaman();
      fireEvent.click(tombolRekap());
      await screen.findByRole('table', { name: 'Rekapitulasi absen petugas' });
      fireEvent.click(screen.getByRole('button', { name: 'Unduh CSV' }));
      expect(unduhan).toEqual([`daftar_hadir_Helpdesk_OSS_${todayWIB()}.csv`]);
      const byte = await new Promise<Uint8Array>((selesaiBaca) => {
        const pembaca = new FileReader();
        pembaca.onload = () => selesaiBaca(new Uint8Array(pembaca.result as ArrayBuffer));
        pembaca.readAsArrayBuffer(blobs[0]);
      });
      expect(Array.from(byte.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
      const teks = new TextDecoder().decode(byte);
      for (const potong of ['Nama Petugas', 'Rina', 'Dewi', 'Disetujui', 'Menunggu', 'Ditolak', 'Alpa']) expect(teks).toContain(potong);
    } finally {
      klik.mockRestore();
      if (urlAsli) Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: urlAsli });
      else delete (URL as unknown as Record<string, unknown>).createObjectURL;
    }
  });
});
