// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import GrafikBatang from './GrafikBatang';
import { stubGerakDikurangi, stubUkuranGrafik } from './stubUkuran';

beforeAll(() => {
  stubUkuranGrafik();
  stubGerakDikurangi();
});
afterEach(cleanup);

const DATA = [
  { hari: 'Sen', jumlah: 40 },
  { hari: 'Sel', jumlah: 95 },
  { hari: 'Rab', jumlah: 60 },
];

describe('GrafikBatang', () => {
  it('batang disorot biru, lainnya abu muda, keduanya dari token', () => {
    const { container } = render(<GrafikBatang label="Hari tersibuk" data={DATA} sumbuX="hari" nilai="jumlah" labelNilai="Kunjungan" sorot={['Sel']} />);
    const batang = Array.from(container.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect'));
    const warna = batang.map((b) => b.getAttribute('fill'));
    expect(warna).toContain('var(--chart-1)');
    expect(warna).toContain('var(--chart-bar-muted)');
    expect(warna.filter((w) => w === 'var(--chart-1)')).toHaveLength(1);
  });

  it('label angka hanya pada batang tersorot (bawaan) sehingga makna tidak hanya di warna', () => {
    const { container } = render(<GrafikBatang label="x" data={DATA} sumbuX="hari" nilai="jumlah" labelNilai="Kunjungan" sorot={(b) => b.jumlah === 95} />);
    const teks = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    expect(teks).toContain('95');
    expect(teks).not.toContain('40');
  });

  it('labelAngka="semua" menampilkan semua dengan format id-ID', () => {
    const { container } = render(<GrafikBatang label="x" data={[{ hari: 'A', jumlah: 12345 }]} sumbuX="hari" nilai="jumlah" labelNilai="Jumlah" labelAngka="semua" />);
    expect(Array.from(container.querySelectorAll('text')).map((t) => t.textContent)).toContain('12.345');
  });
});
