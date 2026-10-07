import { describe, expect, it } from 'vitest';
import { mergeMessages, rtFromStatus, type ChatMsg } from './merge';

const m = (id: string, t: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({
  id,
  pengirim: 'pengunjung',
  isi: id,
  created_at: `2026-01-01T00:00:${t}Z`,
  ...extra,
});

describe('mergeMessages', () => {
  it('menggantikan pesan pending dengan pesan server ber-client_uuid sama (tanpa duplikat)', () => {
    const prev = [m('user-u1', '05', { client_uuid: 'u1', local: 'pending' })];
    const out = mergeMessages(prev, [m('s1', '06', { client_uuid: 'u1' })]);
    expect(out.map((x) => x.id)).toEqual(['s1']);
  });

  it('mempertahankan pesan lokal (notice, failed) saat poll mengganti utas', () => {
    const prev = [
      m('welcome', '00', { pengirim: 'bot', local: 'notice' }),
      m('user-u2', '09', { client_uuid: 'u2', local: 'failed' }),
      m('s1', '01'),
    ];
    const out = mergeMessages(prev, [m('s1', '01'), m('s2', '02')]);
    expect(out.map((x) => x.id)).toEqual(['welcome', 's1', 's2', 'user-u2']);
  });

  it('membuang notice lokal yang sama dengan pesan bot server', () => {
    const prev = [m('n', '00', { pengirim: 'bot', isi: 'halo', local: 'notice' })];
    const out = mergeMessages(prev, [m('s1', '01', { pengirim: 'bot', isi: 'halo' })]);
    expect(out.map((x) => x.id)).toEqual(['s1']);
  });

  it('idempoten untuk event realtime ganda dan tidak menghapus pesan server sebelumnya', () => {
    const a = mergeMessages([], [m('s1', '01')]);
    const b = mergeMessages(a, [m('s2', '02')]);
    expect(mergeMessages(b, [m('s2', '02')]).map((x) => x.id)).toEqual(['s1', 's2']);
  });
});

describe('rtFromStatus', () => {
  it('memetakan status subscribe', () => {
    expect(rtFromStatus('SUBSCRIBED')).toBe('ok');
    expect(rtFromStatus('TIMED_OUT')).toBe('down');
    expect(rtFromStatus('CLOSED')).toBe('down');
    expect(rtFromStatus('JOINING')).toBe('connecting');
  });
});

describe('transient notice', () => {
  it('hilang saat pesan bot server tiba', () => {
    const prev = [m('n', '10', { pengirim: 'bot', local: 'notice', transient: true })];
    expect(mergeMessages(prev, [m('b', '11', { pengirim: 'bot' })]).map((x) => x.id)).toEqual(['b']);
  });
});
