// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cariMock, ambilMock } = vi.hoisted(() => ({ cariMock: vi.fn(), ambilMock: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/fo/cari-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/fo/cari-pengunjung')>()),
  cariPengunjung: cariMock,
  ambilPengunjung: ambilMock,
}));

import InputSaranPengunjung, { JEDA_CARI_MS } from './InputSaranPengunjung';

const siti = { id: 'k-1', nama: 'Siti Aminah', hpSamar: '0812****890', asal: 'CV Sentosa', tanggal: '2026-09-01' };
const budi = { id: 'k-2', nama: 'Budi Santoso', hpSamar: '0813****111', asal: 'PT Maju', tanggal: '2026-08-01' };
const identitas = { nama: 'Siti Aminah', asal_instansi: 'CV Sentosa', kategori: 'UMKM', email: '', kontak_hp: '081234567890' };

function Inang({
  jenis = 'nama',
  aktif = true,
  onPilih = vi.fn(),
  onTidakTersedia,
  onKeyDown,
}: {
  jenis?: 'nama' | 'hp';
  aktif?: boolean;
  onPilih?: (d: unknown) => void;
  onTidakTersedia?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const [nilai, setNilai] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="isian">Isian</label>
      <InputSaranPengunjung
        id="isian"
        jenis={jenis}
        aktif={aktif}
        value={nilai}
        onChange={setNilai}
        onPilih={onPilih as never}
        onTidakTersedia={onTidakTersedia}
        onKeyDown={onKeyDown}
      />
      <button type="button">Lain</button>
    </form>
  );
}

const input = () => screen.getByLabelText('Isian') as HTMLInputElement;
const ketik = (v: string) => fireEvent.change(input(), { target: { value: v } });
const lewatJeda = () => act(async () => void (await vi.advanceTimersByTimeAsync(JEDA_CARI_MS + 10)));

describe('InputSaranPengunjung (combobox pada isian Nama/HP)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cariMock.mockReset();
    ambilMock.mockReset();
    cariMock.mockResolvedValue({ status: 'ok', hasil: [siti, budi] });
    ambilMock.mockResolvedValue({ status: 'ok', data: identitas });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('debounce: banyak ketikan cepat hanya memanggil server sekali, setelah jeda, dengan nilai terakhir', async () => {
    render(<Inang />);
    ketik('Sit');
    await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
    ketik('Siti');
    await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
    ketik('Siti A');
    expect(cariMock).not.toHaveBeenCalled();
    await lewatJeda();
    expect(cariMock).toHaveBeenCalledTimes(1);
    expect(cariMock.mock.calls[0][1]).toBe('Siti A');
  });

  it('di bawah 3 karakter / 3 digit: tidak mencari dan tidak ada daftar; jenis harus cocok dengan isian', async () => {
    const { unmount } = render(<Inang />);
    ketik('Si');
    await lewatJeda();
    ketik('0812');
    await lewatJeda();
    expect(cariMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    unmount();
    render(<Inang jenis="hp" />);
    ketik('Budi');
    await lewatJeda();
    expect(cariMock).not.toHaveBeenCalled();
  });

  it('pola ARIA combobox: role, aria-expanded, aria-controls, aria-activedescendant, opsi ber-aria-selected', async () => {
    render(<Inang />);
    expect(input()).toHaveAttribute('role', 'combobox');
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    ketik('Siti');
    await lewatJeda();
    const daftar = screen.getByRole('listbox');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveAttribute('aria-controls', daftar.id);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const opsi = screen.getAllByRole('option');
    expect(opsi[0]).toHaveAttribute('aria-selected', 'true');
    expect(input()).toHaveAttribute('aria-activedescendant', opsi[0].id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
  });

  it('Enter memilih opsi yang disorot (tanpa meneruskan Enter ke induk); tanpa sorotan Enter diteruskan', async () => {
    const onPilih = vi.fn();
    const onKeyDown = vi.fn();
    render(<Inang onPilih={onPilih} onKeyDown={onKeyDown} />);
    ketik('Siti');
    await lewatJeda();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(ambilMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    onKeyDown.mockClear();
    await act(async () => {
      fireEvent.keyDown(input(), { key: 'Enter' });
    });
    expect(ambilMock).toHaveBeenCalledWith(expect.anything(), 'k-1');
    expect(onPilih).toHaveBeenCalledWith(identitas);
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Esc menutup daftar tanpa menghapus ketikan; Esc saat tertutup tidak dibajak', async () => {
    const onKeyDown = vi.fn();
    render(<Inang onKeyDown={onKeyDown} />);
    ketik('Siti');
    await lewatJeda();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().value).toBe('Siti');
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('Tab tidak dibajak: tidak memilih dan tidak dicegah', async () => {
    render(<Inang />);
    ketik('Siti');
    await lewatJeda();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const tidakDicegah = fireEvent.keyDown(input(), { key: 'Tab' });
    expect(tidakDicegah).toBe(true);
    expect(ambilMock).not.toHaveBeenCalled();
  });

  it('klik/sentuh pada opsi memilih; mousedown dicegah agar fokus input tidak hilang', async () => {
    const onPilih = vi.fn();
    render(<Inang onPilih={onPilih} />);
    ketik('Siti');
    await lewatJeda();
    const opsi = screen.getAllByRole('option')[0];
    const dilepas = fireEvent.mouseDown(opsi);
    expect(dilepas).toBe(false); // preventDefault dipanggil
    await act(async () => {
      fireEvent.click(opsi);
    });
    expect(onPilih).toHaveBeenCalledWith(identitas);
  });

  it('blur menutup daftar (setelah jeda singkat) tanpa menelan klik yang tiba setelah blur', async () => {
    const onPilih = vi.fn();
    render(<Inang onPilih={onPilih} />);
    ketik('Siti');
    await lewatJeda();
    const opsi = screen.getAllByRole('option')[0];
    fireEvent.blur(input());
    // klik sampai segera setelah blur: masih terbaca
    await act(async () => {
      fireEvent.click(opsi);
    });
    expect(onPilih).toHaveBeenCalledTimes(1);

    ketik('Budi');
    await lewatJeda();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.blur(input());
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hanya hasil permintaan TERBARU yang tampil; permintaan lama dibatalkan dan hasilnya dibuang', async () => {
    let selesaiLama: (v: unknown) => void = () => {};
    const sinyal: AbortSignal[] = [];
    cariMock.mockImplementationOnce((_c: unknown, _q: string, s: AbortSignal) => {
      sinyal.push(s);
      return new Promise((ok) => {
        selesaiLama = ok;
      });
    });
    cariMock.mockImplementationOnce(async (_c: unknown, _q: string, s: AbortSignal) => {
      sinyal.push(s);
      return { status: 'ok', hasil: [budi] };
    });
    render(<Inang />);
    ketik('Sit');
    await lewatJeda(); // permintaan 1 menggantung
    ketik('Bud');
    await lewatJeda(); // permintaan 2 selesai
    expect(sinyal[0].aborted).toBe(true);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Budi Santoso');
    await act(async () => selesaiLama({ status: 'ok', hasil: [siti] })); // jawaban basi datang terlambat
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Budi Santoso');
  });

  it('tanpa kedip: daftar lama tetap tampil selama menunggu hasil baru; menghapus ketikan menutupnya', async () => {
    render(<Inang />);
    ketik('Siti');
    await lewatJeda();
    cariMock.mockImplementationOnce(() => new Promise(() => {}));
    ketik('Siti Am');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await lewatJeda();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    ketik('Si');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('galat/lambat: diam-diam tanpa daftar atau pesan; ketikan tidak terblokir', async () => {
    cariMock.mockResolvedValue({ status: 'galat' });
    render(<Inang />);
    ketik('Siti');
    await lewatJeda();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    ketik('Siti Aminah');
    expect(input().value).toBe('Siti Aminah');
    expect(input()).not.toBeDisabled();
  });

  it('RPC dinyatakan tidak tersedia: memberi tahu induk', async () => {
    cariMock.mockResolvedValue({ status: 'tidak_tersedia' });
    const onTidakTersedia = vi.fn();
    render(<Inang onTidakTersedia={onTidakTersedia} />);
    ketik('Siti');
    await lewatJeda();
    expect(onTidakTersedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('pengambilan identitas gagal: pesan tidak memblokir, isian tidak diubah', async () => {
    ambilMock.mockResolvedValue({ status: 'dibatasi' });
    const onPilih = vi.fn();
    render(<Inang onPilih={onPilih} />);
    ketik('Siti');
    await lewatJeda();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('option')[0]);
    });
    expect(onPilih).not.toHaveBeenCalled();
    expect(screen.getByText(/Terlalu banyak pengambilan data/)).toBeInTheDocument();
    expect(input().value).toBe('Siti');
    expect(input()).not.toBeDisabled();
  });

  it('pengguna mengetik lagi selagi identitas diambil: hasil lambat tidak menimpa isian', async () => {
    let selesai: (v: unknown) => void = () => {};
    ambilMock.mockImplementation(() => new Promise((ok) => (selesai = ok)));
    const onPilih = vi.fn();
    render(<Inang onPilih={onPilih} />);
    ketik('Siti');
    await lewatJeda();
    fireEvent.click(screen.getAllByRole('option')[0]);
    ketik('Siti Baru');
    await act(async () => selesai({ status: 'ok', data: identitas }));
    expect(onPilih).not.toHaveBeenCalled();
  });

  it('aktif=false: input biasa tanpa atribut combobox dan tanpa pencarian', async () => {
    render(<Inang aktif={false} />);
    expect(input()).not.toHaveAttribute('role');
    ketik('Siti Aminah');
    await lewatJeda();
    expect(cariMock).not.toHaveBeenCalled();
    expect(input().value).toBe('Siti Aminah');
  });

  it('opsi hari ini diberi peringatan pendaftaran ganda', async () => {
    const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    cariMock.mockResolvedValue({ status: 'ok', hasil: [{ ...siti, tanggal: hariIni }] });
    render(<Inang />);
    ketik('Siti');
    await lewatJeda();
    expect(screen.getByRole('option')).toHaveTextContent(/pendaftaran ganda/);
  });
});
