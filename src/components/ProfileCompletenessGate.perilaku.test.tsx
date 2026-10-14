// @vitest-environment jsdom
// Perilaku K12 pada gerbang profil: kotak centang pernyataan kebenaran, field wajib, kegagalan consent membatalkan
// simpan profil, dan nama terkunci. supabase-js tidak melempar: mock mengembalikan `{ error }`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import ProfileCompletenessGate from './ProfileCompletenessGate';
import { createClient } from '@/lib/supabase/client';
import {
  PERNYATAAN_KEBENARAN_JENIS,
  PERNYATAAN_KEBENARAN_TEKS,
  PERNYATAAN_KEBENARAN_VERSI,
} from '@/lib/pernyataan-kebenaran';

type Hasil = { data: unknown; error: unknown };
type Panggilan = { tabel: string; aksi: 'insert' | 'upsert'; payload: unknown; opsi?: unknown };

const USER = { id: 'user-1', email: 'budi@example.com' };

function siapkan(opsi: {
  profil?: Record<string, unknown> | null;
  consent?: () => Hasil;
  upsert?: () => Hasil;
} = {}) {
  const panggilan: Panggilan[] = [];
  const consent = opsi.consent ?? (() => ({ data: null, error: null }));
  const upsert = opsi.upsert ?? (() => ({ data: null, error: null }));
  const profil = opsi.profil === undefined ? null : opsi.profil;

  const dari = (tabel: string) => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: profil, error: null }) }),
    }),
    insert: (payload: unknown) => {
      panggilan.push({ tabel, aksi: 'insert', payload });
      return Promise.resolve(consent());
    },
    upsert: (payload: unknown, o?: unknown) => {
      panggilan.push({ tabel, aksi: 'upsert', payload, opsi: o });
      return Promise.resolve(upsert());
    },
  });
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: USER } }) },
    from: dari,
  } as unknown as ReturnType<typeof createClient>);
  return panggilan;
}

async function isiFormLengkap() {
  fireEvent.change(await screen.findByLabelText(/Nama Lengkap/), { target: { value: 'Budi Santoso' } });
  fireEvent.change(screen.getByLabelText(/Nomor HP/), { target: { value: '081234567890' } });
  fireEvent.change(screen.getByLabelText(/Asal \/ Instansi/), { target: { value: 'Universitas Lampung' } });
  fireEvent.change(screen.getByLabelText(/Kategori Pengunjung/), { target: { value: 'Umum' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'budi@example.com' } });
}

const tombolSimpan = () => screen.getByRole('button', { name: /Simpan & Lanjutkan/ });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProfileCompletenessGate K12: pernyataan kebenaran', () => {
  it('tombol Simpan nonaktif sampai kotak centang pernyataan dicentang', async () => {
    siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();

    expect(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS)).not.toBeChecked();
    expect(tombolSimpan()).toBeDisabled();

    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    expect(tombolSimpan()).toBeEnabled();

    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    expect(tombolSimpan()).toBeDisabled();
  });

  it('menampilkan teks pernyataan persis dan email awal dari akun login', async () => {
    siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    expect(await screen.findByText(PERNYATAAN_KEBENARAN_TEKS)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveValue('budi@example.com');
  });

  it('simpan sukses: consent_log dicatat DULU (jenis, versi, subjek) lalu profil di-upsert lengkap dengan email', async () => {
    const panggilan = siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Sudah Benar' }));

    expect(await screen.findByText('ISI')).toBeInTheDocument();
    expect(panggilan.map((p) => `${p.tabel}:${p.aksi}`)).toEqual(['consent_log:insert', 'pengunjung:upsert']);
    expect(panggilan[0].payload).toEqual({
      subjek_ref: USER.id,
      tujuan: PERNYATAAN_KEBENARAN_JENIS,
      disetujui: true,
      versi_kebijakan: PERNYATAAN_KEBENARAN_VERSI,
    });
    expect(panggilan[1].payload).toEqual({
      auth_user_id: USER.id,
      nama: 'Budi Santoso',
      no_hp: '081234567890',
      asal_instansi: 'Universitas Lampung',
      kategori: 'Umum',
      email: 'budi@example.com',
    });
    expect(panggilan[1].opsi).toEqual({ onConflict: 'auth_user_id' });
  });

  it('consent_log gagal: profil TIDAK disimpan, pesan jelas, gerbang tetap terkunci', async () => {
    const panggilan = siapkan({
      consent: () => ({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } }),
    });
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Sudah Benar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Pernyataan kebenaran data gagal dicatat/);
    expect(panggilan.map((p) => `${p.tabel}:${p.aksi}`)).toEqual(['consent_log:insert']);
    expect(screen.queryByText('ISI')).not.toBeInTheDocument();
    // dapat diulang
    expect(tombolSimpan()).toBeEnabled();
  });

  it('upsert profil gagal: tidak lolos ke children dan galat ditampilkan', async () => {
    siapkan({ upsert: () => ({ data: null, error: { message: 'boom', code: '57014' } }) });
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Sudah Benar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/kesalahan saat menyimpan/i);
    expect(screen.queryByText('ISI')).not.toBeInTheDocument();
  });

  it('upsert ditolak trigger NAMA_TERKUNCI: pesan hubungi Front Office', async () => {
    siapkan({
      upsert: () => ({ data: null, error: { message: 'NAMA_TERKUNCI: Nama Lengkap tidak dapat diubah sendiri', code: '42501' } }),
    });
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());
    fireEvent.click(await screen.findByRole('button', { name: 'Ya, Sudah Benar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/hubungi Front Office/);
  });
});

describe('ProfileCompletenessGate K12: field wajib', () => {
  it.each([
    ['Nama Lengkap', /Nama Lengkap/, ''],
    ['Nomor HP', /Nomor HP/, ''],
    ['Asal / Instansi', /Asal \/ Instansi/, ''],
    ['Kategori Pengunjung', /Kategori Pengunjung/, ''],
    ['Email', /^Email/, ''],
  ])('%s kosong ditolak: tidak ada dialog konfirmasi dan tidak ada penulisan', async (_nama, label, kosong) => {
    const panggilan = siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.change(screen.getByLabelText(label), { target: { value: kosong } });
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(panggilan).toEqual([]);
  });

  it('email tidak valid ditolak', async () => {
    const panggilan = siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await isiFormLengkap();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'bukan-email' } });
    fireEvent.click(screen.getByLabelText(PERNYATAAN_KEBENARAN_TEKS));
    fireEvent.click(tombolSimpan());

    expect(await screen.findByRole('alert')).toHaveTextContent(/email/i);
    expect(panggilan).toEqual([]);
  });

  it('profil lama tanpa email dianggap belum lengkap (gerbang tampil)', async () => {
    siapkan({
      profil: { nama: 'Budi Santoso', email: null, no_hp: '081234567890', asal_instansi: 'Unila', kategori: 'Umum' },
    });
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    expect(await screen.findByText('Lengkapi Profil Anda')).toBeInTheDocument();
    expect(screen.queryByText('ISI')).not.toBeInTheDocument();
  });

  it('profil lengkap langsung meneruskan children', async () => {
    siapkan({
      profil: { nama: 'Budi Santoso', email: 'b@x.id', no_hp: '081234567890', asal_instansi: 'Unila', kategori: 'Umum' },
    });
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    await waitFor(() => expect(screen.getByText('ISI')).toBeInTheDocument());
  });
});

describe('ProfileCompletenessGate K12: Nama Lengkap terkunci', () => {
  it('sebelum tersimpan: nama dapat disunting dan ada peringatan bahwa nama akan terkunci', async () => {
    siapkan();
    render(<ProfileCompletenessGate><p>ISI</p></ProfileCompletenessGate>);
    const nama = await screen.findByLabelText(/Nama Lengkap/);
    expect(nama).not.toHaveAttribute('readonly');
    expect(screen.getByText(/hubungi Front Office/)).toBeInTheDocument();
  });
});
