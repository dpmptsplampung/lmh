import { z } from 'zod';
import { pathTautan, pathVarianWeb } from '@/lib/investasi/aset-halaman';
import { invalidasiInvestasiPublik } from '@/lib/investasi/cache-server';
import { layaniKelola, type IdContext } from '@/lib/investasi/akses-server';
import { bacaJson, galat, galatRpc, headersPrivat } from '@/lib/investasi/http';
import { MutasiError, mutasiBolehKosong } from '@/lib/supabase/mutate';
import { nowServer } from '@/lib/time';
import { kunciObjek } from '@/lib/storage/area';
import { hapusAman, LEASE_MS, sumberFinal } from '../../_logika/unggahan';
import { putObject } from '@/lib/storage/r2';
import { bacaPdf, bukaPdf, buatVarianWeb, renderHalaman } from '../../_logika/pdf';
import { ekstrakTautan } from '../../_logika/ekstraksi-tautan';

export const maxDuration = 60;
function asalMutasi(error: unknown): never {
  throw error instanceof MutasiError ? (error.asal ?? error) : error;
}
const schema = z.object({ mulai: z.number().int().min(1).max(51) }).strict();

export async function POST(request: Request, context: IdContext) {
  return layaniKelola(async (client, requestId) => {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return galat('INPUT_TIDAK_VALID', requestId);
    const parsed = schema.safeParse(await bacaJson(request));
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const { data: doc, error } = await client.from('investment_documents')
      .select('id, file_path, status, halaman_gambar, jumlah_halaman, halaman_selesai, diproses_pada').eq('id', id).maybeSingle();
    if (error) return galatRpc(error, requestId);
    if (!doc) return galat('TIDAK_DITEMUKAN', requestId);
    if (parsed.data.mulai !== doc.halaman_selesai + 1) return galat('KONFLIK_VERSI', requestId);
    const jawaban = (n: number, selesai: boolean) => Response.json({
      halaman_selesai: n, jumlah_halaman: doc.jumlah_halaman, selesai,
    }, { headers: headersPrivat });
    if (doc.status === 'aktif' && doc.halaman_selesai === doc.jumlah_halaman) {
      invalidasiInvestasiPublik();
      return jawaban(doc.halaman_selesai, true);
    }
    if (!['diproses', 'gagal'].includes(doc.status)) return galat('KONFLIK_STATUS', requestId);
    // Render hanya membaca salinan final yang tidak pernah menerima PUT klien, bukan path apa pun dari baris DB.
    if (doc.file_path !== sumberFinal(id)) return galat('KONFLIK_STATUS', requestId);
    const mulaiWaktu = nowServer();
    // Lease CAS pada kolom proses: dua tab hanya satu pemenang; setelah timeout Vercel boleh dilanjutkan.
    if (doc.diproses_pada && mulaiWaktu.getTime() - Date.parse(doc.diproses_pada) < LEASE_MS) return galat('KONFLIK_VERSI', requestId);
    const lease = mulaiWaktu.toISOString();
    let klaim = client.from('investment_documents').update({ diproses_pada: lease, status: 'diproses', galat: null })
      .eq('id', id).eq('status', doc.status).eq('halaman_selesai', doc.halaman_selesai);
    klaim = doc.diproses_pada ? klaim.eq('diproses_pada', doc.diproses_pada) : klaim.is('diproses_pada', null);
    const claimed = await mutasiBolehKosong(klaim.select('id').maybeSingle()).catch(asalMutasi);
    if (!claimed.length) return galat('KONFLIK_VERSI', requestId);
    let pdf: Awaited<ReturnType<typeof bukaPdf>> | undefined;
    let selesaiHalaman = doc.halaman_selesai;
    let belumTercatat: string[] = [];
    let terbit = false;
    const batchId = crypto.randomUUID();
    const gambar: string[] = [...(doc.halaman_gambar ?? [])];
    try {
      pdf = await bukaPdf(await bacaPdf(kunciObjek('investment-docs', sumberFinal(id))));
      const dokumen = pdf.doc;
      if (dokumen.numPages !== doc.jumlah_halaman) throw new Error('INPUT_TIDAK_VALID');
      const simpanTautan = async () => {
        const tautan = await ekstrakTautan(dokumen);
        await putObject('private', kunciObjek('investment-docs', pathTautan(id)), Buffer.from(JSON.stringify(tautan)), 'application/json');
      };
      if (selesaiHalaman === doc.jumlah_halaman) await simpanTautan();
      const akhir = Math.min(selesaiHalaman + 8, doc.jumlah_halaman);
      for (let n = selesaiHalaman + 1; n <= akhir; n++) {
        if (n > parsed.data.mulai && nowServer().getTime() - mulaiWaktu.getTime() > 45_000) break;
        const png = await renderHalaman(dokumen, n);
        const web = await buatVarianWeb(png);
        const path = `pages/${id}/${batchId}/page-${n}.png`;
        const kunciPng = kunciObjek('investment-docs', path);
        const kunciWeb = kunciObjek('investment-docs', pathVarianWeb(path)!);
        belumTercatat = [kunciPng, kunciWeb];
        await putObject('private', kunciPng, png, 'image/png');
        await putObject('private', kunciWeb, web, 'image/webp');
        // Pertahankan checkpoint terakhir agar seluruh aset bisa dicoba ulang jika penulisan tautan gagal.
        if (n === doc.jumlah_halaman) await simpanTautan();
        gambar[n - 1] = path;
        const hasil = await mutasiBolehKosong(client.from('investment_documents').update({ halaman_gambar: gambar, halaman_selesai: n })
          .eq('id', id).eq('diproses_pada', lease).eq('halaman_selesai', n - 1).select('id').maybeSingle()).catch(asalMutasi);
        if (!hasil.length) throw new Error('KONFLIK_VERSI');
        belumTercatat = [];
        selesaiHalaman = n;
      }
      const selesai = selesaiHalaman === doc.jumlah_halaman;
      const hasil = await mutasiBolehKosong(client.from('investment_documents').update({
        status: selesai ? 'aktif' : 'diproses', diproses_pada: null, galat: null,
      }).eq('id', id).eq('diproses_pada', lease).eq('halaman_selesai', selesaiHalaman).select('id').maybeSingle()).catch(asalMutasi);
      if (!hasil.length) return galat('KONFLIK_VERSI', requestId);
      terbit = selesai;
      return jawaban(selesaiHalaman, selesai);
    } catch (e) {
      if (belumTercatat.length) await hapusAman(belumTercatat, id);
      // Pesan baku: parser PDF dapat membawa teks dokumen/PII di dalam exception.
      const input = e instanceof Error && e.message === 'INPUT_TIDAK_VALID';
      await mutasiBolehKosong(client.from('investment_documents').update({ status: 'gagal', diproses_pada: null,
        galat: input ? 'PDF tidak valid atau melampaui batas pemrosesan.' : 'Pemrosesan PDF terhenti; lanjutkan pemrosesan atau hapus dokumen.',
      }).eq('id', id).eq('diproses_pada', lease).select('id').maybeSingle()).catch(asalMutasi);
      return galat(input ? 'INPUT_TIDAK_VALID' : e instanceof Error && e.message === 'KONFLIK_VERSI' ? 'KONFLIK_VERSI' : 'GAGAL_INTERNAL', requestId);
    } finally {
      // Cache kedaluwarsa setelah commit, bahkan jika pembersihan parser gagal.
      try { if (terbit) invalidasiInvestasiPublik(); }
      finally { await pdf?.tutup(); }
    }
  });
}
