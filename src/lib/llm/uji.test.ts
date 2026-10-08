import { describe, expect, it, vi } from 'vitest';
import { buildCurl, ujiPenyedia } from './uji';
import type { ProviderSpec } from './registry';

const spec: ProviderSpec = {
  name: 'GW', baseURL: 'https://gw.example.com/v1/', apiKeyEnv: '', apiKey: 'sk-RAHASIA-PENUH-abcd', model: 'm1', guarded: true,
};
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('ujiPenyedia', () => {
  it('lulus: status, latensi, cuplikan, token; curl memakai kunci TERSAMAR', async () => {
    const f = vi.fn(async () => resp({ choices: [{ message: { content: 'SIAP' } }], usage: { prompt_tokens: 7, completion_tokens: 1 } }));
    const r = await ujiPenyedia(spec, 'abcd', f as never);
    expect(r).toMatchObject({ ok: true, http_status: 200, cuplikan: 'SIAP', tokens: { masuk: 7, keluar: 1 }, error: null });
    expect(r.latensi_ms).toBeGreaterThanOrEqual(0);
    expect(r.curl).toContain("https://gw.example.com/v1/chat/completions");
    expect(r.curl).toContain('Bearer ••••abcd');
    expect(JSON.stringify(r)).not.toContain('sk-RAHASIA-PENUH');
    // kunci asli tetap dikirim ke penyedia, bukan ke hasil
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-RAHASIA-PENUH-abcd');
  });
  it('HTTP gagal -> ok false + status; galat jaringan dipotong 200 karakter', async () => {
    expect(await ujiPenyedia(spec, 'abcd', (async () => resp({}, 401)) as never)).toMatchObject({ ok: false, http_status: 401 });
    const r = await ujiPenyedia(spec, 'abcd', (async () => { throw new Error('x'.repeat(500)); }) as never);
    expect(r.ok).toBe(false);
    expect(r.http_status).toBeNull();
    expect(r.error!.length).toBe(200);
  });
  it('balasan kosong / bukan format OpenAI -> gagal', async () => {
    expect((await ujiPenyedia(spec, 'abcd', (async () => resp({ foo: 1 })) as never)).ok).toBe(false);
  });
  it('tanpa kunci: curl tanpa header Authorization', () => {
    expect(buildCurl({ ...spec, apiKey: undefined }, null)).not.toContain('Authorization');
  });
  it('curl aman dari kutip tunggal', () => {
    expect(buildCurl({ ...spec, model: "a'b" }, 'abcd')).toContain(`a'\\''b`);
  });
});
