import { beforeEach, describe, expect, it, vi } from 'vitest';

const kirim = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  const buat = (nama: string) =>
    class {
      input: unknown;
      nama = nama;
      constructor(input: unknown) { this.input = input; }
    };
  return {
    S3Client: class { send = kirim; },
    PutObjectCommand: buat('Put'),
    GetObjectCommand: buat('Get'),
    HeadObjectCommand: buat('Head'),
    DeleteObjectsCommand: buat('Delete'),
    CopyObjectCommand: buat('Copy'),
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed.example/x') }));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { copyObject, deleteObjects, getObjectBytes, headObject, presignGet, presignPut,
  putObject, r2Tersedia, bucketTerpisah, urlPublik } from './r2';

const ENV = {
  R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'ak', R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET_PRIVATE: 'priv', R2_BUCKET_PUBLIC: 'pub', R2_PUBLIC_BASE_URL: 'https://pub.example.org/',
};

describe('r2', () => {
  beforeEach(() => {
    kirim.mockReset();
    vi.mocked(getSignedUrl).mockClear();
    Object.assign(process.env, ENV);
  });

  it('PUT draf menandatangani content-type hanya bila opsi dinyalakan', async () => {
    await presignPut('private', 'umkm-draf/foto.jpg', {
      contentType: 'image/jpeg', contentLength: 100, tandatanganiContentType: true,
    });
    expect(vi.mocked(getSignedUrl).mock.calls[0][2]).toMatchObject({
      signableHeaders: new Set(['content-type']),
    });
    await presignPut('public', 'umkm-photos/foto.jpg', { contentType: 'image/jpeg', contentLength: 100 });
    expect(vi.mocked(getSignedUrl).mock.calls[1][2]).toEqual({ expiresIn: 120 });
  });

  it('HEAD mengembalikan ETag dan salin lintas bucket bersyarat tidak membaca body', async () => {
    kirim.mockResolvedValue({ ETag: '"abc123"', ContentType: 'image/jpeg', ContentLength: 120,
      CopyObjectResult: { ETag: '"abc123"' } });
    expect(await headObject('private', 'umkm-draf/a.jpg'))
      .toEqual({ etag: '"abc123"', size: 120, contentType: 'image/jpeg' });
    await copyObject('private', 'umkm-draf/a.jpg', 'public', 'umkm-katalog/b.jpg', '"abc123"');
    expect(kirim.mock.calls[1][0]).toMatchObject({ nama: 'Copy', input: {
      Bucket: 'pub', Key: 'umkm-katalog/b.jpg', CopySource: 'priv/umkm-draf/a.jpg',
      CopySourceIfMatch: '"abc123"',
    } });
  });

  it('GET pratinjau dapat memaksa tipe gambar dan inline tanpa mengubah GET lama', async () => {
    await presignGet('private', 'umkm-draf/foto.png', 60, {
      contentType: 'image/png', contentDisposition: 'inline',
    });
    expect(vi.mocked(getSignedUrl).mock.calls[0][1].input).toMatchObject({
      ResponseContentType: 'image/png', ResponseContentDisposition: 'inline',
    });
    await presignGet('private', 'investment-docs/a.pdf');
    expect(vi.mocked(getSignedUrl).mock.calls[1][1].input).toEqual({
      Bucket: 'priv', Key: 'investment-docs/a.pdf',
    });
  });

  it('putObject mengirim ke bucket privat dengan kunci yang diberikan', async () => {
    kirim.mockResolvedValue({});
    await putObject('private', 'a/b.pdf', new Uint8Array([1]), 'application/pdf');
    const cmd = kirim.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input).toMatchObject({ Bucket: 'priv', Key: 'a/b.pdf', ContentType: 'application/pdf' });
  });

  it('getObjectBytes mengembalikan null untuk NoSuchKey', async () => {
    kirim.mockRejectedValue(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    expect(await getObjectBytes('private', 'tidak/ada')).toBeNull();
  });

  it('deleteObjects memecah 1500 kunci menjadi 2 permintaan', async () => {
    kirim.mockResolvedValue({});
    await deleteObjects('private', Array.from({ length: 1500 }, (_, i) => `k${i}`));
    expect(kirim).toHaveBeenCalledTimes(2);
    const jumlah = kirim.mock.calls.map((c) => (c[0] as { input: { Delete: { Objects: unknown[] } } }).input.Delete.Objects.length);
    expect(jumlah).toEqual([1000, 500]);
  });

  it('galat per objek pada respons sukses HTTP tetap menggagalkan penghapusan', async () => {
    kirim.mockResolvedValue({ Errors: [{ Key: 'privat.jpg', Code: 'AccessDenied', Message: 'rahasia' }] });
    await expect(deleteObjects('public', ['privat.jpg'])).rejects.toThrow('Penghapusan objek belum selesai');
  });

  it('bucket draf harus berbeda dari bucket publik', () => {
    expect(bucketTerpisah()).toBe(true);
    process.env.R2_BUCKET_PRIVATE = 'pub';
    expect(bucketTerpisah()).toBe(false);
    delete process.env.R2_BUCKET_PRIVATE;
    expect(bucketTerpisah()).toBe(false);
  });

  it('urlPublik menggabungkan basis tanpa garis miring ganda', () => {
    expect(urlPublik('umkm-photos/x.jpg')).toBe('https://pub.example.org/umkm-photos/x.jpg');
  });

  it('r2Tersedia false bila env kurang; fungsi melempar galat jelas', async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    expect(r2Tersedia()).toBe(false);
    await expect(putObject('private', 'k', new Uint8Array(), 'x/y')).rejects.toThrow('R2 belum dikonfigurasi');
  });
});
