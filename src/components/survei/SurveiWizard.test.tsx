import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SurveiWizard from './SurveiWizard';
import type { KonteksSurvei } from '@/lib/survei/konteks';
import { buatState } from '@/lib/survei/wizard';
import { muatDraf, simpanDraf } from '@/lib/survei/penyimpanan';
import { PERTANYAAN_SPAK, SKALA_SKM, SKALA_SPAK, UNSUR_SKM } from '@/lib/survei/pertanyaan';

const ganti = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: ganti }) }));

const TOKEN = 'a'.repeat(64);
const KONTEKS: KonteksSurvei = {
  status: 'ok',
  unit: 'layanan',
  layananNama: 'Konsultasi OSS',
  kedaluwarsaPada: '2026-10-28T10:00:00+00:00',
};

const fetchMock = vi.fn();
const guliran: Element[] = [];

function balas(status: number): Response {
  return new Response(JSON.stringify(status < 300 ? { ok: true } : { error: 'x' }), { status });
}

function opsi(kunci: string, nilai: number): HTMLElement {
  const teks = [...PERTANYAAN_SPAK, ...UNSUR_SKM].find((q) => q.kunci === kunci)!.teks;
  const grup = screen.getByRole('radiogroup', { name: teks });
  const nama = kunci.startsWith('p')
    ? `${nilai}, ${SKALA_SPAK.find((s) => s.nilai === nilai)!.label}`
    : SKALA_SKM.find((s) => s.nilai === nilai)!.label;
  return within(grup).getByRole('radio', { name: nama });
}

/** Ketukan/klik pointer: browser mengisi `detail` = 1. */
const ketuk = (kunci: string, nilai: number) => fireEvent.click(opsi(kunci, nilai), { detail: 1 });
/** Pilihan lewat keyboard (Enter/Spasi pada tombol): `detail` = 0. */
const pilihKeyboard = (kunci: string, nilai: number) => fireEvent.click(opsi(kunci, nilai), { detail: 0 });
const tekan = (nama: string) => fireEvent.click(screen.getByRole('button', { name: nama }), { detail: 1 });

const adaSoal = (kunci: string) =>
  screen.queryByRole('radiogroup', { name: [...PERTANYAAN_SPAK, ...UNSUR_SKM].find((q) => q.kunci === kunci)!.teks }) !==
  null;
const judulLangkah = () => screen.getByRole('heading', { level: 2 });
const pengumuman = () => screen.getByRole('status');

function isiSpak() {
  ketuk('p1', 6);
  ketuk('p2', 5);
  ketuk('p3', 4);
  ketuk('p4', 3);
  ketuk('p5', 2);
}
function isiSkmSampaiUnsurTerakhirBelum() {
  for (const k of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10']) ketuk(k, 3);
}

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, '');
  fetchMock.mockReset();
  ganti.mockReset();
  fetchMock.mockResolvedValue(balas(201));
  vi.stubGlobal('fetch', fetchMock);
  guliran.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    guliran.push(this);
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('SurveiWizard: ketukan dan lanjut', () => {
  it('(a) ketukan jawaban terakhir langkah 1 pindah ke langkah 2 seketika (tanpa timer)', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    ketuk('p1', 6);
    ketuk('p2', 5);
    expect(adaSoal('p3')).toBe(true);
    expect(adaSoal('p4')).toBe(false);

    ketuk('p3', 4);

    // Tanpa waitFor/timer: setelah satu ketukan terakhir, langkah 2 sudah tampil.
    expect(adaSoal('p3')).toBe(false);
    expect(adaSoal('p4')).toBe(true);
    expect(adaSoal('p5')).toBe(true);
  });

  it('(b) ketukan soal pertama langkah SKM menggulir ke soal berikutnya yang belum terjawab', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    guliran.length = 0;

    ketuk('u1', 4);

    expect(guliran).toHaveLength(1);
    expect(guliran[0].querySelector('[role="radiogroup"]')).toBe(
      screen.getByRole('radiogroup', { name: 'Prosedur Pelayanan' }),
    );

    // Melompat: jawab u4 lebih dulu, gulir ke soal kosong pertama sesudahnya (tidak ada), lalu yang pertama kosong (u2).
    guliran.length = 0;
    ketuk('u4', 4);
    expect(guliran[0].querySelector('[role="radiogroup"]')).toBe(
      screen.getByRole('radiogroup', { name: 'Prosedur Pelayanan' }),
    );
  });

  it('(c) pilihan lewat keyboard tidak auto-lanjut dan tombol Lanjut aktif setelah lengkap', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    pilihKeyboard('p1', 3);
    pilihKeyboard('p2', 3);
    pilihKeyboard('p3', 3);

    expect(adaSoal('p3')).toBe(true);
    expect(adaSoal('p4')).toBe(false);
    expect(guliran).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled();

    tekan('Lanjut');
    expect(adaSoal('p4')).toBe(true);
  });

  it('panah pada radiogroup memilih tanpa auto-lanjut (pola ARIA)', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    pilihKeyboard('p1', 3);
    pilihKeyboard('p2', 3);
    fireEvent.keyDown(opsi('p3', 1), { key: 'ArrowRight' });

    expect(opsi('p3', 2)).toHaveAttribute('aria-checked', 'true');
    expect(opsi('p3', 2)).toHaveFocus();
    expect(adaSoal('p3')).toBe(true);
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled();
  });

  it('(e) Lanjut nonaktif saat langkah belum lengkap', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    ketuk('p1', 3);
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Kembali' })).toBeNull();
  });

  it('ketukan kedua beruntun (detail >= 2) diabaikan agar tidak menjawab soal langkah berikutnya', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    ketuk('p1', 6);
    ketuk('p2', 5);
    ketuk('p3', 4);
    expect(adaSoal('p4')).toBe(true);

    // Ketukan ganda cepat pada jawaban terakhir: ketukan kedua jatuh pada soal langkah 2.
    fireEvent.click(opsi('p4', 4), { detail: 2 });

    expect(opsi('p4', 4)).toHaveAttribute('aria-checked', 'false');
    expect(adaSoal('p4')).toBe(true);
  });
});

describe('SurveiWizard: Back', () => {
  it('(d) Kembali ke langkah sebelumnya tanpa auto-lanjut dan jawaban tetap', async () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    ketuk('p1', 6);
    ketuk('p2', 5);
    ketuk('p3', 4);
    expect(adaSoal('p4')).toBe(true);

    tekan('Kembali');

    await waitFor(() => expect(adaSoal('p1')).toBe(true));
    expect(adaSoal('p4')).toBe(false);
    expect(opsi('p1', 6)).toHaveAttribute('aria-checked', 'true');
    expect(opsi('p2', 5)).toHaveAttribute('aria-checked', 'true');
    expect(opsi('p3', 4)).toHaveAttribute('aria-checked', 'true');
    // Langkah 1 sudah lengkap, tetapi berada di sana lewat Back tidak memicu lanjut sampai jawaban diubah.
    expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled();
  });

  it('tombol Back ponsel (popstate) berfungsi sebagai Back langkah, juga setelah draf dipulihkan', async () => {
    const jawaban = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 };
    simpanDraf(TOKEN, buatState(jawaban, 2));
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(adaSoal('u1')).toBe(true);

    history.back();

    await waitFor(() => expect(adaSoal('p4')).toBe(true));
    expect(adaSoal('u1')).toBe(false);
  });
});

describe('SurveiWizard: kirim', () => {
  it('(f) ketukan terakhir SKM mengirim satu POST berisi payload lengkap lalu menampilkan layar akhir', async () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    expect(fetchMock).not.toHaveBeenCalled();

    ketuk('u11', 4);

    expect(await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/survei/kirim');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      token: TOKEN,
      spak: { p1: 6, p2: 5, p3: 4, p4: 3, p5: 2 },
      skm: { u1: 3, u2: 3, u3: 3, u4: 3, u5: 3, u6: 3, u7: 3, u8: 3, u9: 3, u10: 3, u11: 4 },
    });
  });

  it('ketukan ganda cepat pada jawaban terakhir hanya mengirim satu POST', async () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    const terakhir = opsi('u11', 4);

    fireEvent.click(terakhir, { detail: 1 });
    fireEvent.click(terakhir, { detail: 1 });
    fireEvent.click(terakhir, { detail: 2 });

    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keyboard di soal terakhir tidak mengirim; tombol "Kirim jawaban" yang mengirim', async () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();

    pilihKeyboard('u11', 2);
    expect(fetchMock).not.toHaveBeenCalled();

    tekan('Kirim jawaban');
    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('(g) gagal jaringan menampilkan ErrorRetry dengan jawaban tetap; Coba lagi mengirim ulang', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();

    ketuk('u11', 4);

    const galat = await screen.findByRole('alert');
    expect(galat).toHaveTextContent('Jawaban belum terkirim');
    expect(opsi('u11', 4)).toHaveAttribute('aria-checked', 'true');
    expect(opsi('u10', 3)).toHaveAttribute('aria-checked', 'true');
    // Draf tetap ada supaya muat ulang tidak menghapus isian.
    expect(muatDraf(TOKEN)?.jawaban.u11).toBe(4);

    fireEvent.click(within(galat).getByRole('button', { name: 'Coba lagi' }), { detail: 1 });

    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const badan = (i: number) => (fetchMock.mock.calls[i] as [string, RequestInit])[1].body;
    expect(badan(1)).toBe(badan(0));
  });

  it('respons 5xx juga menampilkan ErrorRetry (bukan layar sukses)', async () => {
    fetchMock.mockResolvedValueOnce(balas(500));
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    ketuk('u11', 4);

    expect(await screen.findByRole('alert')).toHaveTextContent('Jawaban belum terkirim');
    expect(screen.queryByText('Terima kasih, jawaban Anda sudah terkirim.')).toBeNull();
  });

  it.each([
    [409, 'Terima kasih, survei ini sudah Anda isi'],
    [410, 'Waktu pengisian sudah berakhir'],
    [404, 'Tautan survei tidak dikenali'],
  ])('respons %i menampilkan status ramah yang sesuai dan membersihkan draf', async (status, judul) => {
    fetchMock.mockResolvedValueOnce(balas(status));
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    ketuk('u11', 4);

    expect(await screen.findByRole('heading', { level: 2, name: judul })).toBeInTheDocument();
    expect(muatDraf(TOKEN)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Selesai di layar akhir memanggil onSelesai', async () => {
    const onSelesai = vi.fn();
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} onSelesai={onSelesai} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    ketuk('u11', 4);
    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');

    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }), { detail: 1 });
    expect(onSelesai).toHaveBeenCalledTimes(1);
    expect(ganti).not.toHaveBeenCalled();
  });

  it('Selesai tanpa onSelesai kembali ke beranda', async () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    isiSpak();
    isiSkmSampaiUnsurTerakhirBelum();
    ketuk('u11', 4);
    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');

    fireEvent.click(screen.getByRole('button', { name: 'Selesai' }), { detail: 1 });
    expect(ganti).toHaveBeenCalledWith('/');
  });
});

describe('SurveiWizard: draf sessionStorage', () => {
  it('(h) menyimpan draf saat menjawab, memulihkannya saat dimuat ulang, dan menghapusnya setelah terkirim', async () => {
    const pertama = render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    ketuk('p1', 6);
    ketuk('p2', 5);
    ketuk('p3', 4);
    expect(muatDraf(TOKEN)).toEqual({ indeks: 1, jawaban: { p1: 6, p2: 5, p3: 4 } });
    pertama.unmount();

    // "Muat ulang": komponen baru, penyimpanan sama.
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(adaSoal('p4')).toBe(true);
    expect(adaSoal('p1')).toBe(false);
    tekan('Kembali');
    await waitFor(() => expect(adaSoal('p1')).toBe(true));
    expect(opsi('p1', 6)).toHaveAttribute('aria-checked', 'true');
    ketuk('p3', 4); // lanjut lagi ke langkah 2
    ketuk('p4', 3);
    ketuk('p5', 2);
    isiSkmSampaiUnsurTerakhirBelum();
    ketuk('u11', 4);

    await screen.findByText('Terima kasih, jawaban Anda sudah terkirim.');
    expect(muatDraf(TOKEN)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('draf yang melompati langkah kosong dipulihkan hanya sampai langkah pertama yang belum lengkap', () => {
    // Draf utak-atik: langkah 4 aktif tetapi langkah 1 kosong. Wizard tidak boleh mengirim/melompat.
    simpanDraf(TOKEN, buatState({ u1: 1, u2: 1, u3: 1, u4: 1 }, 3));
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(adaSoal('p1')).toBe(true);
  });
});

describe('SurveiWizard: judul, fokus, dan pengumuman', () => {
  it('(i) "Survei 1 dari 2" lalu "Survei 2 dari 2"; fokus ke judul langkah dan region aria-live mengumumkan langkah', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(judulLangkah()).toHaveTextContent('Survei 1 dari 2');
    expect(judulLangkah()).toHaveTextContent('Survey Persepsi Anti Korupsi');
    expect(pengumuman()).toHaveTextContent('Langkah 1 dari 5');
    expect(pengumuman()).toHaveAttribute('aria-live', 'polite');
    // Tidak merebut fokus saat pertama dimuat.
    expect(judulLangkah()).not.toHaveFocus();

    ketuk('p1', 6);
    ketuk('p2', 5);
    ketuk('p3', 4);
    expect(judulLangkah()).toHaveTextContent('Survei 1 dari 2');
    expect(judulLangkah()).toHaveFocus();
    expect(pengumuman()).toHaveTextContent('Langkah 2 dari 5');

    ketuk('p4', 3);
    ketuk('p5', 2);
    expect(judulLangkah()).toHaveTextContent('Survei 2 dari 2');
    expect(judulLangkah()).toHaveTextContent('Survey Kepuasan Masyarakat');
    expect(judulLangkah()).toHaveFocus();
    expect(pengumuman()).toHaveTextContent('Langkah 3 dari 5');
  });

  it('memberi tahu di awal bahwa halaman otomatis lanjut dan menyebut unit yang dinilai', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    expect(screen.getByText(/halaman akan otomatis lanjut/i)).toBeInTheDocument();
    expect(screen.getByText('Konsultasi OSS')).toBeInTheDocument();
  });

  it('unit fo ditampilkan sebagai Front Office', () => {
    render(<SurveiWizard token={TOKEN} konteks={{ ...KONTEKS, unit: 'fo', layananNama: null }} />);
    expect(screen.getByText('Front Office')).toBeInTheDocument();
  });

  it('kelompok radio berlabel teks pertanyaan, tepat satu tab stop per kelompok, dan label terpilih tampil', () => {
    render(<SurveiWizard token={TOKEN} konteks={KONTEKS} />);
    const grup = screen.getByRole('radiogroup', { name: PERTANYAAN_SPAK[0].teks });
    expect(within(grup).getAllByRole('radio')).toHaveLength(6);
    expect(within(grup).getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1);

    ketuk('p1', 4);
    expect(opsi('p1', 4).tabIndex).toBe(0);
    expect(within(grup.parentElement!).getByText('Terpilih: Cukup Setuju')).toBeInTheDocument();
  });
});
