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
vi.mock('@/components/admin/SelesaiLayananModal', () => ({
  default: (p: PropsDialog) => <TiruanDialog testId="selesai-layanan" {...p} />,
}));
vi.mock('@/components/admin/mulai-layanan/MulaiLayananWizard', () => ({
  default: ({ tiket, langkahAwal, bolehUbah, onClose, onLanjutForm, onDataBasi }: {
    tiket: Record<string, unknown>; langkahAwal: number; bolehUbah: boolean; onClose: () => void;
    onLanjutForm: () => void; onDataBasi?: () => void | Promise<void>;
  }) => (
    <div data-testid="mulai-layanan" data-langkah={langkahAwal} data-boleh-ubah={String(bolehUbah)} data-tiket={JSON.stringify(tiket)}>
      <button type="button" onClick={onClose}>mulai: tutup</button>
      <button type="button" onClick={onLanjutForm}>mulai: lanjut form</button>
      <button type="button" onClick={() => { void onDataBasi?.(); }}>mulai: data basi</button>
    </div>
  ),
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
vi.mock('@/components/admin/lihat-data/LihatDataKhususModal', () => ({
  default: ({ tiket, onClose }: { tiket: Record<string, unknown>; onClose: () => void }) => (
    <div data-testid="lihat-khusus" data-tiket={JSON.stringify(tiket)}>
      <button type="button" onClick={onClose}>lihat-khusus: tutup</button>
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
import { ADMIN, KOORDINATOR, buatTiket } from '../_uji/tiketUji';

afterEach(cleanup);

function pasang(utama: StateModal, qr: StateModal = null, pengguna = ADMIN) {
  const p = {
    utama,
    qr,
    pengguna,
    tutup: vi.fn(),
    buka: vi.fn(),
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
    for (const id of ['ambil-alih', 'alihkan', 'kembalikan', 'selesai-layanan', 'mulai-layanan', 'qr']) expect(screen.queryByTestId(id)).toBeNull();
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

  it('kembalikanKeFo dan selesaiLayanan: id, nomor, layanan_id (selesaiLayanan membawa hasilEskalasi)', () => {
    pasang({ jenis: 'kembalikanKeFo', tiket });
    expect(JSON.parse(screen.getByTestId('kembalikan').dataset.tiket as string)).toEqual({
      id: 't-9', nomor_display: 'OS-001', layanan_id: 'l-oss',
    });
    cleanup();
    pasang({ jenis: 'selesaiLayanan', tiket });
    expect(JSON.parse(screen.getByTestId('selesai-layanan').dataset.tiket as string)).toEqual({
      id: 't-9', nomor_display: 'OS-001', layanan_id: 'l-oss', hasilEskalasi: false,
    });
    cleanup();
    pasang({ jenis: 'selesaiLayanan', tiket: { ...tiket, penanganan_asal_id: 'ph-1' } });
    expect(JSON.parse(screen.getByTestId('selesai-layanan').dataset.tiket as string).hasilEskalasi).toBe(true);
  });

  it('hanya modal berjenis itu yang dipasang', () => {
    pasang({ jenis: 'alihkan', tiket });
    expect(screen.queryByTestId('ambil-alih')).toBeNull();
    expect(screen.queryByTestId('kembalikan')).toBeNull();
    expect(screen.queryByTestId('selesai-layanan')).toBeNull();
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

  it('lihatKhusus: panel baca-saja terpasang dengan id dan nomor tiket; tutup memanggil tutup(lihatKhusus)', () => {
    const p = pasang({ jenis: 'lihatKhusus', tiket });
    expect(JSON.parse(screen.getByTestId('lihat-khusus').getAttribute('data-tiket') ?? '{}')).toEqual({ id: 't-9', nomor_display: tiket.nomor_display });
    fireEvent.click(screen.getByText('lihat-khusus: tutup'));
    expect(p.tutup).toHaveBeenCalledWith('lihatKhusus');
    cleanup();
    pasang({ jenis: 'alihkan', tiket });
    expect(screen.queryByTestId('lihat-khusus')).toBeNull();
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

  it('selesaiLayanan berhasil: membuka QR tiketnya lalu memuat ulang', async () => {
    const p = pasang({ jenis: 'selesaiLayanan', tiket });
    fireEvent.click(screen.getByText('selesai-layanan: berhasil'));
    await vi.waitFor(() => expect(p.muatSenyap).toHaveBeenCalledTimes(1));
    expect(p.bukaQrTiket).toHaveBeenCalledWith('t-9');
    expect(p.bukaQrTiket.mock.invocationCallOrder[0]).toBeLessThan(p.muatSenyap.mock.invocationCallOrder[0]);
    await vi.waitFor(() => expect(p.tutup).toHaveBeenCalledWith('selesaiLayanan'));
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

  it('mulaiLayanan: langkah 1, boleh ubah (pemilik baru), tanpa formulir; lanjut form membuka wizard formulir', () => {
    const baru = buatTiket({ id: 't-5', status: 'menunggu', dilayani_oleh: null });
    const p = pasang({ jenis: 'mulaiLayanan', tiket: baru });
    const el = screen.getByTestId('mulai-layanan');
    expect(el).toHaveAttribute('data-langkah', '1');
    expect(el).toHaveAttribute('data-boleh-ubah', 'true');
    expect(JSON.parse(el.dataset.tiket as string)).toMatchObject({ id: 't-5', berFormulir: true });
    fireEvent.click(screen.getByText('mulai: lanjut form'));
    expect(p.buka).toHaveBeenCalledWith('wizard', baru);
    fireEvent.click(screen.getByText('mulai: tutup'));
    expect(p.tutup).toHaveBeenCalledWith('mulaiLayanan');
    fireEvent.click(screen.getByText('mulai: data basi'));
    expect(p.muatSenyap).toHaveBeenCalledTimes(1);
  });

  it('isiPendataan: langkah 2; boleh ubah hanya bila pemilik tiket', () => {
    const milik = buatTiket({ id: 't-6', status: 'dilayani', dilayani_oleh: ADMIN.id });
    const p = pasang({ jenis: 'isiPendataan', tiket: milik });
    expect(screen.getByTestId('mulai-layanan')).toHaveAttribute('data-langkah', '2');
    expect(screen.getByTestId('mulai-layanan')).toHaveAttribute('data-boleh-ubah', 'true');
    fireEvent.click(screen.getByText('mulai: tutup'));
    expect(p.tutup).toHaveBeenCalledWith('isiPendataan');
    cleanup();
    pasang({ jenis: 'isiPendataan', tiket });
    expect(screen.getByTestId('mulai-layanan')).toHaveAttribute('data-boleh-ubah', 'false');
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
