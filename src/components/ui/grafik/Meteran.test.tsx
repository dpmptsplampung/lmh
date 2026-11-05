// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Meteran from './Meteran';

afterEach(cleanup);

describe('Meteran', () => {
  it('role meter dengan nilai, rentang, dan teks yang bisa dibaca', () => {
    render(<Meteran label="Response rate survei" nilai={82.5} target={80} teks="Sesuai target 80%" />);
    const m = screen.getByRole('meter', { name: 'Response rate survei' });
    expect(m).toHaveAttribute('aria-valuenow', '82.5');
    expect(m).toHaveAttribute('aria-valuemin', '0');
    expect(m).toHaveAttribute('aria-valuemax', '100');
    expect(m).toHaveAttribute('aria-valuetext', '82,5 persen');
    expect(screen.getByText('Sesuai target 80%')).toBeInTheDocument();
    expect(m).toHaveTextContent('82,5');
  });

  it('nilai di atas maks dijepit pada busur tetapi angka asli tetap tampil', () => {
    const { container } = render(<Meteran label="x" nilai={150} />);
    const busur = container.querySelectorAll('path')[1];
    expect(busur.getAttribute('stroke-dashoffset')).toBe('0');
    expect(screen.getByRole('meter')).toHaveTextContent('150');
  });

  it('di bawah target memakai nada peringatan, di atas target sukses; garis target digambar', () => {
    const bawah = render(<Meteran label="x" nilai={50} target={80} />);
    expect(bawah.container.querySelectorAll('path')[1].getAttribute('class')).toMatch(/peringatan/);
    expect(bawah.container.querySelector('line')).not.toBeNull();
    cleanup();
    const atas = render(<Meteran label="x" nilai={90} target={80} />);
    expect(atas.container.querySelectorAll('path')[1].getAttribute('class')).toMatch(/sukses/);
  });

  it('satuan selain persen dibacakan apa adanya', () => {
    render(<Meteran label="Waktu tunggu" nilai={12} maks={30} satuan="mnt" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '12 mnt');
  });
});
