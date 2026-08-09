// Verifikasi retrieval FAQ per layanan dengan model embedding yang sama seperti bot.
import { readFileSync } from 'node:fs';

readFileSync('.env.local', 'utf8').split(/\r?\n/).forEach((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
});

const [{ createClient }, { GoogleGenerativeAI }] = await Promise.all([
  import('@supabase/supabase-js'),
  import('@google/generative-ai'),
]);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!url || !serviceKey || !geminiApiKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan GEMINI_API_KEY wajib tersedia.',
  );
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const embedModel = new GoogleGenerativeAI(geminiApiKey)
  .getGenerativeModel({ model: 'gemini-embedding-001' });
const THRESHOLD = 0.7;

const CASES = [
  { layanan: 'BALMON', id: '2af4d908-7374-40f3-b6c6-de8fa5e88358', query: 'Apakah penggunaan spektrum frekuensi radio harus memiliki izin?' },
  { layanan: 'Bank Lampung', id: '20e1282d-a951-49a9-8aed-b413b1140aca', query: 'Bagaimana bank wajib menangani pengaduan nasabah?' },
  { layanan: 'BPJS Kesehatan', id: '0ad0b7d4-07db-4d7e-9efe-23dfcb26c175', query: 'Apakah bayi baru lahir mendapatkan jaminan BPJS Kesehatan?' },
  { layanan: 'Helpdesk OSS', id: '8d1025b2-5fe8-4117-8882-d5e5eeedc734', query: 'Apakah NIB cukup untuk usaha dengan risiko tinggi?' },
  { layanan: 'Layanan Jasa Industri', id: '7114ddc1-5aae-493b-b1e5-125cc6256e88', query: 'Apakah semua penerapan SNI bersifat wajib?' },
  { layanan: 'Perizinan DPMPTSP', id: '6052844e-eded-4c3d-a4e0-89384b5c9755', query: 'Apakah konsultasi dan pengaduan perizinan di DPMPTSP tersedia?' },
  { layanan: 'Sertifikasi Halal', id: '1098d6cb-c9aa-4dff-8e3d-b2f821ec2503', query: 'Apakah fasilitas produksi halal harus dipisahkan dari produk tidak halal?' },
  { layanan: 'Mutu Hasil Perikanan', id: 'e588d321-ad23-405c-ad3d-6bbd6aa9084c', query: 'Berapa masa berlaku SKP hasil perikanan?' },
];

async function main() {
  let failures = 0;

  for (const testCase of CASES) {
    const result = await embedModel.embedContent(testCase.query);
    const vector = result.embedding.values;
    if (vector?.length !== 3072) {
      throw new Error(`${testCase.layanan}: dimensi embedding ${vector?.length ?? 0}, seharusnya 3072.`);
    }

    const { data, error } = await supabase.rpc('match_faq', {
      query_embedding: `[${vector.join(',')}]`,
      p_layanan_id: testCase.id,
      match_count: 1,
    });
    if (error) throw new Error(`${testCase.layanan}: RPC match_faq gagal: ${error.message}`);

    const top = data?.[0];
    const similarity = Number(top?.similarity ?? 0);
    const passed = similarity >= THRESHOLD;
    if (!passed) failures++;
    console.log(
      `${passed ? '✓' : '✗'} ${testCase.layanan}: ${similarity.toFixed(4)} — ${top?.pertanyaan ?? 'tidak ada hasil'}`,
    );
  }

  if (failures > 0) {
    throw new Error(`${failures}/${CASES.length} layanan berada di bawah threshold ${THRESHOLD}.`);
  }
  console.log(`✓ Semua ${CASES.length} layanan lolos threshold ${THRESHOLD}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
