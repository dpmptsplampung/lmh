// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@/components/admin/RekapPenangananTable', () => ({
  default: ({ peran }: { peran: string }) => <div data-testid="tabel">{`peran=${peran}`}</div>,
}));

import RekapFoPage from './page';

describe('/admin/rekap-fo', () => {
  afterEach(() => cleanup());

  it('menampilkan rekap peran fo', () => {
    render(<RekapFoPage />);
    expect(screen.getByRole('heading', { name: /rekap front office/i })).toBeInTheDocument();
    expect(screen.getByTestId('tabel')).toHaveTextContent('peran=fo');
  });
});
