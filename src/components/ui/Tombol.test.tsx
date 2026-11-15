// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArrowRight, Plus } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Tombol from './Tombol';

afterEach(cleanup);

describe('Tombol', () => {
  it('berupa <button type="button"> dan memanggil onClick', () => {
    const onClick = vi.fn();
    render(
      <Tombol onClick={onClick} ikon={Plus}>
        Tambah
      </Tombol>,
    );
    const b = screen.getByRole('button', { name: 'Tambah' });
    expect(b).toHaveAttribute('type', 'button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('type="submit" dipertahankan', () => {
    render(<Tombol type="submit">Kirim</Tombol>);
    expect(screen.getByRole('button', { name: 'Kirim' })).toHaveAttribute('type', 'submit');
  });

  it('memuat: aria-busy, teks tetap, klik diabaikan, fokus tidak hilang (bukan disabled)', () => {
    const onClick = vi.fn();
    render(
      <Tombol memuat onClick={onClick}>
        Panggil
      </Tombol>,
    );
    const b = screen.getByRole('button', { name: 'Panggil' });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).not.toBeDisabled();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    b.focus();
    expect(b).toHaveFocus();
  });

  it('memuat pada tombol submit tidak mengirim formulir', () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Tombol type="submit" memuat>
          Simpan
        </Tombol>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('dengan href menjadi tautan', () => {
    render(<Tombol href="/admin/antrian" varian="sekunder">Buka antrean</Tombol>);
    expect(screen.getByRole('link', { name: 'Buka antrean' })).toHaveAttribute('href', '/admin/antrian');
  });

  it('tautan eksternal memakai <a> biasa dan rel aman untuk _blank', () => {
    render(
      <Tombol href="https://contoh.id" target="_blank">
        Situs
      </Tombol>,
    );
    const a = screen.getByRole('link', { name: 'Situs' });
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('tombol disabled bawaan tetap bekerja dan atribut desain tidak bocor ke DOM', () => {
    const { container } = render(
      <Tombol disabled varian="bahaya" ukuran="kecil">
        Hapus
      </Tombol>,
    );
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
    expect(container.querySelector('[varian],[ukuran]')).toBeNull();
  });

  it('meneruskan ref ke elemen <button> (untuk mengembalikan fokus)', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Tombol ref={ref}>Simpan</Tombol>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Simpan' }));
  });
  it('ukuran="besar" dan varian="aksen" menambah kelas masing-masing', () => {
    render(
      <Tombol ukuran="besar" varian="aksen">
        Mulai
      </Tombol>,
    );
    const b = screen.getByRole('button', { name: 'Mulai' });
    expect(b.className).toMatch(/besar/);
    expect(b.className).toMatch(/aksen/);
    expect(b.className).not.toMatch(/utama/);
  });

  it('ikonAkhir dirender di belakang teks dan disembunyikan dari pembaca layar', () => {
    const { container } = render(
      <Tombol ikonAkhir={ArrowRight} ikon={Plus}>
        Lanjut
      </Tombol>,
    );
    const b = screen.getByRole('button', { name: 'Lanjut' });
    const svg = container.querySelectorAll('svg');
    expect(svg).toHaveLength(2);
    svg.forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
    // Urutan anak: ikon depan, teks, ikon akhir.
    expect(b.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(b.children[1].tagName.toLowerCase()).toBe('span');
    expect(b.lastElementChild?.tagName.toLowerCase()).toBe('svg');
  });

  it('ikonAkhir bekerja juga pada tautan, dan tidak bocor ke DOM', () => {
    const { container } = render(
      <Tombol href="/x" ikonAkhir={ArrowRight}>
        Buka
      </Tombol>,
    );
    const a = screen.getByRole('link', { name: 'Buka' });
    expect(a.lastElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('[ikonakhir],[ikonAkhir]')).toBeNull();
  });

  it('memuat dengan ikonAkhir: spinner menggantikan ikon akhir, lebar tetap (satu svg)', () => {
    const { container } = render(
      <Tombol memuat ikonAkhir={ArrowRight}>
        Kirim
      </Tombol>,
    );
    const svg = container.querySelectorAll('svg');
    expect(svg).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Kirim' }).lastElementChild).toBe(svg[0]);
  });
});
