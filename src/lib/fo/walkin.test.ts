import { describe, expect, it, vi } from 'vitest';
import { GalatRpc, kodeDariPesan } from '@/lib/rpc-galat';
import {
  LAYANAN_BELUM_TAHU,
  WALKIN_KOSONG,
  bacaParamTersimpan,
  bangunParamFoMulai,
  formatHpTampil,
  galatFieldServer,
  galatFoMulaiPermanen,
  normalisasiHp,
  normalisasiWalkin,
  panggilFoMulaiKunjungan,
  periksaAsal,
  periksaEmail,
  periksaHp,
  periksaKeperluan,
  periksaNama,
  pesanGalatFoMulai,
  rapikanNama,
  sarankanEmail,
  validasiParamFoMulai,
  validasiWalkin,
  type DataWalkin,
} from './walkin';

const ID = '11111111-1111-4111-8111-111111111111';
const UUID_LAYANAN = '22222222-2222-4222-8222-222222222222';
const valid: DataWalkin = {
  nama: 'Budi Santoso',
  asal_instansi: 'PT Maju',
  kontak_hp: '081234567890',
  kategori: 'UMKM',
  email: 'budi@gmail.com',
  keperluan: 'Mengurus NIB usaha kuliner',
  layanan_saran_id: LAYANAN_BELUM_TAHU,
};

describe('kodeDariPesan', () => {
  it('mengambil KODE di awal pesan', () => {
    expect(kodeDariPesan('LAYANAN_TUTUP: Layanan sudah tutup')).toBe('LAYANAN_TUTUP');
    expect(kodeDariPesan('SUDAH_DIAMBIL')).toBe('SUDAH_DIAMBIL');
    expect(kodeDariPesan('TypeError: Failed to fetch')).toBeNull();
    expect(kodeDariPesan('permission denied for table x')).toBeNull();
    expect(kodeDariPesan(undefined)).toBeNull();
  });
});

describe('nama', () => {
  it('menerima huruf Unicode, spasi, titik, koma, apostrof, strip', () => {
    for (const n of ['Budi Santoso', "Dewi O'Connor", 'Siti Nur-Aini', 'Dr. Ir. Budi, M.Si', 'José Ñandú', 'Budi Santoso’s']) {
      expect(periksaNama(n)).toBeUndefined();
    }
  });

  it('menolak kosong, angka, simbol, diawali non-huruf, kurang dari 3 huruf, lebih dari 100 karakter', () => {
    expect(periksaNama('')).toMatch(/wajib/);
    expect(periksaNama('   ')).toMatch(/wajib/);
    expect(periksaNama('Budi 2')).toMatch(/angka/);
    expect(periksaNama('Budi@Santoso')).toMatch(/hanya boleh berisi huruf/);
    expect(periksaNama('.Budi')).toMatch(/hanya boleh berisi huruf/);
    expect(periksaNama('-Budi')).toMatch(/hanya boleh berisi huruf/);
    expect(periksaNama('Bu')).toMatch(/terlalu pendek/);
    expect(periksaNama('B. u')).toMatch(/terlalu pendek/); // hanya 2 huruf walau panjang 4
    expect(periksaNama('a'.repeat(101))).toMatch(/terlalu panjang/);
    expect(periksaNama('a'.repeat(100))).toBeUndefined();
    expect(periksaNama('Bud')).toBeUndefined();
  });

  it('spasi ganda dirapatkan sebelum dihitung; panjang dihitung per karakter Unicode', () => {
    expect(normalisasiWalkin({ ...valid, nama: '  Budi    Santoso ' }).nama).toBe('Budi Santoso');
    expect(periksaNama('😀'.repeat(3))).toBeDefined(); // emoji bukan huruf
  });

  it('nama dinormalkan ke Unicode NFC sebelum divalidasi dan dikirim', () => {
    const terurai = 'José Santoso'; // e + aksen gabung
    expect(normalisasiWalkin({ ...valid, nama: terurai }).nama).toBe('José Santoso');
    expect(periksaNama(terurai)).toBeUndefined();
  });

  it('rapikanNama: Title Case hanya bila semua kapital / semua kecil; nama campuran dibiarkan', () => {
    expect(rapikanNama('BUDI SANTOSO')).toBe('Budi Santoso');
    expect(rapikanNama('budi santoso')).toBe('Budi Santoso');
    expect(rapikanNama("dewi o'connor")).toBe("Dewi O'Connor");
    expect(rapikanNama('siti nur-aini')).toBe('Siti Nur-Aini');
    expect(rapikanNama('m. ali')).toBe('M. Ali');
    expect(rapikanNama('Dr. Ir. Budi, M.Si')).toBe('Dr. Ir. Budi, M.Si');
    expect(rapikanNama('Budi MCDonald')).toBe('Budi MCDonald');
    expect(rapikanNama('  budi   santoso ')).toBe('Budi Santoso');
    expect(rapikanNama('')).toBe('');
  });
});

describe('asal / instansi', () => {
  it('3–120 karakter, minimal 3 non-spasi', () => {
    expect(periksaAsal('')).toMatch(/wajib/);
    expect(periksaAsal('PT')).toMatch(/terlalu pendek/);
    expect(periksaAsal('A   B')).toMatch(/terlalu pendek/); // 2 non-spasi
    expect(periksaAsal('  ABC  ')).toBeUndefined();
    expect(periksaAsal('x'.repeat(120))).toBeUndefined();
    expect(periksaAsal('x'.repeat(121))).toMatch(/terlalu panjang/);
  });
});

describe('nomor HP', () => {
  it.each([
    ['0812-3456-7890', '081234567890'],
    ['0812 3456 7890', '081234567890'],
    ['(0812) 3456-7890', '081234567890'],
    ['+62 812-3456-7890', '081234567890'],
    ['+6281234567890', '081234567890'],
    ['6281234567890', '081234567890'],
    ['62 812 3456 7890', '081234567890'],
    ['0 812 3456 7890', '081234567890'],
    ['0852 1234 567', '08521234567'],
  ])('%s -> %s (valid)', (masukan, kanonik) => {
    expect(normalisasiHp(masukan)).toBe(kanonik);
    expect(periksaHp(masukan)).toBeUndefined();
  });

  it('normalisasi identik server: 62 -> 0 tanpa membuang 0 berikutnya; "+62 0812…" ditolak', () => {
    expect(normalisasiHp('+62 0812-3456-7890')).toBe('00812345678' + '90');
    expect(periksaHp('+62 0812-3456-7890')).toMatch(/tanpa angka 0/);
    expect(periksaHp('62 0812 3456 7890')).toMatch(/tanpa angka 0/);
    expect(normalisasiHp('+62 812-3456-7890')).toBe('081234567890');
  });

  it('panjang kanonik 10–13 digit', () => {
    expect(periksaHp('0812345678')).toBeUndefined(); // 10
    expect(periksaHp('0812345678901')).toBeUndefined(); // 13
    expect(periksaHp('081234567')).toMatch(/terlalu pendek/); // 9
    expect(periksaHp('08123456789012')).toMatch(/terlalu panjang/); // 14
  });

  it('galat jelas: kosong, huruf, telepon rumah, awalan tak dikenal, tanpa 08', () => {
    expect(periksaHp('')).toMatch(/wajib/);
    expect(periksaHp('   ')).toMatch(/wajib/);
    expect(periksaHp('abc0812345678')).toMatch(/hanya boleh berisi angka/);
    expect(periksaHp('0812345678x')).toMatch(/hanya boleh berisi angka/);
    expect(periksaHp('(0721) 481-234')).toMatch(/telepon rumah/);
    expect(periksaHp('0721481234')).toMatch(/telepon rumah/);
    expect(periksaHp('+62 721 481234')).toMatch(/telepon rumah/);
    expect(periksaHp('08012345678')).toMatch(/Awalan nomor tidak dikenal/);
    expect(periksaHp('8123456789')).toMatch(/diawali 08/);
    expect(periksaHp('12345')).toMatch(/diawali 08/);
    expect(periksaHp('+1 555 123 4567')).toMatch(/diawali 08/);
  });

  it('formatHpTampil: 0812-3456-7890; bukan kanonik apa adanya', () => {
    expect(formatHpTampil('081234567890')).toBe('0812-3456-7890');
    expect(formatHpTampil('08521234567')).toBe('0852-1234-567');
    expect(formatHpTampil('abc')).toBe('abc');
  });
});

describe('email', () => {
  it('format standar lolos; huruf besar dan spasi tepi dinormalkan', () => {
    for (const e of ['budi@gmail.com', 'budi.s+nib@perusahaan.co.id', '  BUDI@Gmail.COM  ', 'a@b.id', 'a_b%c-d@sub.domain-x.co.id']) {
      expect(periksaEmail(e)).toBeUndefined();
    }
    expect(normalisasiWalkin({ ...valid, email: '  BUDI@Gmail.COM ' }).email).toBe('budi@gmail.com');
  });

  it('galat: kosong, spasi, @ ganda/hilang, tanpa domain/TLD, TLD 1 huruf, >254', () => {
    expect(periksaEmail('')).toMatch(/wajib/);
    expect(periksaEmail('bu di@gmail.com')).toMatch(/spasi/);
    expect(periksaEmail('budi')).toMatch(/satu tanda @/);
    expect(periksaEmail('a@b@c.com')).toMatch(/satu tanda @/);
    expect(periksaEmail('@gmail.com')).toMatch(/sebelum tanda @/);
    expect(periksaEmail('budi@gmail')).toMatch(/Domain email belum lengkap/);
    expect(periksaEmail('budi@gmail.')).toMatch(/Format email/);
    expect(periksaEmail('budi@.com')).toMatch(/Format email/);
    expect(periksaEmail('budi@gmail.c')).toMatch(/Format email/);
    expect(periksaEmail(`${'a'.repeat(250)}@b.id`)).toMatch(/terlalu panjang/);
  });

  it('regex identik server: apostrof, simbol, dan Unicode ditolak dengan pesan jelas', () => {
    expect(periksaEmail("o'brien@gmail.com")).toMatch(/tanpa apostrof/);
    expect(periksaEmail('bu!di@gmail.com')).toMatch(/Bagian sebelum @/);
    expect(periksaEmail('budi@gmäil.com')).toMatch(/Unicode/);
    expect(periksaEmail('büdi@gmail.com')).toMatch(/Unicode/);
    expect(periksaEmail('budi@gm_ail.com')).toMatch(/Format email/);
    expect(periksaEmail('budi@gmail.c0m')).toMatch(/Format email/);
    expect(periksaEmail('budi@gmail..com')).toMatch(/Format email/);
  });

  it('menolak domain placeholder jelas tetapi tidak domain sah mirip (mail.com)', () => {
    for (const e of ['budi@contoh.com', 'budi@example.com', 'budi@test.com', 'a@b.example', 'a@x.test', 'a@x.invalid']) {
      expect(periksaEmail(e)).toMatch(/placeholder/);
    }
    expect(periksaEmail('budi@mail.com')).toBeUndefined();
    expect(periksaEmail('budi@contoh.id')).toBeUndefined();
  });

  it('saran koreksi salah ketik domain populer; tidak memblokir validasi', () => {
    const pasangan: Array<[string, string]> = [
      ['budi@gmial.com', 'budi@gmail.com'],
      ['budi@gmail.co', 'budi@gmail.com'],
      ['budi@gamil.com', 'budi@gmail.com'],
      ['budi@gmail.con', 'budi@gmail.com'],
      ['budi@yahooo.com', 'budi@yahoo.com'],
      ['budi@hotmial.com', 'budi@hotmail.com'],
      ['budi@outlok.com', 'budi@outlook.com'],
      ['BUDI@GMIAL.COM', 'budi@gmail.com'],
      ['budi@gmaip.com', 'budi@gmail.com'], // jarak 1 dari gmail.com
    ];
    for (const [salah, benar] of pasangan) {
      expect(sarankanEmail(salah)).toBe(benar);
      expect(periksaEmail(salah)).toBeUndefined(); // domain berbentuk sah: tetap lolos
    }
  });

  it('tanpa saran untuk domain sah/populer, domain jauh berbeda, atau email tak valid', () => {
    for (const e of ['budi@gmail.com', 'budi@mail.com', 'budi@lampungprov.go.id', 'budi@yahoo.co.id', 'budi@gmail', 'bukan-email']) {
      expect(sarankanEmail(e)).toBeNull();
    }
  });
});

describe('kategori, layanan saran, keperluan', () => {
  it('kategori wajib salah satu kunci kategori pengunjung', () => {
    for (const k of ['Umum', 'UMKM', 'Investor', 'Instansi']) {
      expect(validasiWalkin({ ...valid, kategori: k }).kategori).toBeUndefined();
    }
    expect(validasiWalkin({ ...valid, kategori: '' }).kategori).toMatch(/Pilih kategori/);
    expect(validasiWalkin({ ...valid, kategori: 'umum' }).kategori).toMatch(/tidak dikenal/);
  });

  it('layanan saran wajib dipilih: uuid atau "belum tahu" valid, kosong/sembarang tidak', () => {
    expect(validasiWalkin({ ...valid, layanan_saran_id: UUID_LAYANAN }).layanan_saran_id).toBeUndefined();
    expect(validasiWalkin({ ...valid, layanan_saran_id: LAYANAN_BELUM_TAHU }).layanan_saran_id).toBeUndefined();
    expect(validasiWalkin({ ...valid, layanan_saran_id: '' }).layanan_saran_id).toMatch(/Pilih layanan/);
    expect(validasiWalkin({ ...valid, layanan_saran_id: 'lay-1' }).layanan_saran_id).toMatch(/tidak valid/);
  });

  it('keperluan 10–500 karakter, minimal 10 non-spasi', () => {
    expect(periksaKeperluan('')).toMatch(/wajib/);
    expect(periksaKeperluan('Urus NIB')).toMatch(/terlalu singkat/);
    expect(periksaKeperluan('a b c d e f g h i')).toMatch(/terlalu singkat/); // 9 non-spasi
    expect(periksaKeperluan('a b c d e f g h i j')).toBeUndefined();
    expect(periksaKeperluan('   Urus NIB usaha   ')).toBeUndefined();
    expect(periksaKeperluan('x'.repeat(500))).toBeUndefined();
    expect(periksaKeperluan('x'.repeat(501))).toMatch(/maksimal 500/);
  });
});

describe('validasiWalkin (semua isian wajib)', () => {
  it('data lengkap lolos', () => {
    expect(validasiWalkin(valid)).toEqual({});
  });

  it('formulir kosong: ketujuh isian wajib, urut sesuai formulir', () => {
    const g = validasiWalkin(WALKIN_KOSONG);
    expect(Object.keys(g)).toEqual(['nama', 'asal_instansi', 'kategori', 'kontak_hp', 'email', 'layanan_saran_id', 'keperluan']);
  });
});

describe('bangunParamFoMulai', () => {
  it('memakai nama parameter kontrak §2.1; HP kanonik, email huruf kecil, nama dirapikan, id disertakan', () => {
    expect(
      bangunParamFoMulai(
        {
          ...valid,
          nama: '  BUDI   SANTOSO ',
          kontak_hp: '+62 812-3456-7890',
          email: ' Budi@Gmail.com ',
          keperluan: '  Urus NIB usaha  ',
          layanan_saran_id: UUID_LAYANAN,
        },
        ID,
      ),
    ).toEqual({
      p_nama: 'Budi Santoso',
      p_asal_instansi: 'PT Maju',
      p_kontak_hp: '081234567890',
      p_kategori: 'UMKM',
      p_email: 'budi@gmail.com',
      p_keperluan: 'Urus NIB usaha',
      p_layanan_saran_id: UUID_LAYANAN,
      p_client_request_id: ID,
    });
  });

  it('"Belum tahu" dikirim sebagai NULL (kontrak RPC tidak berubah)', () => {
    expect(bangunParamFoMulai({ ...valid, layanan_saran_id: LAYANAN_BELUM_TAHU }, ID).p_layanan_saran_id).toBeNull();
  });

  it('validasiParamFoMulai memakai aturan yang sama (dipakai sebelum mengantre offline)', () => {
    expect(validasiParamFoMulai(bangunParamFoMulai(valid, ID))).toEqual({});
    expect(validasiParamFoMulai(bangunParamFoMulai({ ...valid, layanan_saran_id: UUID_LAYANAN }, ID))).toEqual({});
    const rusak = { ...bangunParamFoMulai(valid, ID), p_kontak_hp: '0721481234', p_email: null };
    expect(Object.keys(validasiParamFoMulai(rusak))).toEqual(['kontak_hp', 'email']);
  });
});

describe('bacaParamTersimpan', () => {
  it('mengembalikan hanya kolom dikenal dan menolak bentuk tidak sah', () => {
    const p = bangunParamFoMulai(valid, ID);
    expect(bacaParamTersimpan({ ...p, ekstra: 'x' })).toEqual(p);
    expect(bacaParamTersimpan(null)).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_client_request_id: 'bukan-uuid' })).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_nama: 123 })).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_email: 5 })).toBeNull();
  });
});

describe('pesan & klasifikasi galat', () => {
  it.each([
    ['LAYANAN_TUTUP', /sudah tutup/],
    ['DATA_TIDAK_VALID', /Data ditolak server/],
    ['LAYANAN_TIDAK_VALID', /Layanan saran tidak valid/],
    ['IDEMPOTENSI_BENTROK', /bentrok/],
    ['FORBIDDEN', /tidak berwenang/],
    ['SESI_TIDAK_SAH', /Sesi Anda sudah berakhir/],
  ])('%s -> pesan Indonesia', (kode, pola) => {
    expect(pesanGalatFoMulai(new GalatRpc(kode))).toMatch(pola);
  });

  it('jaringan dan galat tak dikenal memakai pesan umum yang tepat', () => {
    expect(pesanGalatFoMulai(new GalatRpc(null, { jaringan: true }))).toMatch(/Koneksi bermasalah/);
    expect(pesanGalatFoMulai(new GalatRpc('ANEH'))).toMatch(/Gagal menyimpan kunjungan/);
    expect(pesanGalatFoMulai(new Error('x'))).toMatch(/Gagal menyimpan kunjungan/);
  });

  it('hanya galat yang pasti gagal lagi yang permanen', () => {
    for (const k of ['LAYANAN_TUTUP', 'DATA_TIDAK_VALID', 'LAYANAN_TIDAK_VALID', 'NOT_FOUND', 'IDEMPOTENSI_BENTROK']) {
      expect(galatFoMulaiPermanen(new GalatRpc(k))).toBe(true);
    }
    for (const k of ['FORBIDDEN', 'SESI_TIDAK_SAH', 'RESPON_TIDAK_VALID', null]) {
      expect(galatFoMulaiPermanen(new GalatRpc(k))).toBe(false);
    }
    expect(galatFoMulaiPermanen(new GalatRpc('LAYANAN_TUTUP', { jaringan: true }))).toBe(false);
    expect(galatFoMulaiPermanen(new Error('x'))).toBe(false);
  });
});

describe('galatFieldServer (error.details dari server)', () => {
  const dariServer = (details: string | null, message = 'DATA_TIDAK_VALID: nomor HP wajib') =>
    new GalatRpc('DATA_TIDAK_VALID', { asal: { message, details, code: '22023' } });

  it.each(['nama', 'asal_instansi', 'kontak_hp', 'kategori', 'email', 'keperluan'])('details %s -> isian itu', (f) => {
    expect(galatFieldServer(dariServer(f))?.field).toBe(f);
  });

  it('pesan tanpa awalan kode, huruf pertama kapital', () => {
    expect(galatFieldServer(dariServer('kontak_hp'))?.pesan).toBe('Ditolak server: Nomor HP wajib');
  });

  it('null bila bukan DATA_TIDAK_VALID, jaringan, details kosong/tak dikenal', () => {
    expect(galatFieldServer(dariServer(null))).toBeNull();
    expect(galatFieldServer(dariServer('xyz'))).toBeNull();
    expect(galatFieldServer(new GalatRpc('LAYANAN_TUTUP', { asal: { details: 'nama' } }))).toBeNull();
    expect(galatFieldServer(new GalatRpc('DATA_TIDAK_VALID', { jaringan: true, asal: { details: 'nama' } }))).toBeNull();
    expect(galatFieldServer(new Error('x'))).toBeNull();
  });
});

describe('panggilFoMulaiKunjungan', () => {
  const param = bangunParamFoMulai(valid, ID);
  const sukses = { data: { ok: true, sudah_ada: false, kunjungan_id: 'k-1', penanganan_id: 'p-1', qr_token: 'qr' }, error: null };

  it('memanggil rpc fo_mulai_kunjungan dengan param apa adanya dan memetakan hasil', async () => {
    const rpc = vi.fn().mockResolvedValue(sukses);
    const h = await panggilFoMulaiKunjungan({ rpc } as never, param);
    expect(rpc).toHaveBeenCalledWith('fo_mulai_kunjungan', param);
    expect(h).toEqual({ sudahAda: false, kunjunganId: 'k-1', penangananId: 'p-1', qrToken: 'qr' });
  });

  it('sudah_ada:true (idempoten) diperlakukan sebagai sukses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...sukses.data, sudah_ada: true }, error: null });
    expect((await panggilFoMulaiKunjungan({ rpc } as never, param)).sudahAda).toBe(true);
  });

  it('balasan tanpa ok:true / tanpa kunjungan_id = RESPON_TIDAK_VALID', async () => {
    for (const data of [null, { ok: false }, { ok: true }]) {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toMatchObject({ kode: 'RESPON_TIDAK_VALID' });
    }
  });

  it('galat server: kode dari awal pesan; jaringan ditandai', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'LAYANAN_TUTUP: tutup', code: 'P0001' } });
    await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toMatchObject({ kode: 'LAYANAN_TUTUP', jaringan: false });

    const rpcNet = vi.fn().mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    await expect(panggilFoMulaiKunjungan({ rpc: rpcNet } as never, param)).rejects.toMatchObject({ jaringan: true });
  });

  it('23505 (balapan id sama) dicoba ulang SEKALI dan menghasilkan sudah_ada', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value', code: '23505' } })
      .mockResolvedValueOnce({ data: { ...sukses.data, sudah_ada: true }, error: null });
    const h = await panggilFoMulaiKunjungan({ rpc } as never, param);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(h.sudahAda).toBe(true);
  });

  it('23505 berulang tidak mengulang tanpa batas', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value', code: '23505' } });
    await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toBeInstanceOf(GalatRpc);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
