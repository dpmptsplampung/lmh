// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Field from './Field';

afterEach(cleanup);

describe('Field', () => {
  it('label terhubung ke input dan bantuan menjadi aria-describedby', () => {
    render(
      <Field label="Nama lengkap" bantuan="Sesuai KTP">
        <input type="text" />
      </Field>,
    );
    const input = screen.getByLabelText('Nama lengkap');
    expect(input).toHaveAccessibleDescription('Sesuai KTP');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('galat menandai aria-invalid, terbaca sebagai deskripsi, dan role alert', () => {
    render(
      <Field label="Email" bantuan="Aktif" galat="Format email salah" wajib>
        <input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription('Aktif Format email salah');
    expect(screen.getByRole('alert')).toHaveTextContent('Format email salah');
  });

  it('mempertahankan id dan aria-describedby milik anak', () => {
    render(
      <Field label="Catatan" bantuan="Singkat">
        <textarea id="catatan-saya" aria-describedby="lain" />
      </Field>,
    );
    const ta = screen.getByLabelText('Catatan');
    expect(ta).toHaveAttribute('id', 'catatan-saya');
    expect(ta.getAttribute('aria-describedby')).toContain('lain');
  });

  it('mendukung anak berupa fungsi', () => {
    render(
      <Field label="Layanan" galat="Pilih satu">
        {(p) => (
          <select {...p}>
            <option>A</option>
          </select>
        )}
      </Field>,
    );
    expect(screen.getByLabelText('Layanan')).toHaveAttribute('aria-invalid', 'true');
  });
});
