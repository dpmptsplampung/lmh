import { GoogleGenerativeAI } from '@google/generative-ai';

// I4: Shared Gemini client factory. Reads config from env at call-time so
// tests can stub process.env per-test without re-importing. Returns null if
// GEMINI_API_KEY is unset — callers must handle this (fail-safe to eskalasi).

export const SYSTEM_PROMPT_RAG = `Anda adalah asisten DPMPTSP Lampung. Jawab HANYA dari konteks FAQ yang diberikan.
Jika konteks tidak relevan atau Anda ragu, jawab: "Saya belum yakin, saya akan menghubungkan Anda ke petugas." dan set eskalasi=true.
Selalu kutip sumber FAQ dengan format [1], [2], dst di akhir jawaban.
Jawab dalam Bahasa Indonesia yang sopan dan ringkas.`;

export function getGenerativeClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function getChatModel(client: GoogleGenerativeAI) {
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  return client.getGenerativeModel({ model, systemInstruction: SYSTEM_PROMPT_RAG });
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
