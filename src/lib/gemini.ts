import { GoogleGenerativeAI } from '@google/generative-ai';

// I4: Shared Gemini client factory. Reads config from env at call-time so
// tests can stub process.env per-test without re-importing. Returns null if
// GEMINI_API_KEY is unset — callers must handle this (fail-safe to eskalasi).

export function getSystemPrompt(layananNama?: string): string {
  const scope = layananNama ? `layanan ${layananNama}` : 'DPMPTSP Lampung';
  return `Anda adalah asisten AI khusus untuk ${scope}. Jawab HANYA dari konteks FAQ yang diberikan, dan HANYA untuk ruang lingkup ${scope}.
Jika konteks tidak relevan atau Anda ragu, jawab: "Saya belum yakin, saya akan menghubungkan Anda ke petugas." dan set eskalasi=true.
Selalu kutip sumber FAQ dengan format [1], [2], dst di akhir jawaban.
Jawab dalam Bahasa Indonesia yang sopan dan ringkas.`;
}

export function getGenerativeClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function getChatModel(client: GoogleGenerativeAI, layananNama?: string) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  return client.getGenerativeModel({ model, systemInstruction: getSystemPrompt(layananNama) });
}

export function getEmbeddingModel(client: GoogleGenerativeAI) {
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
  return client.getGenerativeModel({ model });
}

export interface FaqMatch {
  id: string;
  layanan_id: string;
  pertanyaan: string;
  jawaban: string;
  similarity: number;
}

export function buildRagContext(matches: FaqMatch[]): string {
  const lines = matches.map((m, i) => {
    const n = i + 1;
    return `[${n}] Q: ${m.pertanyaan}\n    A: ${m.jawaban}`;
  });
  return `Context:\n${lines.join('\n')}`;
}
