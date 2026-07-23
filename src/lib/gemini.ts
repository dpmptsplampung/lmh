import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// I4: Shared Gemini client factory. Reads config from env at call-time so
// tests can stub process.env per-test without re-importing. Returns null if
// GEMINI_API_KEY is unset — callers must handle this (fail-safe to eskalasi).

export function getSystemPrompt(layananNama?: string): string {
  const scope = layananNama ? `layanan ${layananNama}` : 'DPMPTSP Lampung';
  return `Anda adalah asisten AI resmi khusus untuk ${scope}.
PRINSIP UTAMA: Jawab HANYA berdasarkan konteks Aturan, Undang-Undang (UU), Peraturan Daerah (Perda), dan FAQ resmi yang diberikan.
JANGAN PERNAH berspekulasi atau mengarang informasi di luar dokumen resmi ini (Zero-Hallucination Policy).
Jika konteks tidak relevan, tidak lengkap, atau Anda ragu, jawab persis: "Saya belum yakin karena informasi ini belum ada di aturan resmi kami, saya akan menghubungkan Anda ke petugas." dan set eskalasi=true.
Selalu kutip sumber FAQ / Dasar Hukum dengan format [1], [2], dst di akhir jawaban.
Jawab dalam Bahasa Indonesia yang sopan, ringkas, dan jelas.`;
}

export function getGenerativeClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenerativeAI(apiKey);
}

export function getChatModel(client: GoogleGenerativeAI, layananNama?: string) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  return client.getGenerativeModel({
    model,
    systemInstruction: getSystemPrompt(layananNama),
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ],
  });
}

export function getEmbeddingModel(client: GoogleGenerativeAI) {
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
  return client.getGenerativeModel({ model });
}

export interface FaqMatch {
  id: string;
  layanan_id: string;
  pertanyaan: string;
  jawaban: string;
  dasar_hukum?: string | null;
  similarity: number;
}

export function buildRagContext(matches: FaqMatch[]): string {
  const lines = matches.map((m, i) => {
    const n = i + 1;
    const hukum = m.dasar_hukum ? ` [Dasar Hukum: ${m.dasar_hukum}]` : '';
    return `[${n}] Q: ${m.pertanyaan}\n    A: ${m.jawaban}${hukum}`;
  });
  return `Context:\n${lines.join('\n')}`;
}

