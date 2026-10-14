// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import WalkinWizard from './WalkinWizard';

// WalkinWizard dipensiunkan (UI-2, K3): tidak lagi menulis ke `visit`; hanya tautan ke pendaftaran FO.
describe('WalkinWizard (shim tautan ke pendaftaran FO)', () => {
  afterEach(cleanup);

  it('merender tautan ke /admin/fo/daftar dengan label dan kelas dari props', () => {
    render(<WalkinWizard triggerLabel="+ Walk-in" triggerClassName="btn btn--sm" fixedLayananId="l-1" />);
    const tautan = screen.getByRole('link', { name: /\+ Walk-in/ });
    expect(tautan).toHaveAttribute('href', '/admin/fo/daftar');
    expect(tautan).toHaveClass('btn', 'btn--sm');
  });

  it('tidak menyentuh Supabase / tabel visit (sumber statis)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/WalkinWizard.tsx'), 'utf8');
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/from\(\s*['"]visit['"]\s*\)/);
  });
});
