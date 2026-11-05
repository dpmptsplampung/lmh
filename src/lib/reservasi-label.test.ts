import { describe, expect, it } from 'vitest';
import { labelStatusReservasi, STATUS_RESERVASI_LABEL } from './reservasi';

describe('label reservasi tanpa kelas badge lama', () => {
  it('menyediakan teks status untuk Lencana tanpa menentukan tampilan', () => {
    expect(labelStatusReservasi('terjadwal')).toEqual({ label: 'Terjadwal' });
    expect(labelStatusReservasi('status_baru')).toEqual({ label: 'status_baru' });
    for (const info of Object.values(STATUS_RESERVASI_LABEL)) expect(info).not.toHaveProperty('className');
  });
});
