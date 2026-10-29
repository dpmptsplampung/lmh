// Khusus tes: mengarahkan fungsi @/lib/storage/r2 ke tiruan `supabase.storage` yang sudah dipakai tes lama,
// sehingga tes route investment-docs tetap memeriksa perilaku yang sama (urutan, pembersihan, galat) tanpa jaringan.
type Fn = (...args: unknown[]) => Promise<unknown>;

export function r2DariTiruanSupabase(createClient: Fn) {
  const hapusAwalan = (k: string) => k.replace(/^investment-docs\//, '');
  const bucket = async () => ((await createClient()) as { storage: { from: (n: string) => Record<string, Fn> } }).storage.from('investment-docs');
  return {
    r2Tersedia: () => true,
    putObject: async (_b: string, key: string, body: unknown, contentType: string) => {
      const r = (await (await bucket()).upload(hapusAwalan(key), body, { contentType, upsert: false })) as { error?: unknown } | undefined;
      if (r?.error) throw r.error;
    },
    deleteObjects: async (_b: string, keys: string[]) => {
      const r = (await (await bucket()).remove(keys.map(hapusAwalan))) as { error?: unknown } | undefined;
      if (r?.error) throw r.error;
    },
    getObjectBytes: async (_b: string, key: string) => {
      const r = (await (await bucket()).download(hapusAwalan(key))) as { data?: Blob | null; error?: unknown };
      if (r.error || !r.data) return null;
      return new Uint8Array(await r.data.arrayBuffer());
    },
    presignGet: async (_b: string, key: string, ttl?: number) => {
      const r = (await (await bucket()).createSignedUrl(hapusAwalan(key), ttl)) as { data?: { signedUrl: string } | null; error?: unknown };
      if (r.error || !r.data) throw r.error ?? new Error('presign gagal');
      return r.data.signedUrl;
    },
  };
}
