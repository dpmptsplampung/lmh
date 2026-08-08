import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// I4: Shared Gemini client factory. Reads config from env at call-time so
// tests can stub process.env per-test without re-importing. Returns null if
// GEMINI_API_KEY is unset — callers must handle this (fail-safe to eskalasi).

export function getSystemPrompt(layananNama?: string): string {
  const scope = layananNama ? `layanan ${layananNama}` : 'DPMPTSP Lampung';
  return `Anda adalah asisten AI resmi yang ramah untuk ${scope}.

PERILAKU DASAR:
- Jika pengunjung menyapa (mis. "halo", "selamat pagi", "assalamualaikum"), balas sapaan dengan hangat dan tawarkan bantuan. JANGAN eskalasi hanya karena sapaan.
- Jawab pertanyaan umum seputar layanan, persyaratan, jam operasional, dan alur berdasarkan konteks FAQ resmi yang diberikan, dengan Bahasa Indonesia sopan dan ringkas.
- Selalu kutip sumber FAQ / Dasar Hukum dengan format [1], [2], dst bila jawaban berasal dari konteks.

BATASAN (zero-hallucination untuk fakta/regulasi):
- JANGAN mengarang data, nomor, biaya, atau dasar hukum yang tidak ada di konteks.
- HANYA jika pertanyaan membutuhkan data spesifik yang tidak ada di konteks, atau Anda benar-benar ragu, jawab persis: "Saya belum yakin karena informasi ini belum ada di aturan resmi kami, saya akan menghubungkan Anda ke petugas." dan set eskalasi=true.`;
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

/**
 * Kembalikan model embedding Gemini.
 *
 * PENTING — dimensi HARUS cocok dengan kolom pgvector tujuan:
 * - FAQ (`faq_knowledge_base.embedding`) = vector(3072) → pakai 'gemini-embedding-001'.
 * - Dokumen (`dokumen_potongan.embedding`) = vector(768)  → pakai 'text-embedding-004'.
 *
 * Default aman = 768 (text-embedding-004) agar caller lama (dokumen) tidak
 * regresi. Jalur FAQ secara eksplisit meminta 3072 lewat argumen `model`.
 * JANGAN pakai 'gemini-embedding-004' — model itu tidak ada di API.
 */
export function getEmbeddingModel(client: GoogleGenerativeAI, model?: string) {
  const chosen = model ?? process.env.GEMINI_EMBEDDING_MODEL ?? 'text-embedding-004';
  return client.getGenerativeModel({ model: chosen });
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

