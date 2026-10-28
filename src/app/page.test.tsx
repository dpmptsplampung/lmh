// @vitest-environment jsdom
// Etalase homepage: blok berjenis tetap, kartu dari data, popup lewat /?layanan=<slug>.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LayananEtalase, StatusHariIni } from '@/lib/homepage/data';
import { DEFINISI_BLOK, gabungkanBlok, type BarisBlok } from '@/lib/homepage/blok';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  data: {
    blok: [] as unknown,
    layanan: { layanan: [] as unknown[], tingkat: 1 as 0 | 1 | 2 | 3 },
    status: null as Map<string, unknown> | null,
    antrean: null as Map<string, unknown> | null,
    blokGagal: false,
    menggantung: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, back: h.back, replace: h.replace }),
  useSearchParams: () => h.params,
  usePathname: () => '/',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/sesi-staf', () => ({ keluarDariSesi: vi.fn() }));
vi.mock('@/lib/site-settings', () => ({
  getSiteSettings: async () => ({
    wa_number: '628123456789', wa_default_message: 'Halo', contact_address: 'Jl. Contoh 1', contact_hours: '', contact_email: '',
  }),
}));
vi.mock('@/components/EstimasiAntrean', () => ({
  default: ({ judul }: { judul?: string }) => <section data-testid="estimasi">{judul}</section>,
}));
vi.mock('@/lib/homepage/data', async (impor) => {
  const asli = await impor<typeof import('@/lib/homepage/data')>();
  return {
    ...asli,
    muatBlok: async () => {
      if (h.data.menggantung) return new Promise<never>(() => {});
      if (h.data.blokGagal) throw new Error('boom');
      return h.data.blok;
    },
    muatLayanan: async () => (h.data.menggantung ? new Promise<never>(() => {}) : h.data.layanan),
    muatStatusHariIni: async () => (h.data.menggantung ? new Promise<never>(() => {}) : h.data.status),
    muatAntrean: async () => h.data.antrean,
  };
});

import LandingPage from './page';

const layanan = (id: string, nama: string, o: Partial<LayananEtalase> = {}): LayananEtalase => ({
  id,
  nama,
  slug: nama.toLowerCase().replace(/\s+/g, '-'),
  deskripsi: `Deskripsi ${nama}`,
  urutan: 1,
  instansi: 'DPMPTSP',
  instansiSingkatan: null,
  websiteTerkait: [],
  statusTampilan: 'aktif',
  punyaAntrean: true,
  punyaChat: true,
  tampilDiHomepage: true,
  ...o,
});

const baris = (jenis: string, aktif: boolean, urutan: number, teks: Record<string, unknown> = {}): BarisBlok => ({
  jenis, aktif, urutan, teks,
});

const atur = (rows: BarisBlok[] | null, daftar: LayananEtalase[] = []) => {
  h.data.blok = gabungkanBlok(rows);
  h.data.layanan = { layanan: daftar, tingkat: 1 };
};

beforeEach(() => {
  h.push.mockClear();
  h.back.mockClear();
  h.replace.mockClear();
  h.params = new URLSearchParams();
  h.data.status = null;
  h.data.antrean = null;
  h.data.blokGagal = false;
  h.data.menggantung = false;
  atur(null);
});
afterEach(cleanup);

const bawaan = DEFINISI_BLOK;

describe('Homepage etalase: blok', () => {
  it('blok bawaan tampil (hero, jalur cepat, status, layanan, ajakan, footer); papan kinerja mati', async () => {
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Lampung Maju');
    expect(screen.getByRole('heading', { name: bawaan.jalur_cepat.bawaan.title })).toBeInTheDocument();
    expect(screen.getByTestId('estimasi')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: bawaan.ajakan.bawaan.title })).toBeInTheDocument();
    expect(screen.getByText(bawaan.footer.bawaan.copyright, { exact: false })).toBeInTheDocument();
  });

  it('blok yang dimatikan tidak dirender sama sekali (tanpa teks cadangan)', async () => {
    atur([baris('hero', false, 10), baris('ajakan', false, 60), baris('jalur_cepat', false, 20)]);
    render(<LandingPage />);
    await screen.findByTestId('estimasi');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByText(bawaan.hero.bawaan.description)).toBeNull();
    expect(screen.queryByText(bawaan.ajakan.bawaan.title)).toBeNull();
    expect(screen.queryByText(bawaan.jalur_cepat.bawaan.title)).toBeNull();
  });

  it('blok status hari ini mati -> EstimasiAntrean tidak dirender', async () => {
    atur([baris('status_hari_ini', false, 30)]);
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('estimasi')).toBeNull();
  });

  it('urutan blok mengikuti konfigurasi admin', async () => {
    atur([baris('ajakan', true, 5), baris('hero', true, 50)]);
    render(<LandingPage />);
    const judulAjakan = await screen.findByRole('heading', { level: 2, name: bawaan.ajakan.bawaan.title });
    const judulHero = screen.getByRole('heading', { level: 1 });
    expect(judulAjakan.compareDocumentPosition(judulHero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('teks kustom admin dipakai', async () => {
    atur([baris('ajakan', true, 60, { title: 'Ayo Datang' })]);
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Ayo Datang' })).toBeInTheDocument();
  });

  it('papan kinerja yang dinyalakan menampilkan teksnya saja', async () => {
    atur([baris('papan_kinerja', true, 50, { title: 'Kinerja Layanan', description: 'Segera hadir.' })]);
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Kinerja Layanan' })).toBeInTheDocument();
  });

  it('papan kinerja menyala tanpa teks tidak menampilkan apa pun', async () => {
    atur([baris('papan_kinerja', true, 50)]);
    const { container } = render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('#judul-papan-kinerja')).toBeNull();
  });

  it('pemuat blok gagal total: halaman tetap tampil dengan bawaan (bukan crash)', async () => {
    h.data.blokGagal = true;
    h.data.layanan = { layanan: [], tingkat: 0 };
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/sedang disiapkan/i)).toBeInTheDocument();
  });

  it('permintaan menggantung: setelah 6 detik halaman tampil dengan bawaan (bukan "Memuat halaman…" selamanya)', async () => {
    h.data.menggantung = true;
    vi.useFakeTimers();
    try {
      render(<LandingPage />);
      expect(screen.getByRole('status')).toHaveTextContent('Memuat halaman');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5900);
      });
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      expect(screen.getByText(/sedang disiapkan/i)).toBeInTheDocument();
      expect(screen.queryByText(/Memuat halaman/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tautan Kebijakan Privasi selalu ada, juga bila blok footer dimatikan', async () => {
    atur([baris('footer', false, 70)]);
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(bawaan.footer.bawaan.copyright, { exact: false })).toBeNull();
    expect(screen.getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/kebijakan-privasi');
  });

  it('blok footer menyala: hanya satu tautan Kebijakan Privasi (tidak ganda)', async () => {
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('link', { name: 'Kebijakan Privasi' })).toHaveLength(1);
  });

  it('tautan menu "Layanan" hilang bila blok layanan mati', async () => {
    atur([baris('layanan', false, 40)]);
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: 'Layanan' })).toBeNull();
    expect(document.querySelector('section#layanan')).toBeNull();
  });
});

describe('Homepage etalase: kartu layanan', () => {
  const dua = [layanan('1', 'Helpdesk OSS'), layanan('2', 'Bank Lampung')];

  it('kartu dari data; judul memuat jumlah kartu; tidak ada layanan cadangan lama', async () => {
    atur(null, dua);
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 2, name: '2 Layanan dalam Satu Atap' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText('Balai Monitor SFR')).toBeNull();
    expect(screen.queryByText('Sertifikasi Halal')).toBeNull();
  });

  it('daftar kosong: tidak ada kartu cadangan', async () => {
    atur(null, []);
    render(<LandingPage />);
    await screen.findByText(/sedang disiapkan/i);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('layanan dengan tampil_di_homepage=false tidak dapat kartu dan tidak dihitung', async () => {
    atur(null, [...dua, layanan('3', 'Tersembunyi', { tampilDiHomepage: false })]);
    render(<LandingPage />);
    expect(await screen.findByRole('heading', { level: 2, name: '2 Layanan dalam Satu Atap' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tersembunyi/ })).toBeNull();
  });

  it('status hari ini muncul di kartu', async () => {
    atur(null, dua);
    h.data.status = new Map<string, StatusHariIni>([
      ['1', { buka: true, liburKeterangan: null, jadwal: [] }],
      ['2', { buka: false, liburKeterangan: null, jadwal: [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }] }],
    ]);
    render(<LandingPage />);
    expect(await screen.findByText('Buka sekarang')).toBeInTheDocument();
    expect(screen.getByText('Tutup saat ini · Buka setiap Kamis')).toBeInTheDocument();
  });
});

describe('Homepage etalase: popup dan alamatnya', () => {
  const daftar = [layanan('1', 'Helpdesk OSS'), layanan('2', 'Bank Lampung')];

  it('klik kartu mendorong /?layanan=<slug> tanpa gulir', async () => {
    atur(null, daftar);
    render(<LandingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Bank Lampung/ }));
    expect(h.push).toHaveBeenCalledWith('/?layanan=bank-lampung', { scroll: false });
  });

  it('deep link ?layanan=<slug> membuka dialog layanan itu', async () => {
    atur(null, daftar);
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<LandingPage />);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { level: 2, name: 'Helpdesk OSS' })).toBeInTheDocument();
  });

  it('popup layanan yang tidak punya kartu tetap terbuka lewat alamat (tautan bot tidak mati)', async () => {
    atur(null, [...daftar, layanan('3', 'Tersembunyi', { tampilDiHomepage: false })]);
    h.params = new URLSearchParams('layanan=tersembunyi');
    render(<LandingPage />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('slug tak dikenal (mis. layanan diarsipkan) tidak membuka dialog', async () => {
    atur(null, daftar);
    h.params = new URLSearchParams('layanan=tidak-ada');
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tanpa parameter tidak ada dialog', async () => {
    atur(null, daftar);
    render(<LandingPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('menutup popup yang dibuka dari kartu = kembali (history.back), bukan menambah riwayat', async () => {
    atur(null, daftar);
    const { rerender } = render(<LandingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Helpdesk OSS/ }));
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    rerender(<LandingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup' }));
    expect(h.back).toHaveBeenCalledTimes(1);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('menutup popup dari deep link = replace ke / (tanpa keluar dari situs)', async () => {
    atur(null, daftar);
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<LandingPage />);
    const dlg = await screen.findByRole('dialog');
    await act(async () => {}); // biarkan efek pemasang pendengar Esc selesai
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(h.replace).toHaveBeenCalledWith('/', { scroll: false });
    expect(h.back).not.toHaveBeenCalled();
  });

  it('popup memuat status, jadwal, dan antrean dari data', async () => {
    atur(null, daftar);
    h.data.status = new Map<string, StatusHariIni>([
      ['1', { buka: true, liburKeterangan: null, jadwal: [{ hari: 1, jamMulai: '08:00', jamSelesai: '15:30' }] }],
    ]);
    h.data.antrean = new Map([['1', { antre: 4, dilayani: 1, estimasiTungguMenit: 30 }]]);
    h.params = new URLSearchParams('layanan=helpdesk-oss');
    render(<LandingPage />);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Buka sekarang')).toBeInTheDocument();
    expect(within(dlg).getByRole('table', { name: /jadwal mingguan/i })).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByText(/4 menunggu/)).toBeInTheDocument());
  });
});
