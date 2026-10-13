// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PERNYATAAN_KEBENARAN_JENIS,
  PERNYATAAN_KEBENARAN_TEKS,
  PERNYATAAN_KEBENARAN_VERSI,
} from './pernyataan-kebenaran';

// Pasangan terkunci (VERSI, hash TEKS). Mengubah TEKS membuat tes ini gagal: naikkan VERSI lalu perbarui pasangan ini,
// sehingga baris consent_log lama tetap merujuk teks yang benar-benar dibaca pengunjung.
const PASANGAN_TERKUNCI = {
  versi: '1.0',
  sha256: 'fdc85dcbaeba456c7199ceadc6fdef193ff6f2e06a05e0609b3c22a8047bd7f8',
};

describe('pernyataan kebenaran (K12)', () => {
  it('teks persis sesuai keputusan CEO', () => {
    expect(PERNYATAAN_KEBENARAN_TEKS).toBe(
      'Saya menyatakan bahwa seluruh data yang saya isi adalah benar dan dapat dipertanggungjawabkan. ' +
        'Saya memahami bahwa data yang tidak benar dapat menghambat atau membatalkan layanan.',
    );
  });

  it('jenis consent_log tetap pernyataan_kebenaran', () => {
    expect(PERNYATAAN_KEBENARAN_JENIS).toBe('pernyataan_kebenaran');
  });

  it('versi dan hash teks terkunci berpasangan (ubah teks = naikkan versi)', () => {
    const hash = createHash('sha256').update(PERNYATAAN_KEBENARAN_TEKS).digest('hex');
    expect({ versi: PERNYATAAN_KEBENARAN_VERSI, sha256: hash }).toEqual(PASANGAN_TERKUNCI);
  });
});
