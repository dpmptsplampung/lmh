import { describe, expect, it } from 'vitest';
import { pesanDokumenSchema, pesanIproSchema, ubahStatusMinatSchema } from './skema-minat';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const umum = { nama: 'Budi', email: 'budi@example.com', operasi_id: ID, setuju_pdp: true };

describe('skema minat investasi', () => {
  it('menerima batas panjang nama, email, instansi, dan pesan IPRO', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    expect(pesanIproSchema.safeParse({ ...umum, email, nama: 'a'.repeat(200),
      instansi: 'a'.repeat(200), pesan: 'a'.repeat(2000), ipro_id: ID }).success).toBe(true);
  });

  it.each([
    { nama: 'a'.repeat(201) }, { instansi: 'a'.repeat(201) }, { pesan: 'a'.repeat(2001) },
    { email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}` },
  ])('menolak panjang melebihi kontrak: %j', async perubahan => {
    expect(pesanIproSchema.safeParse({ ...umum, ipro_id: ID, pesan: 'Mohon informasi.', ...perubahan }).success).toBe(false);
  });

  it('dokumen menerima pesan opsional tanpa batas minimal IPRO', () => {
    expect(pesanDokumenSchema.safeParse({ ...umum, doc_id: ID }).success).toBe(true);
    expect(pesanDokumenSchema.safeParse({ ...umum, doc_id: ID, pesan: 'Halo' }).success).toBe(true);
  });

  it('kanal hanya ditentukan server berdasarkan route', () => {
    expect(pesanDokumenSchema.safeParse({ ...umum, doc_id: ID, kanal: 'ipro' }).success).toBe(false);
    expect(pesanIproSchema.safeParse({ ...umum, ipro_id: ID, pesan: 'Mohon informasi.', doc_id: ID }).success).toBe(false);
  });

  it('versi status dibatasi integer PostgreSQL positif', () => {
    expect(ubahStatusMinatSchema.safeParse({ status: 'baru', versi: 2147483647 }).success).toBe(true);
    expect(ubahStatusMinatSchema.safeParse({ status: 'baru', versi: 2147483648 }).success).toBe(false);
  });
});
