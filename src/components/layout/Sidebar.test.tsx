// @vitest-environment jsdom
// Sidebar admin: kelompok menu (dropdown accordion), state bertahan, badge notifikasi, a11y.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { buatH, type FakeH } from '@/test/fo-supabase-mock';
import type { NavBadges } from '@/lib/hooks/useNavBadges';

const h: FakeH = vi.hoisted(() => ({ tabel: {}, rpc: () => ({ data: null, error: null }), user: null, log: [], rpcLog: [] }));
const state = vi.hoisted(() => ({ path: '/admin', badges: {} as Record<string, { count: number; label: string }> }));

vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    // preventDefault: jsdom tidak mengimplementasikan navigasi dokumen.
    <a href={href} {...rest} onClick={(e) => { onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/sesi-staf', () => ({ keluarDariSesi: vi.fn() }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(h) };
});
// Hitungan badge diuji di useNavBadges.test.tsx; di sini hanya tampilannya (hook dikendalikan test).
vi.mock('@/lib/hooks/useNavBadges', async () => {
  const asli = await vi.importActual<typeof import('@/lib/hooks/useNavBadges')>('@/lib/hooks/useNavBadges');
  return { ...asli, useNavBadges: () => state.badges };
});

import Sidebar from './Sidebar';

const KEY = 'lmh.sidebar.grup';

async function renderSidebar(role: 'admin' | 'front_office' | 'petugas', path: string) {
  state.path = path;
  h.user = { id: 'u1' };
  h.tabel.petugas = { data: [{ id: 'p1', nama: 'Budi', role, layanan_id: role === 'petugas' ? 'lay-1' : null }], error: null };
  const utils = render(<Sidebar />);
  await screen.findByRole('link', { name: 'Profil Saya' });
  return utils;
}

const lolos = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const header = (nama: RegExp | string) =>
  screen.getByRole('button', { name: typeof nama === 'string' ? new RegExp('^' + lolos(nama) + '(:|$)') : nama });
const terbuka = (nama: RegExp | string) => header(nama).getAttribute('aria-expanded') === 'true';
const navAktif = () => screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent);

function ubahPath(utils: ReturnType<typeof render>, path: string) {
  state.path = path;
  utils.rerender(<Sidebar />);
}

beforeEach(() => {
  Object.assign(h, buatH());
  state.path = '/admin';
  state.badges = {};
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sidebar: struktur per role', () => {
  it('admin: Dasbor di atas, sembilan grup berurutan, Profil dan Tampilan Publik di bawah', async () => {
    await renderSidebar('admin', '/admin');
    const nav = screen.getByRole('navigation', { name: 'Menu admin' });
    const top = Array.from(nav.children).map((el) =>
      el.tagName === 'A' ? `link:${el.textContent}` : `grup:${el.querySelector('button')?.textContent}`,
    );
    expect(top).toEqual([
      'link:Dasbor',
      'grup:Front Office', 'grup:Antrean & Kehadiran', 'grup:Layanan Online', 'grup:Pesan Perilaku', 'grup:Laporan & Evaluasi',
      'grup:Pengelolaan Layanan', 'grup:Kemitraan & Investasi', 'grup:Konten & Dokumen', 'grup:Sistem & Keamanan',
    ]);
    // Gaya Dasbor: Profil Saya dan Tampilan Publik berada di dasar panel (di bawah widget), bukan di dalam <nav>.
    const bawah = document.querySelector('[class*="bawah"]')!;
    expect(Array.from(bawah.querySelectorAll('a')).map((a) => a.textContent)).toEqual(['Profil Saya', 'Tampilan Publik']);
  });

  it('semua href lama muncul tepat sekali (admin)', async () => {
    await renderSidebar('admin', '/admin');
    // Widget sidebar punya tombol tautan sendiri (mis. "Buka dashboard"); yang dihitung hanya menu.
    const hrefs = screen
      .getAllByRole('link', { hidden: true })
      .filter((a) => !a.closest('[data-widget]'))
      .map((a) => a.getAttribute('href'));
    // 33 href lama - 3 tersembunyi (Daftar FO, Scan QR, Rekap Front Office) + 1 Registrasi Pengunjung
    // + 1 Saran (Pesan Perilaku; Hasil SKM lama menjadi Hasil Survei, alamat pengalihan tersembunyi)
    // + 1 Pengawasan UMKM dan 1 Laporan UMKM.
    expect(hrefs).toHaveLength(34);
    expect(new Set(hrefs).size).toBe(34);
    expect(hrefs).toContain('/admin/umkm-laporan');
    expect(hrefs).not.toContain('/admin/rekap-fo');
    expect(hrefs).not.toContain('/admin/scan');
    expect(hrefs).not.toContain('/admin/fo/daftar');
    expect(hrefs).toContain('/admin/fo/registrasi');
  });

  it('front_office: grup Kemitraan/Konten/Sistem tidak ada; Pengelolaan hanya 2 anak', async () => {
    await renderSidebar('front_office', '/admin');
    expect(screen.queryByRole('button', { name: /Kemitraan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Konten & Dokumen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sistem & Keamanan/ })).toBeNull();
    const list = document.getElementById('sidebar-grup-pengelolaan')!;
    expect(within(list).getAllByRole('link', { hidden: true }).map((a) => a.textContent)).toEqual(['Jadwal Layanan', 'Kelola Layanan']);
  });

  it('petugas: tanpa Dasbor dan grup Front Office; grup 1-entri jadi tautan biasa', async () => {
    await renderSidebar('petugas', '/admin/antrian');
    expect(screen.queryByRole('link', { name: 'Dasbor' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Front Office/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pengelolaan Layanan/ })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Menu admin' });
    expect(Array.from(nav.children).some((el) => el.tagName === 'A' && el.textContent === 'Jadwal Layanan')).toBe(true);
  });

  it('role belum diketahui: tidak ada menu', () => {
    h.user = null;
    render(<Sidebar />);
    expect(screen.queryAllByRole('button', { name: /Front Office/ })).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('Sidebar: dropdown accordion', () => {
  it('membuka grup halaman aktif saat pertama dimuat; anak aktif tepat satu', async () => {
    await renderSidebar('admin', '/admin/chat/faq');
    expect(terbuka('Layanan Online')).toBe(true);
    expect(terbuka('Front Office')).toBe(false);
    expect(navAktif()).toEqual(['Kelola FAQ']); // bukan induk /admin/chat sekaligus
  });

  it('halaman induk /admin/chat: hanya Live Chat aktif', async () => {
    await renderSidebar('admin', '/admin/chat');
    expect(navAktif()).toEqual(['Live Chat']);
  });

  it('Dasbor aktif hanya pada /admin (bukan semua halaman admin); semua grup tertutup', async () => {
    await renderSidebar('admin', '/admin');
    expect(navAktif()).toEqual(['Dasbor']);
    // Hanya header grup (widget sidebar punya tombol ciut sendiri yang aria-expanded true).
    expect(document.querySelectorAll('button[aria-controls^="sidebar-grup-"][aria-expanded="true"]').length).toBe(0);
    cleanup();
    await renderSidebar('admin', '/admin/rekap-fo');
    expect(navAktif()).toEqual(['Rekap']);
  });

  it('halaman lama /admin/scan dan /admin/fo/daftar menandai Registrasi Pengunjung dan membuka grup Front Office', async () => {
    for (const path of ['/admin/scan', '/admin/fo/daftar', '/admin/fo/registrasi']) {
      await renderSidebar('front_office', path);
      expect(navAktif(), path).toEqual(['Registrasi Pengunjung']);
      expect(terbuka('Front Office'), path).toBe(true);
      cleanup();
    }
  });

  it('header grup bertanda aktif walau tertutup dan anak tertutup tidak dapat difokus (hidden)', async () => {
    await renderSidebar('admin', '/admin/chat');
    fireEvent.click(header('Layanan Online'));
    expect(terbuka('Layanan Online')).toBe(false);
    const ul = document.getElementById('sidebar-grup-layananOnline')!;
    expect(ul).toHaveAttribute('hidden');
    expect(header('Layanan Online').className).toMatch(/groupHeaderActive/);
    expect(header('Front Office').className).not.toMatch(/groupHeaderActive/);
  });

  it('header: <button> dengan aria-expanded dan aria-controls ke <ul> ber-id', async () => {
    await renderSidebar('admin', '/admin');
    const b = header('Front Office');
    expect(b.tagName).toBe('BUTTON');
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveAttribute('aria-expanded', 'false');
    const ul = document.getElementById(b.getAttribute('aria-controls')!);
    expect(ul?.tagName).toBe('UL');
    fireEvent.click(b);
    expect(b).toHaveAttribute('aria-expanded', 'true');
    expect(ul).not.toHaveAttribute('hidden');
  });

  it('accordion: membuka grup lain menutup yang sebelumnya; ketuk lagi menutup', async () => {
    await renderSidebar('admin', '/admin');
    fireEvent.click(header('Front Office'));
    expect(terbuka('Front Office')).toBe(true);
    fireEvent.click(header('Laporan & Evaluasi'));
    expect(terbuka('Laporan & Evaluasi')).toBe(true);
    expect(terbuka('Front Office')).toBe(false);
    fireEvent.click(header('Laporan & Evaluasi'));
    expect(terbuka('Laporan & Evaluasi')).toBe(false);
  });

  it('pindah halaman di grup yang SAMA: state tidak berubah (terbuka tetap terbuka, tertutup manual tetap tertutup)', async () => {
    const u = await renderSidebar('admin', '/admin/chat');
    expect(terbuka('Layanan Online')).toBe(true);
    ubahPath(u, '/admin/chat/faq');
    expect(terbuka('Layanan Online')).toBe(true);

    fireEvent.click(header('Layanan Online')); // tutup manual
    expect(terbuka('Layanan Online')).toBe(false);
    ubahPath(u, '/admin/chat/ai-log');
    expect(terbuka('Layanan Online')).toBe(false); // tetap tertutup
  });

  it('pindah ke grup lain: membuka grup baru dan menutup yang lama', async () => {
    const u = await renderSidebar('admin', '/admin/chat');
    ubahPath(u, '/admin/rekap');
    expect(terbuka('Laporan & Evaluasi')).toBe(true);
    expect(terbuka('Layanan Online')).toBe(false);
  });

  it('pindah ke tautan tunggal: grup yang terbuka dibiarkan; kembali ke grup yang sama membukanya bila tertutup', async () => {
    const u = await renderSidebar('admin', '/admin/chat');
    ubahPath(u, '/admin/profil');
    expect(terbuka('Layanan Online')).toBe(true);
    fireEvent.click(header('Layanan Online'));
    ubahPath(u, '/admin/chat');
    expect(terbuka('Layanan Online')).toBe(true); // masuk lagi ke grup dari luar grup -> terbuka
  });

  it('state tidak ter-remount: Sidebar yang sama bertahan antar-render navigasi', async () => {
    const u = await renderSidebar('admin', '/admin/chat');
    const nav = screen.getByRole('navigation', { name: 'Menu admin' });
    ubahPath(u, '/admin/pengaduan');
    expect(screen.getByRole('navigation', { name: 'Menu admin' })).toBe(nav);
  });
});

describe('Sidebar: sessionStorage', () => {
  it('menyimpan state dan memulihkannya saat muat ulang di halaman dengan grup yang sama', async () => {
    const u = await renderSidebar('admin', '/admin/chat');
    fireEvent.click(header('Layanan Online')); // tutup manual
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual({ open: null, pathGroup: 'layananOnline' });
    u.unmount();
    await renderSidebar('admin', '/admin/chat'); // "muat ulang"
    expect(terbuka('Layanan Online')).toBe(false);
  });

  it('memulihkan grup lain yang dibuka pengguna bila grup halaman aktif sama', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ open: 'laporan', pathGroup: 'layananOnline' }));
    await renderSidebar('admin', '/admin/chat');
    expect(terbuka('Laporan & Evaluasi')).toBe(true);
    expect(terbuka('Layanan Online')).toBe(false);
  });

  it('abaikan state tersimpan bila grup halaman aktif berbeda (buka grup halaman aktif)', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ open: 'laporan', pathGroup: 'frontOffice' }));
    await renderSidebar('admin', '/admin/chat');
    expect(terbuka('Layanan Online')).toBe(true);
    expect(terbuka('Laporan & Evaluasi')).toBe(false);
  });

  it('data rusak di storage diabaikan', async () => {
    window.sessionStorage.setItem(KEY, '{bukan json');
    await renderSidebar('admin', '/admin/chat');
    expect(terbuka('Layanan Online')).toBe(true);
  });

  it('storage tidak tersedia (baca/tulis melempar): tidak crash, dropdown tetap berfungsi', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await renderSidebar('admin', '/admin/chat');
    expect(terbuka('Layanan Online')).toBe(true);
    fireEvent.click(header('Front Office'));
    expect(terbuka('Front Office')).toBe(true);
    expect(terbuka('Layanan Online')).toBe(false);
  });
});

describe('Sidebar: badge notifikasi', () => {
  const badges = (o: NavBadges) => { state.badges = o; };

  it('badge pada anak (grup terbuka) dengan teks untuk pembaca layar; angka aria-hidden', async () => {
    badges({ liveChat: { count: 3, label: '3 chat menunggu diambil' } });
    await renderSidebar('admin', '/admin/chat');
    const link = screen.getByRole('link', { name: /Live Chat/ });
    expect(link).toHaveAccessibleName('Live Chat: 3 chat menunggu diambil');
    const angka = within(link).getByText('3');
    expect(angka).toHaveAttribute('aria-hidden', 'true');
    // Header grup terbuka tidak menampilkan jumlah (badge ada di anak).
    expect(within(header('Layanan Online')).queryByText('3')).toBeNull();
  });

  it('grup tertutup menampilkan jumlah total anak, dengan label gabungan', async () => {
    badges({
      liveChat: { count: 3, label: '3 chat menunggu diambil' },
      pengaduan: { count: 2, label: '2 pengaduan baru belum ditangani' },
      antrian: { count: 4, label: '4 tiket menunggu hari ini' },
    });
    await renderSidebar('admin', '/admin');
    expect(header(/^Layanan Online/)).toHaveAccessibleName('Layanan Online: 3 chat menunggu diambil');
    expect(within(header('Layanan Online')).getByText('3')).toBeInTheDocument();
    expect(header(/^Pesan Perilaku/)).toHaveAccessibleName('Pesan Perilaku: 2 pengaduan baru belum ditangani');
    expect(within(header('Pesan Perilaku')).getByText('2')).toBeInTheDocument();
    expect(within(header('Antrean & Kehadiran')).getByText('4')).toBeInTheDocument();
    // Saat dibuka, jumlah pindah ke anak.
    fireEvent.click(header('Layanan Online'));
    expect(within(header('Layanan Online')).queryByText('3')).toBeNull();
    expect(within(screen.getByRole('link', { name: /Live Chat/ })).getByText('3')).toBeInTheDocument();
    fireEvent.click(header('Pesan Perilaku'));
    expect(within(screen.getByRole('link', { name: /Pengaduan/ })).getByText('2')).toBeInTheDocument();
  });

  it('menu Saran menampilkan lencana saran belum ditinjau', async () => {
    badges({ saran: { count: 4, label: '4 saran belum ditinjau' } });
    await renderSidebar('front_office', '/admin/saran');
    const link = screen.getByRole('link', { name: /Saran/ });
    expect(link).toHaveAccessibleName('Saran: 4 saran belum ditinjau');
    expect(within(link).getByText('4')).toHaveAttribute('aria-hidden', 'true');
  });

  it("menampilkan '99+' bila lebih dari 99; tepat 99 tetap angka", async () => {
    badges({ liveChat: { count: 150, label: '150 chat menunggu diambil' }, antrian: { count: 99, label: '99 tiket menunggu hari ini' } });
    await renderSidebar('admin', '/admin');
    expect(within(header('Layanan Online')).getByText('99+')).toBeInTheDocument();
    expect(within(header('Antrean & Kehadiran')).getByText('99')).toBeInTheDocument();
  });

  it('disembunyikan bila 0 atau tidak ada', async () => {
    badges({ liveChat: { count: 0, label: '0 chat menunggu diambil' } });
    await renderSidebar('admin', '/admin/chat');
    const link = screen.getByRole('link', { name: 'Live Chat' });
    expect(link.querySelector('[class*="badge"]')).toBeNull();
    expect(within(header('Layanan Online')).queryByText('0')).toBeNull();
    expect(link).toHaveAccessibleName('Live Chat');
  });

  it('petugas (semua grup terbuka bawaan, P1): lencana Antrean ada di anak; dilipat = jumlah pindah ke header', async () => {
    badges({ antrian: { count: 7, label: '7 tiket menunggu atau dipanggil hari ini' } });
    await renderSidebar('petugas', '/admin/chat');
    expect(terbuka('Antrean & Kehadiran')).toBe(true);
    expect(within(screen.getByRole('link', { name: /Antrean/ })).getByText('7')).toBeInTheDocument();
    fireEvent.click(header('Antrean & Kehadiran'));
    expect(within(header('Antrean & Kehadiran')).getByText('7')).toBeInTheDocument();
  });

  it('judul tab diawali jumlah total badge dan kembali polos saat 0', async () => {
    document.title = 'Admin LMH';
    badges({ liveChat: { count: 3, label: 'x' }, antrian: { count: 4, label: 'y' } });
    const u = await renderSidebar('admin', '/admin');
    expect(document.title).toBe('(7) Admin LMH');
    badges({});
    act(() => { u.rerender(<Sidebar />); });
    expect(document.title).toBe('Admin LMH');
  });
});

describe('Sidebar: P1 kelompok terbuka per peran', () => {
  it('front_office dan petugas: semua kelompok terbuka bawaan dan bisa dilipat satu per satu', async () => {
    await renderSidebar('front_office', '/admin');
    const grup = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-controls')?.startsWith('sidebar-grup-'));
    expect(grup.length).toBeGreaterThan(1);
    expect(grup.every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true);
    fireEvent.click(header('Front Office'));
    expect(terbuka('Front Office')).toBe(false);
    expect(terbuka('Layanan Online')).toBe(true); // bukan akordeon
  });

  it('admin tetap akordeon: satu kelompok terbuka', async () => {
    await renderSidebar('admin', '/admin');
    fireEvent.click(header('Front Office'));
    fireEvent.click(header('Layanan Online'));
    expect(terbuka('Front Office')).toBe(false);
    expect(terbuka('Layanan Online')).toBe(true);
  });
});

describe('Sidebar: kartu identitas dan keluar', () => {
  it('menampilkan nama dan peran; menu berisi Profil Saya dan Keluar yang memanggil keluarDariSesi', async () => {
    const { keluarDariSesi } = await import('@/lib/sesi-staf');
    await renderSidebar('front_office', '/admin');
    const kartu = screen.getByRole('button', { name: /Budi/ });
    expect(kartu).toHaveAttribute('aria-haspopup', 'menu');
    expect(kartu).toHaveTextContent('Front Office');
    fireEvent.click(kartu);
    expect(screen.getByRole('menuitem', { name: 'Profil Saya' })).toHaveAttribute('href', '/admin/profil');
    // window.location.href dipakai setelah keluar; jsdom tidak menavigasi, cukup pastikan keluarDariSesi dipanggil.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }));
    await vi.waitFor(() => expect(keluarDariSesi).toHaveBeenCalled());
  });
});

describe('Sidebar: tombol Keluar terlihat langsung', () => {
  it('semua peran punya tombol Keluar di dasar sidebar (tanpa membuka menu) yang memanggil keluarDariSesi', async () => {
    const { keluarDariSesi } = await import('@/lib/sesi-staf');
    for (const role of ['admin', 'front_office', 'petugas'] as const) {
      vi.mocked(keluarDariSesi).mockClear();
      const { unmount } = await renderSidebar(role, '/admin');
      fireEvent.click(screen.getByRole('button', { name: 'Keluar' }));
      await vi.waitFor(() => expect(keluarDariSesi).toHaveBeenCalled());
      unmount();
    }
  });
});

describe('Sidebar: laci HP/tablet', () => {
  function stubMq() {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  }
  const tombolBuka = () => screen.getByRole('button', { name: 'Buka menu' });

  it('tombol di bilah atas: aria-expanded, aria-controls ke aside#sidebar; laci punya tombol Tutup menu', async () => {
    stubMq();
    await renderSidebar('admin', '/admin');
    const aside = document.getElementById('sidebar')!;
    expect(aside.tagName).toBe('ASIDE');
    expect(tombolBuka()).toHaveAttribute('aria-controls', 'sidebar');
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Tutup menu' })).toBeNull();
    fireEvent.click(tombolBuka());
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'true');
    expect(aside).toHaveAttribute('role', 'dialog');
    expect(aside).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Tutup menu' })).toBeInTheDocument();
  });

  it('mengetuk anak menutup laci; mengetuk header grup tidak', async () => {
    stubMq();
    await renderSidebar('admin', '/admin');
    fireEvent.click(tombolBuka());
    fireEvent.click(header('Front Office'));
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('link', { name: 'Registrasi Pengunjung' }));
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
  });

  it('terbuka: fokus pindah ke laci, gulir body terkunci, konten lain (AppBar, konten utama) inert', async () => {
    stubMq();
    const u = await renderSidebar('admin', '/admin');
    const aside = document.getElementById('sidebar')!;
    const bilah = document.querySelector('[data-appbar]')!;
    fireEvent.click(tombolBuka());
    expect(document.activeElement).toBe(aside);
    expect(document.body.style.overflow).toBe('hidden');
    expect(bilah).toHaveAttribute('inert');
    expect(aside).not.toHaveAttribute('inert');
    expect(document.querySelector('[data-sidebar-overlay]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup menu' }));
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(bilah).not.toHaveAttribute('inert');
    u.unmount();
  });

  it('Esc menutup laci dan fokus kembali ke tombol menu', async () => {
    stubMq();
    await renderSidebar('admin', '/admin');
    fireEvent.click(tombolBuka());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(tombolBuka());
  });

  it('klik latar menutup laci dan fokus kembali ke tombol menu', async () => {
    stubMq();
    await renderSidebar('admin', '/admin');
    fireEvent.click(tombolBuka());
    fireEvent.click(document.querySelector('[data-sidebar-overlay]')!);
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-sidebar-overlay]')).toBeNull();
    expect(document.activeElement).toBe(tombolBuka());
  });

  it('tutup otomatis saat pindah rute', async () => {
    stubMq();
    const u = await renderSidebar('admin', '/admin');
    fireEvent.click(tombolBuka());
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'true');
    ubahPath(u, '/admin/chat');
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
  });

  it('layar melebar jadi desktop menutup laci', async () => {
    let onChange: (() => void) | undefined;
    const mq = { matches: false, addEventListener: (_: string, fn: () => void) => { onChange = fn; }, removeEventListener: () => {} };
    vi.stubGlobal('matchMedia', () => mq);
    await renderSidebar('admin', '/admin');
    fireEvent.click(tombolBuka());
    mq.matches = true;
    act(() => onChange?.());
    expect(tombolBuka()).toHaveAttribute('aria-expanded', 'false');
  });

  it('widget ikut area gulir yang sama dengan menu (urutan DOM: menu, widget, tautan bawah)', async () => {
    await renderSidebar('admin', '/admin');
    const isi = screen.getByRole('navigation', { name: 'Menu admin' }).parentElement!;
    const anak = Array.from(isi.children);
    expect(anak[0].tagName).toBe('NAV');
    expect(anak[1]).toHaveAttribute('data-widget');
    expect(anak[2].className).toMatch(/bawah/);
  });

  it('judul bilah atas = entri menu aktif', async () => {
    await renderSidebar('admin', '/admin/chat/faq');
    expect(document.querySelector('[data-appbar]')).toHaveTextContent('Kelola FAQ');
  });
});
