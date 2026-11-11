// @vitest-environment jsdom
// ModalAntrian: satu state union (utama + lapis QR) -> tujuh modal. Modal aslinya diganti tiruan yang memperlihatkan
// props sebagai atribut; yang diuji di sini hanya pemetaan jenis -> modal, props, dan kontrak penutup/berhasil.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

interface PropsDialog {
  tiket: Record<string, unknown>; mode?: string; onClose: () => void; onSuccess?: () => void | Promise<void>;
}
function TiruanDialog({ testId, tiket, mode, onClose, onSuccess }: PropsDialog & { testId: string }) {
  return (
    <div data-testid={testId} data-mode={mode ?? ''} data-tiket={JSON.stringify(tiket)}>
      <button type="button" onClick={async () => { await onSuccess?.(); onClose(); }}>{testId}: berhasil</button>
      <button type="button" onClick={() => onClose()}>{testId}: tutup</button>
    </div>
  );
}
vi.mock('@/components/admin/AmbilAlihTiketModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="ambil-alih" {...p} />,
}));
vi.mock('@/components/admin/AlihkanTiketModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="alihkan" {...p} />,
}));
vi.mock('@/components/admin/KembalikanKeFoModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="kembalikan" {...p} />,
}));
vi.mock('@/components/admin/SelesaiEskalasiModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="selesai-eskalasi" {...p} />,
}));
vi.mock('@/components/admin/KoreksiPelayananModal', () => ({
  default: ({ isOpen, tiketId, onClose, onSuccess }: {
    isOpen: boolean; tiketId: string | null; onClose: () => void; onSuccess?: () => void;
  }) => (
    <div data-testid="koreksi" data-open={String(isOpen)} data-tiket-id={tiketId ?? ''}>
      <button type="button" onClick={() => { onSuccess?.(); onClose(); }}>koreksi: berhasil</button>
    </div>
  ),
}));
vi.mock('@/components/admin/PelayananWizardModal', () => ({
  default: ({ isOpen, tiketId, onClose, onSuccess, onDataBasi }: {
    isOpen: boolean; tiketId: string | null; onClose: () => void; onSuccess?: () => void; onDataBasi?: () => void | Promise<void>;
  }) => (
    <div data-testid="wizard" data-open={String(isOpen)} data-tiket-id={tiketId ?? ''}>
      <button type="button" onClick={() => { onSuccess?.(); onClose(); }}>wizard: kunci</button>
      <button type="button" onClick={() => { void onDataBasi?.(); }}>wizard: data basi</button>
    </div>
  ),
}));
vi.mock('@/components/admin/SurveiQrDialog', () => ({
  default: ({ kunjunganId, onTutup }: { kunjunganId: string; onTutup: () => void }) => (
    <div data-testid="qr" data-kunjungan={kunjunganId}>
      <button type="button" onClick={onTutup}>qr: tutup</button>
    </div>
  ),
}));

import ModalAntrian from './ModalAntrian';
import type { ModalAntrian as StateModal } from '../_hook/useModalAntrian';
import { ADMIN, KOORDINATOR, buatTiket } from './tiketUji';

afterEach(cleanup);

function pasang(utama: StateModal, qr: StateModal = null, pengguna = ADMIN) {
  const p = {
    utama,
    qr,
    pengguna,
    tutup: vi.fn(),
    bukaQrTiket: vi.fn(),
    muatSenyap: vi.fn().mockResolvedValue(undefined),
  };
  render(<ModalAntrian {...p} />);
  return p;
}

const tiket = buatTiket({ id: 't-9', kunjungan_id: 'k-9', status: 'dilayani', dilayani_oleh: 'p-lain', pelayan: { nama: 'Budi' } });

describe('ModalAntrian', () => {
  it('tanpa modal terbuka: empat dialog tiket dan QR tidak dipasang; koreksi dan wizard terpasang tertutup', () => {
    pasang(null);
    for (const id of ['ambil-alih', 'alihkan', 'kembalikan', 'selesai-eskalasi', 'qr']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('koreksi')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('koreksi')).toHaveAttribute('data-tiket-id', '');
    expect(screen.getByTestId('wizard')).toHaveAttribute('data-open', 'false');
  });

  it('ambilAlih: tiket + nama pemilik; mode admin untuk Admin, koordinator_tiket untuk Koordinator', () => {
    pasang({ jenis: 'ambilAlih', tiket });
    const el = screen.getByTestId('ambil-alih');
    expect(JSON.parse(el.dataset.tiket as string)).toEqual({ id: 't-9', nomor_display: 'OS-001', pemilik_nama: 'Budi' });
    expect(el).toHaveAttribute('data-mode', 'admin');
    cleanup();
    pasang({ jenis: 'ambilAlih', tiket }, null, KOORDINATOR);
    expect(screen.getByTestId('ambil-alih')).toHaveAttribute('data-mode', 'koordinator_tiket');
  });

  it('alihkan: id, nomor, layanan_id, dan nama layanan', () => {
    pasang({ jenis: 'alihkan', tiket });
    expect(JSON.parse(screen.getByTestId('alihkan').dataset.tiket as string)).toEqual({
      id: 't-9', nomor_display: 'OS-001', layanan_id: 'l-oss', layanan_nama: 'Helpdesk OSS',
    });
  });

  it('kembalikanKeFo dan selesaiEskalasi: id, nomor, layanan_id', () => {
    pasang({ jenis: 'kembalikanKeFo', tiket });
    expect(JSON.parse(screen.getByTestId('kembalikan').dataset.tiket as string)).toEqual({
      id: 't-9', nomor_display: 'OS-001', layanan_id: 'l-oss',
    });
    cleanup();
    pasang({ jenis: 'selesaiEskalasi', tiket });
    expect(JSON.parse(screen.getByTestId('selesai-eskalasi').dataset.tiket as string)).toEqual({
      id: 't-9', nomor_display: 'OS-001', layanan_id: 'l-oss',
    });
  });

  it('hanya modal berjenis itu yang dipasang', () => {
    pasang({ jenis: 'alihkan', tiket });
    expect(screen.queryByTestId('ambil-alih')).toBeNull();
    expect(screen.queryByTestId('kembalikan')).toBeNull();
    expect(screen.queryByTestId('selesai-eskalasi')).toBeNull();
  });

  it('koreksi dan wizard: terbuka dengan id tiket', () => {
    pasang({ jenis: 'koreksi', tiket });
    expect(screen.getByTestId('koreksi')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('koreksi')).toHaveAttribute('data-tiket-id', 't-9');
    expect(screen.getByTestId('wizard')).toHaveAttribute('data-open', 'false');
    cleanup();
    pasang({ jenis: 'wizard', tiket });
    expect(screen.getByTestId('wizard')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('wizard')).toHaveAttribute('data-tiket-id', 't-9');
  });

  it('penutup memanggil tutup(jenis) milik modal itu', () => {
    const p = pasang({ jenis: 'alihkan', tiket });
    fireEvent.click(screen.getByText('alihkan: tutup'));
    expect(p.tutup).toHaveBeenCalledWith('alihkan');
  });

  it('dialog tiket: berhasil = muatSenyap lalu tutup (urutan await onSuccess; onClose)', async () => {
    const urutan: string[] = [];
    const p = pasang({ jenis: 'ambilAlih', tiket });
    p.muatSenyap.mockImplementation(async () => { urutan.push('muat'); });
    p.tutup.mockImplementation(() => { urutan.push('tutup'); });
    fireEvent.click(screen.getByText('ambil-alih: berhasil'));
    await vi.waitFor(() => expect(urutan).toEqual(['muat', 'tutup']));
  });

  it('selesaiEskalasi berhasil: membuka QR tiketnya lalu memuat ulang', async () => {
    const p = pasang({ jenis: 'selesaiEskalasi', tiket });
    fireEvent.click(screen.getByText('selesai-eskalasi: berhasil'));
    await vi.waitFor(() => expect(p.muatSenyap).toHaveBeenCalledTimes(1));
    expect(p.bukaQrTiket).toHaveBeenCalledWith('t-9');
    expect(p.bukaQrTiket.mock.invocationCallOrder[0]).toBeLessThan(p.muatSenyap.mock.invocationCallOrder[0]);
    await vi.waitFor(() => expect(p.tutup).toHaveBeenCalledWith('selesaiEskalasi'));
  });

  it('koreksi berhasil memuat ulang; wizard terkunci membuka QR lalu memuat ulang; data basi memuat ulang', async () => {
    const p = pasang({ jenis: 'koreksi', tiket });
    fireEvent.click(screen.getByText('koreksi: berhasil'));
    expect(p.muatSenyap).toHaveBeenCalledTimes(1);
    expect(p.tutup).toHaveBeenCalledWith('koreksi');
    cleanup();
    const w = pasang({ jenis: 'wizard', tiket });
    fireEvent.click(screen.getByText('wizard: kunci'));
    await vi.waitFor(() => expect(w.muatSenyap).toHaveBeenCalledTimes(1));
    expect(w.bukaQrTiket).toHaveBeenCalledWith('t-9');
    expect(w.tutup).toHaveBeenCalledWith('wizard');
    fireEvent.click(screen.getByText('wizard: data basi'));
    expect(w.muatSenyap).toHaveBeenCalledTimes(2);
  });

  it('wizard tanpa tiket meneruskan null ke bukaQrTiket (hook mengabaikannya)', async () => {
    const p = pasang(null);
    fireEvent.click(screen.getByText('wizard: kunci'));
    await vi.waitFor(() => expect(p.muatSenyap).toHaveBeenCalledTimes(1));
    expect(p.bukaQrTiket).toHaveBeenCalledWith(null);
  });

  it('QR: lapis sendiri, tampil bersama dialog sumber; penutup menutup jenis surveiQr', () => {
    const p = pasang({ jenis: 'wizard', tiket }, { jenis: 'surveiQr', tiket });
    expect(screen.getByTestId('wizard')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('qr')).toHaveAttribute('data-kunjungan', 'k-9');
    fireEvent.click(screen.getByText('qr: tutup'));
    expect(p.tutup).toHaveBeenCalledWith('surveiQr');
  });
});
