// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TindakanDarurat from './TindakanDarurat';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('hasil tidak pasti mempertahankan kunci dan isian berubah memakai kunci baru', async () => {
  const request = vi.fn().mockRejectedValue(new TypeError('Jaringan'));
  vi.stubGlobal('fetch', request);
  render(<TindakanDarurat terbuka profil={{ id: 'profil-uji', nama: 'Kopi', status: 'terbit', versi: 2 }}
    aksi="catat_pencabutan" onTutup={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Alasan singkat' }), { target: { value: 'Permintaan pemilik' } });
  const send = () => fireEvent.click(screen.getByRole('button', { name: 'Catat pencabutan' }));
  send(); await screen.findByRole('alert');
  const first = JSON.parse(request.mock.calls[0][1].body);
  send(); await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Catat pencabutan' })).not.toHaveAttribute('aria-busy'));
  expect(JSON.parse(request.mock.calls[1][1].body).operasi_id).toBe(first.operasi_id);
  fireEvent.change(screen.getByRole('textbox', { name: 'Alasan singkat' }), {
    target: { value: 'Pemilik menghubungi loket' },
  });
  send(); await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(JSON.parse(request.mock.calls[2][1].body).operasi_id).not.toBe(first.operasi_id);
});

it('409 tanpa kontak tetap tenang, tidak mengutip data internal, dan memfokuskan galat', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ error: { code: 'KONFLIK_STATUS', message: 'nomor privat internal' } }), { status: 409 })));
  render(<TindakanDarurat terbuka profil={{ id: 'profil-uji', nama: 'Kopi', status: 'terbit', versi: 2 }}
    aksi="catat_pencabutan" onTutup={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Alasan singkat' }), { target: { value: 'Permintaan pemilik' } });
  fireEvent.click(screen.getByRole('button', { name: 'Catat pencabutan' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Tindakan belum dapat dilakukan pada kondisi profil ini');
  await waitFor(() => expect(alert).toHaveFocus());
  expect(alert).not.toHaveTextContent('nomor privat internal');
});
