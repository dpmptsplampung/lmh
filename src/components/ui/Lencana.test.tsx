// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import Lencana from './Lencana';

afterEach(cleanup);

describe('Lencana', () => {
  it('membawa makna lewat teks, ikon disembunyikan dari pembaca layar', () => {
    const { container } = render(
      <Lencana nada="peringatan" ikon={Clock}>
        Menunggu
      </Lencana>,
    );
    expect(screen.getByText('Menunggu')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('titik bersifat dekoratif', () => {
    const { container } = render(<Lencana titik>Aktif</Lencana>);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Aktif')).toBeInTheDocument();
  });
});
