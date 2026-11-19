import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MinatDetail, MinatRingkas } from '@/lib/data/investasi';

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/investasi-leads',
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
const data = vi.hoisted(() => ({ daftarMinat: vi.fn(), minatById: vi.fn() }));
vi.mock('@/lib/data/investasi', () => ({ daftarMinat: data.daftarMinat, minatById: data.minatById }));

import KotakMasuk from './KotakMasuk';

const ringkas = (o: Partial<MinatRingkas> = {}): MinatRingkas => ({
  id: 'lead-1', kanal: 'ipro', status: 'baru', versi: 3, nama: 'Budi Santoso', instansi: 'PT Maju Jaya',
  created_at: '2026-11-19T03:30:00Z', aktivitas_pada: '2026-11-19T03:30:00Z', petugas_id: null,
  ipro_id: 'p1', doc_id: null, ipro_proyek: { judul: 'Pabrik Singkong' }, investment_documents: null, ...o,
});
const detail = (o: Partial<MinatDetail> = {}): MinatDetail => ({
  ...ringkas(), email: 'budi@contoh.id', no_hp: '081234567890', catatan: 'Kami tertarik pada lahan 5 hektare.', minat: null, aktivitas_pada: '2026-11-19T05:00:00Z', ...o,
});
// Pengganti user-event (tidak terpasang): hanya aksi yang dipakai di sini.
const userEvent = {
  setup: () => ({
    click: async (el: Element) => { await act(async () => { fireEvent.click(el); }); },
    selectOptions: async (el: Element, nilai: string) => { await act(async () => { fireEvent.change(el, { target: { value: nilai } }); }); },
    type: async (el: Element, teks: string) => { await act(async () => { fireEvent.change(el, { target: { value: teks } }); }); },
    clear: async (el: Element) => { await act(async () => { fireEvent.change(el, { target: { value: '' } }); }); },
  }),
};
const SEMUA = [
  ringkas(),
  ringkas({ id: 'lead-2', kanal: 'dokumen', nama: 'Siti Aminah', instansi: null, status: 'selesai', ipro_id: null, doc_id: 'd1',
    ipro_proyek: null, investment_documents: { judul: 'Peta Potensi 2026' } }),
];

function jawabFetch(status: number, badan: unknown) {
  const f = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => badan });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  nav.query = '';
  nav.replace.mockReset();
  data.daftarMinat.mockReset().mockResolvedValue({ data: SEMUA, error: null, count: 2 });
  data.minatById.mockReset().mockResolvedValue({ data: detail(), error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('KotakMasuk: daftar', () => {
  it('menampilkan jenis, konteks, nama, waktu WIB, dan status', async () => {
    render(<KotakMasuk />);
    const tabel = await screen.findByRole('table', { name: /pesan minat investasi/i });
    const baris = within(tabel).getAllByRole('row');
    expect(within(baris[1]).getByText('IPRO')).toBeInTheDocument();
    expect(within(baris[1]).getByText('Pabrik Singkong')).toBeInTheDocument();
    expect(within(baris[1]).getByText('Budi Santoso')).toBeInTheDocument();
    expect(within(baris[1]).getByText('2026-11-19 10:30 WIB')).toBeInTheDocument();
    expect(within(baris[1]).getByText('Baru')).toBeInTheDocument();
    expect(within(baris[2]).getByText('Dokumen')).toBeInTheDocument();
    expect(within(baris[2]).getByText('Peta Potensi 2026')).toBeInTheDocument();
    // PII (email, HP) tidak ada di daftar.
    expect(screen.queryByText('budi@contoh.id')).not.toBeInTheDocument();
    expect(data.daftarMinat).toHaveBeenCalledWith({}, { dari: 0, sampai: 24 });
  });

  it('menyaring jenis dan status lewat lapisan data dan kembali ke halaman pertama', async () => {
    const u = userEvent.setup();
    render(<KotakMasuk />);
    await screen.findByRole('table');
    await u.selectOptions(screen.getByLabelText('Jenis'), 'dokumen');
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, { kanal: 'dokumen', dari: 0, sampai: 24 }));
    await u.selectOptions(screen.getByLabelText('Status'), 'selesai');
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, { kanal: 'dokumen', status: 'selesai', dari: 0, sampai: 24 }));
  });

  it('pencarian nama/email/instansi mencakup semua halaman dan memakai hasil serta total dari server', async () => {
    const u = userEvent.setup();
    data.daftarMinat.mockResolvedValue({ data: SEMUA, error: null, count: 51 });
    render(<KotakMasuk />);
    await screen.findByRole('table');
    await u.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, { dari: 25, sampai: 49 }));
    data.daftarMinat.mockResolvedValue({ data: [SEMUA[1]], error: null, count: 1 });
    await u.type(screen.getByLabelText('Cari nama, email, instansi'), 'siti@contoh.id');
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, { cari: 'siti@contoh.id', dari: 0, sampai: 24 }));
    expect(screen.queryByText('Budi Santoso')).not.toBeInTheDocument();
    expect(screen.getByText('Siti Aminah')).toBeInTheDocument();
    expect(screen.getByText('Halaman 1 dari 1 • total 1 data')).toBeInTheDocument();
    data.daftarMinat.mockResolvedValue({ data: [], error: null, count: 0 });
    await u.type(screen.getByLabelText('Cari nama, email, instansi'), 'zzz');
    expect(screen.getByText('Tidak ada pesan yang cocok')).toBeInTheDocument();
    expect(screen.getByText('Coba nama, email, atau instansi lain.')).toBeInTheDocument();
    data.daftarMinat.mockResolvedValue({ data: SEMUA, error: null, count: 2 });
    await u.clear(screen.getByLabelText('Cari nama, email, instansi'));
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, { dari: 0, sampai: 24 }));
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
  });

  it('keadaan kosong dan galat dengan coba lagi', async () => {
    data.daftarMinat.mockResolvedValueOnce({ data: [], error: null, count: 0 });
    const { unmount } = render(<KotakMasuk />);
    expect(await screen.findByText('Belum ada pesan masuk')).toBeInTheDocument();
    unmount();
    data.daftarMinat.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    render(<KotakMasuk />);
    const u = userEvent.setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum dapat dimuat/i);
    await u.click(screen.getByRole('button', { name: /coba lagi/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('KotakMasuk: panel detail', () => {
  it('Buka menampilkan PII lengkap, waktu WIB, dan tombol balas lewat email', async () => {
    const u = userEvent.setup();
    render(<KotakMasuk />);
    await u.click((await screen.findAllByRole('button', { name: /buka pesan dari budi/i }))[0]);
    const panel = await screen.findByRole('dialog', { name: /pesan dari budi santoso/i });
    expect(data.minatById).toHaveBeenCalledWith({}, 'lead-1');
    expect(await within(panel).findByText('Kami tertarik pada lahan 5 hektare.')).toBeInTheDocument();
    expect(within(panel).getByText('PT Maju Jaya')).toBeInTheDocument();
    expect(within(panel).getByText('081234567890')).toBeInTheDocument();
    expect(within(panel).getByText('2026-11-19 10:30 WIB', { selector: 'dd' })).toBeInTheDocument();
    expect(within(panel).getByText('2026-11-19 12:00 WIB', { selector: 'dd' })).toBeInTheDocument();
    expect(within(panel).getByText('Belum ada penangan')).toBeInTheDocument();
    const balas = within(panel).getByRole('link', { name: /balas lewat email/i });
    expect(balas.getAttribute('href')).toMatch(/^mailto:budi%40contoh\.id\?subject=/);
    expect(within(panel).getByRole('link', { name: 'budi@contoh.id' })).toHaveAttribute('href', 'mailto:budi%40contoh.id');
  });

  it.each(['investor@example.org?bcc=salin%40evil.example&body=', 'investor&salin@example.org', 'investor%40salin@example.org'])(
    'email tidak sah tampil sebagai teks tanpa tautan balas: %s', async (email) => {
      nav.query = 'id=lead-1';
      data.minatById.mockResolvedValue({ data: detail({ email }), error: null });
      render(<KotakMasuk />);
      const panel = await screen.findByRole('dialog');
      expect(await within(panel).findByText(email)).toBeInTheDocument();
      expect(within(panel).queryByRole('link', { name: email })).not.toBeInTheDocument();
      expect(within(panel).queryByRole('link', { name: /balas lewat email/i })).not.toBeInTheDocument();
      expect(panel.querySelector('a[href^="mailto:"]')).toBeNull();
    },
  );

  it('?id= membuka panel langsung, dan menutupnya menghapus ?id= dari alamat', async () => {
    nav.query = 'id=lead-1';
    const u = userEvent.setup();
    render(<KotakMasuk />);
    const panel = await screen.findByRole('dialog', { name: /pesan dari budi santoso/i });
    expect(data.minatById).toHaveBeenCalledWith({}, 'lead-1');
    await u.click(within(panel).getAllByRole('button', { name: /tutup/i })[0]);
    expect(nav.replace).toHaveBeenCalledWith('/admin/investasi-leads');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('?id= tidak ditemukan menampilkan pesan galat, bukan panel kosong', async () => {
    nav.query = 'id=hilang';
    data.minatById.mockResolvedValue({ data: null, error: null });
    render(<KotakMasuk />);
    expect(await screen.findByText(/tidak ditemukan atau bukan lagi wewenang/i)).toBeInTheDocument();
  });

  it('ubah status sukses: mengirim status dan versi, memperbarui lencana panel dan baris', async () => {
    nav.query = 'id=lead-1';
    const f = jawabFetch(200, { data: { id: 'lead-1', status: 'dihubungi', versi: 4 } });
    const u = userEvent.setup();
    render(<KotakMasuk />);
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Kami tertarik pada lahan 5 hektare.');
    const simpan = within(panel).getByRole('button', { name: 'Simpan status' });
    expect(simpan).toBeDisabled();
    await u.selectOptions(within(panel).getByLabelText('Status penanganan'), 'dihubungi');
    data.daftarMinat.mockResolvedValue({ data: [ringkas({ status: 'dihubungi', versi: 4 }), SEMUA[1]], error: null, count: 2 });
    await u.click(simpan);
    await waitFor(() => expect(f).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/investasi/lead/lead-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ status: 'dihubungi', versi: 3 });
    expect(await within(panel).findByRole('status')).toHaveTextContent('Status diperbarui.');
    const tabel = screen.getByRole('table');
    expect(within(tabel).getByText('Dihubungi')).toBeInTheDocument();
    // Pengiriman berikutnya memakai versi baru.
    await u.selectOptions(within(panel).getByLabelText('Status penanganan'), 'selesai');
    f.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { id: 'lead-1', status: 'selesai', versi: 5 } }) });
    await u.click(within(panel).getByRole('button', { name: 'Simpan status' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ status: 'selesai', versi: 4 });
  });

  it.each([1, 26])('ubah status dengan saringan aktif memuat ulang total dan menyesuaikan halaman terakhir (%i pesan)', async (totalAwal) => {
    const u = userEvent.setup();
    let tersimpan = false;
    const lainnya = Array.from({ length: totalAwal - 1 }, (_, i) => ringkas({ id: `lain-${i}`, nama: `Investor ${i}` }));
    data.daftarMinat.mockImplementation((_sb, opsi) => {
      const daftar = tersimpan ? lainnya : [...lainnya, ringkas()];
      return Promise.resolve({ data: daftar.slice(opsi.dari, opsi.sampai + 1), error: null, count: daftar.length });
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      tersimpan = true;
      return { ok: true, status: 200, json: async () => ({ data: { id: 'lead-1', status: 'selesai', versi: 4 } }) };
    }));
    render(<KotakMasuk />);
    await screen.findByRole('table');
    await u.selectOptions(screen.getByLabelText('Status'), 'baru');
    await u.selectOptions(screen.getByLabelText('Jenis'), 'ipro');
    await u.type(screen.getByLabelText('Cari nama, email, instansi'), 'PT Maju Jaya');
    if (totalAwal > 25) await u.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    await u.click(await screen.findByRole('button', { name: /buka pesan dari budi/i }));
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Kami tertarik pada lahan 5 hektare.');
    data.daftarMinat.mockClear();
    await u.selectOptions(within(panel).getByLabelText('Status penanganan'), 'selesai');
    await u.click(within(panel).getByRole('button', { name: 'Simpan status' }));
    await waitFor(() => expect(data.daftarMinat).toHaveBeenLastCalledWith({}, {
      kanal: 'ipro', status: 'baru', cari: 'PT Maju Jaya', dari: 0, sampai: 24,
    }));
    if (totalAwal > 1) {
      await waitFor(() => expect(screen.getByText(`Halaman 1 dari 1 • total ${totalAwal - 1} data`)).toBeInTheDocument());
    } else {
      expect(screen.getByText('0 pesan berstatus Baru')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Halaman berikutnya' })).toBeNull();
    }
    const tabel = screen.queryByRole('table');
    expect(tabel ? within(tabel).queryByText('Budi Santoso') : null).not.toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent('Status diperbarui.');
    if (totalAwal > 25) {
      expect(data.daftarMinat).toHaveBeenCalledWith({}, {
        kanal: 'ipro', status: 'baru', cari: 'PT Maju Jaya', dari: 25, sampai: 49,
      });
    }
  });

  it('ubah status konflik versi: meminta muat ulang, dan Muat ulang memuat detail baru', async () => {
    nav.query = 'id=lead-1';
    jawabFetch(409, { error: { code: 'KONFLIK_VERSI', message: 'Data telah berubah.' }, request_id: 'r' });
    const u = userEvent.setup();
    render(<KotakMasuk />);
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Kami tertarik pada lahan 5 hektare.');
    await u.selectOptions(within(panel).getByLabelText('Status penanganan'), 'ditolak');
    await u.click(within(panel).getByRole('button', { name: 'Simpan status' }));
    const peringatan = await within(panel).findByRole('alert');
    expect(peringatan).toHaveTextContent(/muat ulang/i);
    data.minatById.mockResolvedValue({ data: detail({ status: 'berlanjut', versi: 7 }), error: null });
    await u.click(within(panel).getByRole('button', { name: /muat ulang pesan/i }));
    expect(await within(panel).findByText('Berlanjut', { selector: 'span' })).toBeInTheDocument();
    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument();
    expect(data.minatById).toHaveBeenCalledTimes(2);
  });

  it('galat lain dari server ditampilkan tanpa mengubah status', async () => {
    nav.query = 'id=lead-1';
    jawabFetch(403, { error: { code: 'DILARANG', message: 'Akun ini tidak berwenang mengelola investasi.' } });
    const u = userEvent.setup();
    render(<KotakMasuk />);
    const panel = await screen.findByRole('dialog');
    await within(panel).findByText('Kami tertarik pada lahan 5 hektare.');
    await u.selectOptions(within(panel).getByLabelText('Status penanganan'), 'ditolak');
    await u.click(within(panel).getByRole('button', { name: 'Simpan status' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Akun ini tidak berwenang mengelola investasi.');
    expect(within(panel).queryByRole('button', { name: /muat ulang pesan/i })).not.toBeInTheDocument();
  });
});
