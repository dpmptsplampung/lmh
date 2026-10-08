// Inti bot chat (dipakai route /api/chat/ai dan "Coba tanya bot" admin): TIDAK menyimpan apa pun.
// Urutan jawaban (tidak boleh dipotong): FAQ FTS -> embedding FAQ (match_faq) + Dokumen Peraturan
// (match_dokumen_layanan) -> LLM (rantai konsol Admin, fallback env). Kegagalan embedding/dokumen
// turun ke FAQ-FTS, bukan memutus bot.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildRagContext, getChatModel, getEmbeddingModel, getGenerativeClient, getSystemPrompt, type FaqMatch,
} from '@/lib/gemini';
import { normalizeQuestion } from '@/lib/chat/normalize';
import { generateWithFallback } from '@/lib/llm/registry';
import { getLlmSpecs } from '@/lib/settings/llm-config';
import { logServerEvent } from '@/lib/observability/logger';
import { detectPromptInjection, redactPii } from '@/lib/pii';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { hitungMode, labelTanggalID, parseJamTutup, type ModeLayanan } from '@/lib/llm/bot-waktu';

const SIMILARITY_THRESHOLD = 0.7;
const DOC_THRESHOLD = 0.7;
const FTS_THRESHOLD = Number(process.env.BOT_FTS_THRESHOLD) || 0.15;

export const FALLBACK_TEXT =
  'Maaf, asisten virtual sedang mengalami kendala. Percakapan Anda telah diteruskan ke petugas kami dan akan dibalas secepatnya.';
export const DI_LUAR_LINGKUP = '[[DI_LUAR_LINGKUP]]';

const cause = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export interface SumberDokumen {
  id: string; dokumen_id: string; judul: string; nomor_pasal: string | null; sumber_url: string | null;
}

export type BotHasil =
  | {
      kind: 'ok';
      jawaban: string;
      sumber: Array<{ id: string; pertanyaan: string }>;
      sumberDokumen: SumberDokumen[];
      eskalasi: boolean;
      reason: string | null;
      faqIds: string[];
      topSim: number | null;
      sumberFaqId: string | null;
      provider: string | null;
      mode: ModeLayanan;
    }
  | { kind: 'gagal'; operation: string; err: unknown; faqIds: string[]; topSim: number | null; text: string; reason: string };

export const teksTolak = (nama?: string | null) =>
  `Mohon maaf, saya hanya dapat membantu seputar ${nama ? `layanan ${nama}` : 'layanan ini'}. ` +
  'Untuk topik lain, silakan pilih layanan yang sesuai atau tanyakan langsung kepada petugas kami. ' +
  'Ada hal lain seputar layanan ini yang bisa saya bantu?';

const aturanLingkup = (nama?: string | null) =>
  `[RUANG LINGKUP KETAT]: Anda HANYA melayani ${nama ? `layanan ${nama}` : 'layanan yang dipilih pengunjung'}. ` +
  'Jawab hanya berdasarkan konteks resmi (FAQ / Dokumen Peraturan) yang diberikan. ' +
  'Sapaan dan basa-basi sederhana (halo, terima kasih, apa kabar) tetap dibalas ramah. ' +
  `Jika pertanyaan berada DI LUAR layanan tersebut (topik umum, hiburan, layanan lain, atau hal tak terkait), tulis HANYA penanda ${DI_LUAR_LINGKUP} lalu berhenti — jangan menjawab isinya.`;

async function muatKalender(admin: SupabaseClient, now: Date): Promise<ModeLayanan> {
  let jam: string | null = null;
  const libur = new Set<string>();
  try {
    const { data } = await admin.from('site_settings').select('value').eq('key', 'jam_tutup_layanan').maybeSingle();
    jam = (data as { value?: string } | null)?.value ?? null;
  } catch { /* default 16:00 */ }
  try {
    const { data } = await admin
      .from('hari_libur')
      .select('tanggal')
      .gte('tanggal', todayWIB())
      .lte('tanggal', addDaysWIB(30, now));
    for (const r of (data ?? []) as Array<{ tanggal: string }>) libur.add(r.tanggal);
  } catch { /* anggap tidak ada libur */ }
  return hitungMode(now, parseJamTutup(jam), libur);
}

type DokRow = SumberDokumen & { teks: string; similarity: number };

function buildDokumenContext(rows: DokRow[]): string {
  const lines = rows.map((r, i) => {
    const pasal = r.nomor_pasal ? ` — ${r.nomor_pasal}` : '';
    return `[P${i + 1}] ${r.judul}${pasal}: ${r.teks.slice(0, 900)}`;
  });
  return `Dokumen Peraturan (sumber resmi, kutip [P1], [P2] bila dipakai):\n${lines.join('\n')}`;
}

const GREETING_RE =
  /^(h[ae]lo+|hai+|hi+|hei+|helo+|hallo+|selamat (pagi|siang|sore|malam)|ass?alamu?(['’]?alaikum)?|salam(sejahtera)?|pagi|siang|sore|malam|tes?t?|ping|apa ?kabar|terima ?kasih|makasih|thanks|thank ?you)[.!\s]*$/i;

export async function jalankanBot(input: {
  admin: SupabaseClient;
  pertanyaan: string; // sudah di-redact PII
  rawPertanyaan: string;
  layananId: string;
  layananNama?: string | null;
  now?: Date;
}): Promise<BotHasil> {
  const { admin, pertanyaan, layananId } = input;
  const layananNama = input.layananNama ?? undefined;
  const now = input.now ?? new Date();

  if (detectPromptInjection(input.rawPertanyaan)) {
    return {
      kind: 'gagal', operation: 'chat.ai.prompt_injection', err: new Error('prompt injection terdeteksi'),
      faqIds: [], topSim: null, reason: 'prompt_injection',
      text: 'Maaf, pertanyaan Anda mengandung instruksi yang tidak diizinkan. Saya akan menghubungkan Anda ke petugas.',
    };
  }

  const mode = await muatKalender(admin, now);
  const baseOk = { sumberDokumen: [] as SumberDokumen[], provider: null as string | null, mode };

  // TINGKAT 0 — pencocok FAQ deterministik di Postgres (tanpa LLM).
  type FtsRow = { id: string; pertanyaan: string; jawaban: string; skor: number };
  let ftsCandidates: FtsRow[] = [];
  try {
    const { data, error } = await admin.rpc('match_faq_teks', {
      p_layanan: layananId, p_q: normalizeQuestion(pertanyaan), p_limit: 3,
    });
    if (error) {
      logServerEvent('warn', { operation: 'chat.ai.fts', route: '/api/chat/ai', cause: error.message });
    } else if (Array.isArray(data)) {
      ftsCandidates = data as FtsRow[];
    }
    const top = ftsCandidates[0];
    if (top && top.skor >= FTS_THRESHOLD) {
      return {
        kind: 'ok', ...baseOk, jawaban: top.jawaban, sumber: [{ id: top.id, pertanyaan: top.pertanyaan }],
        eskalasi: false, reason: 'fts_exact', faqIds: [top.id], topSim: null, sumberFaqId: top.id,
      };
    }
  } catch (e) {
    logServerEvent('warn', { operation: 'chat.ai.fts', route: '/api/chat/ai', cause: cause(e) });
  }

  // Embedding + match_faq (+ Dokumen Peraturan). Kegagalan TIDAK langsung eskalasi: turun ke FTS.
  const genAI = getGenerativeClient();
  let faqMatches: FaqMatch[] = [];
  let dokumen: DokRow[] = [];
  let degraded: string | null = null;
  try {
    if (!genAI) throw new Error('GEMINI_API_KEY tidak diset');
    const embedModel = getEmbeddingModel(genAI, 'gemini-embedding-001'); // FAQ col = 3072
    const result = await embedModel.embedContent(pertanyaan);
    const queryEmbedding = result.embedding.values;
    if (!queryEmbedding || queryEmbedding.length === 0) throw new Error('embedding kosong');
    const { data: matches, error: matchErr } = await admin.rpc('match_faq', {
      query_embedding: `[${queryEmbedding.join(',')}]`, p_layanan_id: layananId, match_count: 5,
    });
    if (matchErr) throw new Error(`match_faq: ${matchErr.message}`);
    faqMatches = (matches ?? []) as FaqMatch[];
  } catch (e) {
    degraded = cause(e);
    logServerEvent('error', { operation: 'chat.ai.embed_or_match', route: '/api/chat/ai', cause: degraded });
    if (ftsCandidates.length === 0) {
      return { kind: 'gagal', operation: 'chat.ai.no_context', err: e, faqIds: [], topSim: null, text: FALLBACK_TEXT, reason: 'ai_error' };
    }
    faqMatches = ftsCandidates.map((c) => ({
      id: c.id, layanan_id: layananId, pertanyaan: c.pertanyaan, jawaban: c.jawaban, similarity: 0,
    }));
  }

  // Dokumen Peraturan: model embedding indeks dokumen (sama dengan route embed dokumen). Gagal = lewati.
  if (!degraded && genAI) {
    try {
      const res = await getEmbeddingModel(genAI).embedContent(pertanyaan);
      const v = res.embedding.values;
      if (v && v.length > 0) {
        const { data, error } = await admin.rpc('match_dokumen_layanan', {
          p_embedding: `[${v.join(',')}]`, p_match_threshold: DOC_THRESHOLD, p_match_count: 3, p_layanan_id: layananId,
        });
        if (error) throw new Error(error.message);
        dokumen = ((data ?? []) as DokRow[]).filter((r) => typeof r?.teks === 'string' && r.teks.length > 0);
      }
    } catch (e) {
      logServerEvent('warn', { operation: 'chat.ai.dokumen', route: '/api/chat/ai', cause: cause(e) });
    }
  }

  const isExactMatch = !degraded && faqMatches.length > 0 && faqMatches[0].similarity >= SIMILARITY_THRESHOLD;
  const adaDokumen = dokumen.length > 0;
  const grounded = isExactMatch || adaDokumen;
  const topSim = !degraded && faqMatches.length > 0 ? faqMatches[0].similarity : null;
  const faqIds = isExactMatch ? faqMatches.map((m) => m.id) : [];

  const trimmed = pertanyaan.trim();
  const isGreeting = trimmed.length <= 30 && !trimmed.includes('?') && GREETING_RE.test(trimmed);

  const lingkup = aturanLingkup(layananNama);
  const dokCtx = adaDokumen ? buildDokumenContext(dokumen) : '';
  const faqCtx = (n: number) => (faqMatches.length > 0 ? buildRagContext(faqMatches.slice(0, n)) : '');
  const gabung = (...p: string[]) => p.filter(Boolean).join('\n\n');

  let context: string;
  if (mode.tutup) {
    const sampai = mode.kerjaBerikutnya ? labelTanggalID(mode.kerjaBerikutnya) : 'hari kerja berikutnya';
    const sebab = mode.alasan === 'setelah_jam_tutup' ? 'layanan sudah tutup untuk hari ini' : mode.alasan === 'libur_nasional' ? 'hari ini hari libur' : 'hari ini Sabtu/Minggu';
    context = gabung(
      `[MODE DI LUAR JAM LAYANAN]: ${sebab} — petugas tidak bertugas. Jawab HANYA pertanyaan umum seputar layanan, persyaratan, dan jam operasional berdasarkan konteks resmi. Jika pertanyaan membutuhkan petugas atau di luar konteks, sampaikan dengan sopan bahwa petugas akan membantu pada ${sampai}. JANGAN menawarkan eskalasi atau koneksi langsung ke petugas.`,
      lingkup, faqCtx(3), dokCtx,
    );
  } else if (isExactMatch) {
    context = gabung(lingkup, buildRagContext(faqMatches), dokCtx);
  } else if (isGreeting) {
    context = `[SAPAAN]: Pengunjung membuka dengan sapaan/basa-basi. Balas dengan ramah dan hangat, perkenalkan diri sebagai asisten virtual ${layananNama ?? 'layanan ini'}, dan tawarkan bantuan (mis. tanyakan apa yang ingin mereka ketahui seputar layanan, persyaratan, atau jam operasional). JANGAN menawarkan eskalasi ke petugas.`;
  } else {
    context = gabung(
      '[INFORMASI LAYANAN]: Jawablah pertanyaan pengunjung secara ramah dan membantu HANYA dalam lingkup layanan ini, berdasarkan konteks resmi di bawah. Jika konteks tidak memuat jawabannya tetapi pertanyaan masih seputar layanan ini, katakan dengan jujur bahwa Anda belum yakin dan petugas kami siap membantu.',
      lingkup, faqCtx(3), dokCtx,
    );
  }

  // Jawaban: rantai konsol Admin (DB) bila ada; kosong -> jalur lama (SDK Gemini + LLM_CHAT_PROVIDERS).
  const specs = await getLlmSpecs(admin);
  const reply = await generateWithFallback(
    !specs && genAI
      ? {
          name: 'gemini',
          generate: async () => {
            const chatModel = getChatModel(genAI, layananNama);
            const result = await chatModel.generateContent([context, pertanyaan]);
            return result.response.text();
          },
        }
      : null,
    { system: getSystemPrompt(layananNama), prompt: `${context}\n\nPertanyaan pengunjung: ${pertanyaan}` },
    { specs: specs ?? undefined },
  );
  let jawaban = reply && reply.text && reply.text.trim().length > 0 ? redactPii(reply.text) : '';

  // Penegakan ruang lingkup di server: penanda dari model -> jawaban DIGANTI teks tolak baku.
  if (jawaban.includes(DI_LUAR_LINGKUP)) {
    return {
      kind: 'ok', ...baseOk, provider: reply?.provider ?? null, jawaban: teksTolak(layananNama), sumber: [],
      eskalasi: false, reason: 'di_luar_lingkup', faqIds: [], topSim, sumberFaqId: null,
    };
  }

  if (!jawaban.trim()) {
    if (isGreeting || mode.tutup) {
      const sampai = mode.kerjaBerikutnya ? labelTanggalID(mode.kerjaBerikutnya) : 'hari kerja berikutnya';
      jawaban = isGreeting
        ? 'Halo! Selamat datang. Ada yang bisa kami bantu seputar layanan kami?'
        : `Terima kasih atas pertanyaan Anda. Petugas kami akan membantu pada ${sampai}.`;
    } else {
      const best = faqMatches[0];
      const text = isExactMatch && best
        ? `${best.jawaban}\n\nPetugas kami juga akan membantu Anda lebih lanjut.`
        : FALLBACK_TEXT;
      return { kind: 'gagal', operation: 'chat.ai.llm_failed', err: new Error('semua penyedia LLM gagal'), faqIds, topSim, text, reason: 'ai_error' };
    }
  }

  const eskalasi = !grounded && !mode.tutup && !isGreeting;
  const reason = grounded
    ? null
    : degraded
      ? 'embedding_fallback'
      : mode.alasan === 'akhir_pekan'
        ? 'weekend_mode'
        : mode.alasan ?? (isGreeting ? 'greeting' : 'no_match');

  return {
    kind: 'ok', jawaban, eskalasi, reason, faqIds, topSim, provider: reply?.provider ?? null, mode,
    sumber: isExactMatch ? faqMatches.map((m) => ({ id: m.id, pertanyaan: m.pertanyaan })) : [],
    sumberDokumen: dokumen.map(({ id, dokumen_id, judul, nomor_pasal, sumber_url }) => ({ id, dokumen_id, judul, nomor_pasal, sumber_url })),
    sumberFaqId: isExactMatch && faqMatches.length > 0 ? faqMatches[0].id : null,
  };
}
