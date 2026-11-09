// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import ProfilKatalog from './ProfilKatalog';
import PencatatStatistik from './PencatatStatistik';
import FormulirKatalog from './FormulirKatalog';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
const id = '10000000-0000-4000-8000-000000000001';
const similarId = '10000000-0000-4000-8000-000000000002';
const profile = {
  id, nama: 'Kopi Lampung', jenis: 'Produk', kategori: 'Minuman', spesifik: 'Kopi',
  kabupaten_kota: 'Lampung Barat', deskripsi: 'Kopi setempat', foto: [], instagram: null, tiktok: null,
  suka: 1999, dilihat: 0, baru: true, telemetri_opsional_aktif: true, statistik_mulai_pada: null,
};
const similar = { ...profile, id: similarId, nama: 'Kopi Serupa', foto: null, dilihat: null };
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
const fail = (status: number, code: string) => Promise.resolve(new Response(
  JSON.stringify({ error: { code, message: 'rincian internal' } }), { status }));
let request: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.push.mockReset();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
  request = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/serupa')) return ok({ items: [similar] });
    if (url.endsWith('/suka')) {
      return ok(init?.method === 'POST'
        ? { profil_id: id, suka_saya: JSON.parse(init.body as string).aktif, suka: 2000 }
        : { suka_saya: false });
    }
    return ok(profile);
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'sendBeacon');
});

describe('statistik dan suka profil', () => {
  it('menampilkan tanggal awal pencatatan WIB dekat angka dilihat saat sakelar aktif', async () => {
    request.mockImplementation((url: string) => url.endsWith('/serupa') ? ok({ items: [] })
      : url.endsWith('/suka') ? ok({ suka_saya: false })
        : ok({ ...profile, statistik_mulai_pada: '2026-11-08T18:30:00Z' }));
    render(<ProfilKatalog id={id} />);
    const coverage = await screen.findByText(/Dicatat sejak/);
    expect(coverage).toHaveTextContent('Dicatat sejak 2026-11-09 WIB');
    expect(coverage.querySelector('time')).toHaveAttribute('dateTime', '2026-11-08T18:30:00Z');
    expect(coverage.previousElementSibling).toHaveTextContent('0 Dilihat');
  });

  it('sakelar mati menyembunyikan tanggal awal pencatatan profil', async () => {
    request.mockImplementation((url: string) => url.endsWith('/serupa') ? ok({ items: [] })
      : url.endsWith('/suka') ? ok({ suka_saya: false }) : ok({ ...profile,
        telemetri_opsional_aktif: false, dilihat: null, statistik_mulai_pada: '2026-11-08T18:30:00Z',
      }));
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: profile.nama });
    expect(screen.queryByText(/Dicatat sejak/)).toBeNull();
  });

  it('menampilkan angka aksesibel, memberi suka dan membatalkan melalui desired state', async () => {
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: profile.nama });
    expect(screen.getByText('1.999 Suka', { selector: '.sr-only' }).parentElement).toHaveTextContent('1,9 rb Suka');
    expect(screen.getByText('0 Dilihat', { selector: '.sr-only' })).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Suka' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Batalkan suka', pressed: true })).toBeTruthy();
    expect(screen.getByText('2.000 Suka', { selector: '.sr-only' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Batalkan suka' }));
    await screen.findByRole('button', { name: 'Suka', pressed: false });
    const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      [`/api/umkm-katalog/${id}/suka`, { aktif: true }],
      [`/api/umkm-katalog/${id}/suka`, { aktif: false }],
    ]);
    expect(request.mock.calls.find(([url]) => url.endsWith('/suka'))?.[1].cache).toBe('no-store');
  });

  it.each(['pengunjung tanpa sesi', 'sesi anonim formulir'])('%s menuju login dengan next profil', async () => {
    request.mockImplementation((url: string) => url.endsWith('/suka') ? fail(401, 'LOGIN_DIPERLUKAN')
      : url.endsWith('/serupa') ? ok({ items: [] }) : ok(profile));
    render(<ProfilKatalog id={id} />);
    const button = await screen.findByRole('button', { name: 'Suka' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(mocks.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/umkm/katalog/${id}`)}`);
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('sesi berakhir saat memberi suka diarahkan ke login', async () => {
    request.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/suka')
      ? init?.method === 'POST' ? fail(401, 'LOGIN_DIPERLUKAN') : ok({ suka_saya: false })
      : url.endsWith('/serupa') ? ok({ items: [] }) : ok(profile));
    render(<ProfilKatalog id={id} />);
    const button = await screen.findByRole('button', { name: 'Suka' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
  });

  it('penolakan staf disampaikan dengan tenang tanpa mengubah angka', async () => {
    request.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/suka')
      ? init?.method === 'POST' ? fail(403, 'DILARANG') : ok({ suka_saya: false })
      : url.endsWith('/serupa') ? ok({ items: [] }) : ok(profile));
    render(<ProfilKatalog id={id} />);
    const button = await screen.findByRole('button', { name: 'Suka' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByText(/Akun staf tidak ikut dihitung/)).toBeTruthy();
    expect(button).toBeDisabled();
    expect(screen.getByText('1.999 Suka', { selector: '.sr-only' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('rincian internal');
  });

  it('serupa mempunyai kartu dan formulir dengan konteks profil yang dipilih', async () => {
    render(<ProfilKatalog id={id} />);
    const section = await screen.findByRole('region', { name: 'UMKM serupa' });
    expect(await within(section).findByRole('link', { name: similar.nama }))
      .toHaveAttribute('href', `/umkm/katalog/${similarId}`);
    fireEvent.click(within(section).getByRole('button', { name: /Hubungi lewat petugas untuk/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Kopi Serupa');
  });

  it('serupa kosong atau gagal tidak menghalangi profil', async () => {
    request.mockImplementation((url: string) => url.endsWith('/serupa') ? fail(503, 'MODUL_BELUM_TERSEDIA')
      : url.endsWith('/suka') ? ok({ suka_saya: false }) : ok(profile));
    render(<ProfilKatalog id={id} />);
    expect(await screen.findByText(/UMKM serupa belum berhasil dimuat/)).toBeTruthy();
    request.mockImplementation((url: string) => url.endsWith('/serupa') ? ok({ items: [] }) : ok(profile));
    fireEvent.click(screen.getByRole('button', { name: 'Coba muat UMKM serupa' }));
    expect(await screen.findByText('Belum ada UMKM serupa yang dapat ditampilkan.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: profile.nama })).toBeTruthy();
  });
});

describe('pencatat opsional', () => {
  it('sakelar mati tidak mengirim beacon atau fetch statistik', () => {
    render(<PencatatStatistik id={id} aktif={false} jenis="dilihat" />);
    fireEvent(document, new Event('visibilitychange'));
    expect(beacon).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('tab tersembunyi menunggu aktif lalu mengirim sekali, termasuk StrictMode', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<StrictMode><PencatatStatistik id={id} aktif jenis="dilihat" /></StrictMode>);
    expect(beacon).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledOnce();
    const [url, body] = beacon.mock.calls[0];
    expect(url).toBe('/api/umkm-katalog/statistik');
    expect(body).toBeInstanceOf(Blob);
    expect(request).not.toHaveBeenCalled();
  });

  it('profil dan pembukaan formulir pesan mengirim jenis yang sesuai, laporan tidak', async () => {
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { level: 1, name: profile.nama });
    await waitFor(() => expect(beacon).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: /^Hubungi lewat petugas$/ }));
    await screen.findByRole('dialog');
    expect(beacon).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan' }));
    await screen.findByRole('dialog');
    expect(beacon).toHaveBeenCalledTimes(2);
    const readBlob = (blob: Blob) => new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    expect(await Promise.all(beacon.mock.calls.map(async ([, blob]) => JSON.parse(await readBlob(blob)))))
      .toEqual([{ jenis: 'dilihat', profil_id: id }, { jenis: 'klik_formulir', profil_id: id }]);
  });

  it('formulir dari kartu memeriksa flag profil tanpa mengirim saat mati', async () => {
    request.mockImplementation(() => ok({ ...profile, telemetri_opsional_aktif: false }));
    render(<FormulirKatalog terbuka jenis="pesan" konteks={{ profil_id: id }} onTutup={vi.fn()} />);
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(beacon).not.toHaveBeenCalled();
  });

  it('gagal beacon tidak mengganggu layar dan tidak mengulang panggilan', async () => {
    beacon.mockImplementation(() => { throw new Error('gagal'); });
    render(<ProfilKatalog id={id} />);
    expect(await screen.findByRole('heading', { level: 1, name: profile.nama })).toBeTruthy();
    fireEvent(document, new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tanpa sendBeacon memakai fetch keepalive yang gagal secara diam', async () => {
    Reflect.deleteProperty(navigator, 'sendBeacon');
    request.mockRejectedValue(new TypeError('offline'));
    render(<PencatatStatistik id={id} aktif jenis="klik_formulir" />);
    await act(async () => {});
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]).toEqual(['/api/umkm-katalog/statistik', expect.objectContaining({
      method: 'POST', keepalive: true, body: JSON.stringify({ jenis: 'klik_formulir', profil_id: id }),
    })]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
