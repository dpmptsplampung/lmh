// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PendataanKhususFields from './PendataanKhususFields';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

const f = (o: Partial<FieldKhusus> & Pick<FieldKhusus, 'id' | 'jenis' | 'label'>): FieldKhusus => ({
  layanan_id: 'l', wajib: false, opsi: [], urut: 0, tersembunyi: false, pernah_diisi: false, ...o,
});
afterEach(cleanup);

describe('PendataanKhususFields', () => {
  it('merender ketujuh jenis dengan label terhubung dan penanda wajib', () => {
    const fields = [
      f({ id: 'a', jenis: 'teks_singkat', label: 'Teks', wajib: true }),
      f({ id: 'b', jenis: 'teks_panjang', label: 'Panjang' }),
      f({ id: 'c', jenis: 'angka', label: 'Jumlah' }),
      f({ id: 'd', jenis: 'tanggal', label: 'Tanggal surat' }),
      f({ id: 'e', jenis: 'pilihan_tunggal', label: 'Jenis', opsi: ['X', 'Y'] }),
      f({ id: 'g', jenis: 'pilihan_ganda', label: 'Dokumen', opsi: ['KTP', 'NPWP'] }),
      f({ id: 'h', jenis: 'ya_tidak', label: 'Lengkap?' }),
    ];
    render(<PendataanKhususFields idDasar="x" fields={fields} nilai={{}} onNilai={vi.fn()} galat={{}} />);
    const teks = screen.getByLabelText('Teks') as HTMLInputElement;
    expect(teks.getAttribute('aria-required')).toBe('true');
    expect((screen.getByLabelText(/Jumlah/) as HTMLInputElement).type).toBe('number');
    expect((screen.getByLabelText(/Tanggal surat/) as HTMLInputElement).type).toBe('date');
    expect((screen.getByLabelText(/Jenis/) as HTMLSelectElement).tagName).toBe('SELECT');
    expect(screen.getByRole('group', { name: /^Dokumen/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /^Lengkap\?/ })).toBeTruthy();
  });

  it('pilihan ganda mengirim array; ya/tidak mengirim "ya"; teks mengirim string', () => {
    const onNilai = vi.fn();
    const fields = [
      f({ id: 'g', jenis: 'pilihan_ganda', label: 'Dokumen', opsi: ['KTP', 'NPWP'] }),
      f({ id: 'h', jenis: 'ya_tidak', label: 'Lengkap?' }),
      f({ id: 'a', jenis: 'teks_singkat', label: 'Teks' }),
    ];
    render(<PendataanKhususFields idDasar="x" fields={fields} nilai={{ g: ['KTP'] }} onNilai={onNilai} galat={{}} />);
    fireEvent.click(screen.getByLabelText('NPWP'));
    expect(onNilai).toHaveBeenCalledWith('g', ['KTP', 'NPWP']);
    fireEvent.click(screen.getByLabelText('Ya'));
    expect(onNilai).toHaveBeenCalledWith('h', 'ya');
    fireEvent.change(screen.getByLabelText(/Teks/), { target: { value: 'halo' } });
    expect(onNilai).toHaveBeenCalledWith('a', 'halo');
  });

  it('galat tampil role=alert dan dirujuk aria-describedby; isian tersembunyi tidak ditampilkan', () => {
    const fields = [f({ id: 'a', jenis: 'teks_singkat', label: 'Teks', wajib: true }), f({ id: 'z', jenis: 'teks_singkat', label: 'Rahasia', tersembunyi: true })];
    render(<PendataanKhususFields idDasar="x" fields={fields} nilai={{}} onNilai={vi.fn()} galat={{ a: 'Teks wajib diisi.' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Teks wajib diisi.');
    expect(screen.getByLabelText('Teks').getAttribute('aria-describedby')).toBe(alert.id);
    expect(screen.queryByLabelText(/Rahasia/)).toBeNull();
  });

  it('kelompok (ya/tidak, pilihan ganda) menyatakan wajib/opsional lewat teks legenda, konsisten dengan input lain', () => {
    const fields = [
      f({ id: 'g', jenis: 'pilihan_ganda', label: 'Dokumen', wajib: true, opsi: ['KTP', 'NPWP'] }),
      f({ id: 'h', jenis: 'ya_tidak', label: 'Lengkap?', wajib: false }),
      f({ id: 'k', jenis: 'ya_tidak', label: 'Setuju?', wajib: true }),
    ];
    render(<PendataanKhususFields idDasar="x" fields={fields} nilai={{}} onNilai={vi.fn()} galat={{}} />);
    expect(screen.getByRole('group', { name: /^Dokumen.*wajib/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /^Setuju\?.*wajib/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /^Lengkap\?.*\(Opsional\)/ })).toBeTruthy();
  });
});
