// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BarisTambah, SelTeksInline } from './SuntingInline';

afterEach(cleanup);

const dalamTabel = (n: React.ReactNode) => (
  <table><tbody>{n}</tbody></table>
);

describe('SelTeksInline', () => {
  const siap = (onSimpan = vi.fn().mockResolvedValue(null), props: Partial<React.ComponentProps<typeof SelTeksInline>> = {}) => {
    render(<SelTeksInline nilai="Lama" label="nama contoh" onSimpan={onSimpan} {...props} />);
    return onSimpan;
  };
  const buka = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ubah nama contoh' }));
    return screen.getByRole('textbox', { name: 'Nama contoh' });
  };

  it('klik membuka input terisi dan berfokus; Enter menyimpan nilai terpangkas, mengumumkan hasil, fokus kembali ke tombol', async () => {
    const onSimpan = siap();
    const input = buka();
    expect(input).toHaveValue('Lama');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Baru ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSimpan).toHaveBeenCalledWith('Baru'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByRole('button', { name: 'Ubah nama contoh' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Nama contoh disimpan.');
  });

  it('blur menyimpan tanpa mengambil fokus; Esc membatalkan', async () => {
    const onSimpan = siap();
    let input = buka();
    fireEvent.change(input, { target: { value: 'Lewat blur' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSimpan).toHaveBeenCalledWith('Lewat blur'));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByRole('button', { name: 'Ubah nama contoh' })).not.toHaveFocus();

    onSimpan.mockClear();
    input = buka();
    fireEvent.change(input, { target: { value: 'Batal' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onSimpan).not.toHaveBeenCalled();
  });

  it('galat dari penyimpan tampil di bawah input (aria-describedby, aria-invalid) dan input tetap terbuka; aria-busy saat menyimpan', async () => {
    let selesai: (v: string | null) => void = () => {};
    const onSimpan = vi.fn(() => new Promise<string | null>((r) => { selesai = r; }));
    siap(onSimpan);
    const input = buka();
    fireEvent.change(input, { target: { value: 'Baru' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveAttribute('aria-busy', 'true'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSimpan).toHaveBeenCalledTimes(1);
    selesai('Nama sudah dipakai');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nama sudah dipakai');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input).not.toHaveAttribute('aria-busy');
  });

  it('validasi klien menolak tanpa memanggil penyimpan; nilai sama tidak memanggil penyimpan; bacaSaja = teks biasa', () => {
    const onSimpan = siap(undefined, { validasi: (v) => (v.length < 3 ? 'Terlalu pendek' : null) });
    const input = buka();
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Terlalu pendek');
    fireEvent.change(input, { target: { value: ' Lama ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSimpan).not.toHaveBeenCalled();
    cleanup();
    render(<SelTeksInline nilai="Tetap" label="x" bacaSaja onSimpan={onSimpan} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Tetap')).toBeTruthy();
  });
});

describe('BarisTambah', () => {
  it('Enter atau tombol menambah; berhasil mengosongkan isian dan mengembalikan fokus; galat tampil dengan role=alert', async () => {
    const onTambah = vi.fn()
      .mockResolvedValueOnce('Sudah ada')
      .mockResolvedValueOnce(null);
    render(dalamTabel(
      <BarisTambah kolom={2} ariaTombol="Tambah contoh" onTambah={onTambah}
        bidang={[{ kunci: 'nama', label: 'Nama baru', placeholder: '+ Tambah' }]} />,
    ));
    const input = screen.getByRole('textbox', { name: 'Nama baru' });
    fireEvent.change(input, { target: { value: 'X1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sudah ada');
    expect(input).toHaveValue('X1');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tambah contoh' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(onTambah).toHaveBeenLastCalledWith({ nama: 'X1' });
    expect(input).toHaveFocus();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bidang pilih/kotak/area: area hanya tampil bila tampilJika terpenuhi; nonaktif menampilkan keterangan', async () => {
    const onTambah = vi.fn().mockResolvedValue(null);
    const { rerender } = render(dalamTabel(
      <BarisTambah kolom={4} onTambah={onTambah}
        bidang={[
          { kunci: 'a', label: 'Isian A' },
          { kunci: 'j', label: 'Jenis', jenis: 'pilih', awal: 'x', opsi: [{ nilai: 'x', label: 'X' }, { nilai: 'p', label: 'Pilihan' }] },
          { kunci: 'w', label: 'Wajib', jenis: 'kotak' },
          { kunci: 'o', label: 'Opsi', jenis: 'area', tampilJika: (n) => n.j === 'p' },
        ]} />,
    ));
    expect(screen.queryByLabelText('Opsi')).toBeNull();
    fireEvent.change(screen.getByLabelText('Jenis'), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText('Opsi'), { target: { value: 'a\nb' } });
    fireEvent.change(screen.getByLabelText('Isian A'), { target: { value: 'nama' } });
    fireEvent.click(screen.getByLabelText('Wajib'));
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    await waitFor(() => expect(onTambah).toHaveBeenCalledWith({ a: 'nama', j: 'p', w: 'true', o: 'a\nb' }));
    rerender(dalamTabel(<BarisTambah kolom={4} onTambah={onTambah} bidang={[]} nonaktif ketNonaktif="Batas tercapai." />));
    expect(screen.getByText('Batas tercapai.')).toBeTruthy();
  });
});
