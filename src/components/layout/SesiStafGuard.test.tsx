// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ sisa: null as number | null }));
vi.mock('@/lib/hooks/useSesiStaf', () => ({ useSesiStaf: () => ({ sisaTutupDetik: h.sisa }) }));

import SesiStafGuard from './SesiStafGuard';

describe('SesiStafGuard', () => {
  afterEach(cleanup);

  it('tidak menampilkan apa pun bila tidak ada peringatan tutup', () => {
    h.sisa = null;
    const { container } = render(<SesiStafGuard />);
    expect(container.firstChild).toBeNull();
  });

  it('menampilkan peringatan role=alert berbahasa Indonesia saat tutup', () => {
    h.sisa = 42;
    render(<SesiStafGuard />);
    expect(screen.getByRole('alert').textContent).toMatch(/Layanan sudah tutup.*keluar otomatis/);
    expect(screen.getByText('42 dtk')).toBeTruthy();
  });
});
