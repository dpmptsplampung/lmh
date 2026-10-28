// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buatFakeSupabase, buatH, punyaOp, type FakeH } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({ h: null as unknown as FakeH, toast: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => buatFakeSupabase(m.h) }));

import PemberitahuanAmbilAlih from './PemberitahuanAmbilAlih';

afterEach(cleanup);

describe('PemberitahuanAmbilAlih', () => {
  it('menampilkan ambil alih yang belum dilihat milik saya; "Mengerti" memanggil RPC dan menyembunyikan', async () => {
    m.h = buatH();
    m.h.tabel.ambil_alih_pendataan = {
      data: [{ id: 'aa1', peran_tahap: 'layanan', alasan: 'petugas izin', created_at: '2026-10-20T02:00:00Z',
        tiket: { nomor_display: 'OS-004' }, baru: { nama: 'Koord Satu' } }],
      error: null,
    };
    m.h.rpc = () => ({ data: { ok: true, diperbarui: 1 }, error: null });
    render(<PemberitahuanAmbilAlih petugasId="p1" />);
    expect(await screen.findByText(/OS-004/)).toBeInTheDocument();
    expect(screen.getByText(/Koord Satu/)).toBeInTheDocument();
    const kueri = m.h.log.find((l) => l.tabel === 'ambil_alih_pendataan')!;
    expect(punyaOp(kueri.ops, 'eq', 'pemegang_lama', 'p1')).toBe(true);
    expect(punyaOp(kueri.ops, 'is', 'dilihat_at', null)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mengerti' }));
    await waitFor(() => expect(screen.queryByText(/OS-004/)).toBeNull());
    expect(m.h.rpcLog).toContainEqual({ nama: 'ambil_alih_tandai_dilihat', args: { p_id: 'aa1' } });
  });

  it('tabel belum ada (migrasi belum diterapkan) -> tidak menampilkan apa pun', async () => {
    m.h = buatH();
    m.h.tabel.ambil_alih_pendataan = { data: null, error: { message: 'relation does not exist', code: '42P01' } };
    const { container } = render(<PemberitahuanAmbilAlih petugasId="p1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');
  });
});
