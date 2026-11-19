import { describe, expect, it } from 'vitest';
import type { MinatRingkas } from '@/lib/data/investasi';
import { bacaGalatUbahStatus, judulKonteks, labelStatus, nadaStatus, tautanBalas, tautanEmail } from './KotakMasukLogika';

const dasar: MinatRingkas = {
  id: 'a', kanal: 'ipro', status: 'baru', versi: 1, nama: 'Budi Santoso', instansi: 'PT Maju Jaya',
  created_at: '2026-11-19T03:00:00Z', aktivitas_pada: '2026-11-19T03:00:00Z', petugas_id: null,
  ipro_id: 'p', doc_id: null, ipro_proyek: { judul: 'Pabrik Singkong' }, investment_documents: null,
};

describe('KotakMasukLogika', () => {
  it('judulKonteks mengikuti kanal dan null bila konteks hilang', () => {
    expect(judulKonteks(dasar)).toBe('Pabrik Singkong');
    expect(judulKonteks({ ...dasar, kanal: 'dokumen', ipro_proyek: null, investment_documents: { judul: 'Peta Potensi' } })).toBe('Peta Potensi');
    expect(judulKonteks({ ...dasar, ipro_proyek: null })).toBeNull();
  });

  it('label dan nada status', () => {
    expect(labelStatus('dihubungi')).toBe('Dihubungi');
    expect(labelStatus('aneh')).toBe('aneh');
    expect(nadaStatus('baru')).toBe('info');
    expect(nadaStatus('ditolak')).toBe('bahaya');
    expect(nadaStatus('selesai')).toBe('sukses');
    expect(nadaStatus('berlanjut')).toBe('netral');
  });

  it('tautan email meng-encode penerima dan subjek', () => {
    const t = tautanBalas('budi+investasi@contoh.id', 'Pabrik & Gudang')!;
    expect(t.startsWith('mailto:budi%2Binvestasi%40contoh.id?subject=')).toBe(true);
    expect(tautanEmail('budi+investasi@contoh.id')).toBe('mailto:budi%2Binvestasi%40contoh.id');
    expect(t).not.toContain('&G');
    expect(decodeURIComponent(t.split('subject=')[1])).toBe('Tanggapan atas minat Anda: Pabrik & Gudang');
    expect(decodeURIComponent(tautanBalas('a@b.id', null)!.split('subject=')[1])).toBe('Tanggapan atas minat investasi Anda');
  });

  it.each([
    'investor@example.org?bcc=salin%40evil.example&body=', 'investor&salin@example.org',
    'investor%40salin@example.org', 'investor@example.org#body', 'investor lain@example.org',
    'a,b@example.org', 'a;b@example.org', '"a"@example.org', '<a>@example.org',
    'a..b@example.org', '.a@example.org', 'a@-example.org', 'a@example.org\n',
  ])('alamat tidak sah tidak menjadi tautan mailto: %s', (email) => {
    expect(tautanBalas(email, 'Proyek')).toBeNull();
    expect(tautanEmail(email)).toBeNull();
  });

  it('bacaGalatUbahStatus memetakan KONFLIK_VERSI dan galat lain', () => {
    expect(bacaGalatUbahStatus({ error: { code: 'KONFLIK_VERSI', message: 'x' } }, 409).konflik).toBe(true);
    expect(bacaGalatUbahStatus(null, 409).konflik).toBe(true);
    const g = bacaGalatUbahStatus({ error: { code: 'DILARANG', message: 'Akun ini tidak berwenang.' } }, 403);
    expect(g).toMatchObject({ kode: 'DILARANG', konflik: false, pesan: 'Akun ini tidak berwenang.' });
    expect(bacaGalatUbahStatus('x', 500).kode).toBe('GAGAL_INTERNAL');
  });
});
