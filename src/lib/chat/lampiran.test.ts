import { describe, expect, it } from 'vitest';
import { bersihkanNamaBerkas, ekstensiDariMime, kunciMilikSesi, pathLampiran } from './lampiran';

const SESI = '11111111-1111-1111-1111-111111111111';

describe('lampiran chat', () => {
  it('pathLampiran berawalan sesi dan berekstensi benar', () => {
    expect(pathLampiran(SESI, 'png')).toMatch(new RegExp(`^${SESI}/[0-9a-f-]{36}\\.png$`));
    expect(ekstensiDariMime('image/jpeg')).toBe('jpg');
    expect(ekstensiDariMime('image/gif')).toBeNull();
  });
  it('kunciMilikSesi hanya menerima kunci sesi itu sendiri', () => {
    const u = '22222222-2222-2222-2222-222222222222';
    expect(kunciMilikSesi(`chat-lampiran/${SESI}/${u}.jpg`, SESI)).toBe(true);
    expect(kunciMilikSesi(`chat-lampiran/33333333-3333-3333-3333-333333333333/${u}.jpg`, SESI)).toBe(false);
    expect(kunciMilikSesi(`chat-lampiran/${SESI}/../x.jpg`, SESI)).toBe(false);
    expect(kunciMilikSesi(`investment-docs/${SESI}/${u}.jpg`, SESI)).toBe(false);
  });
  it('bersihkanNamaBerkas membuang path dan karakter kontrol', () => {
    expect(bersihkanNamaBerkas('C:\\foto\\a.jpg')).toBe('a.jpg');
    expect(bersihkanNamaBerkas('../../etc/pass\u0000wd.png')).toBe('passwd.png');
    expect(bersihkanNamaBerkas('')).toBe('foto');
    expect(bersihkanNamaBerkas('x'.repeat(300)).length).toBe(120);
  });
});
