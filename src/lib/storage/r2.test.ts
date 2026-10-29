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
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed.example/x') }));

import { deleteObjects, getObjectBytes, putObject, r2Tersedia, urlPublik } from './r2';

const ENV = {
  R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'ak', R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET_PRIVATE: 'priv', R2_BUCKET_PUBLIC: 'pub', R2_PUBLIC_BASE_URL: 'https://pub.example.org/',
};

describe('r2', () => {
  beforeEach(() => {
    kirim.mockReset();
    Object.assign(process.env, ENV);
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

  it('urlPublik menggabungkan basis tanpa garis miring ganda', () => {
    expect(urlPublik('umkm-photos/x.jpg')).toBe('https://pub.example.org/umkm-photos/x.jpg');
  });

  it('r2Tersedia false bila env kurang; fungsi melempar galat jelas', async () => {
    delete process.env.R2_ACCESS_KEY_ID;
    expect(r2Tersedia()).toBe(false);
    await expect(putObject('private', 'k', new Uint8Array(), 'x/y')).rejects.toThrow('R2 belum dikonfigurasi');
  });
});
