import { z } from 'zod';
import { layaniKelola } from '@/lib/investasi/akses-server';
import { bacaJson, galat, galatRpc, headersPrivat } from '@/lib/investasi/http';
import { copyObject, headObject } from '@/lib/storage/r2';
import { hapusAman, sumberFinal } from './_logika/unggahan';
import { pathPdfInvestasiSah } from '@/lib/storage/area';
import { bukaPdf, bacaPdf, MAKS_BYTE } from './_logika/pdf';

import { metadataDokumen } from './_logika/metadata';

export const maxDuration = 60;

const schema = z.object({
  ...metadataDokumen,
  kunci: z.string().refine(v => v.startsWith('investment-docs/') && pathPdfInvestasiSah(v.slice('investment-docs/'.length))),
  kategori: metadataDokumen.kategori.prefault(null),
  deskripsi: metadataDokumen.deskripsi.optional(),
  nilai_investasi: metadataDokumen.nilai_investasi.optional(),
  image_url: metadataDokumen.image_url.optional(),
  urutan_tampil: metadataDokumen.urutan_tampil.default(0),
}).strict();

export async function POST(request: Request) {
  return layaniKelola(async (client, requestId) => {
    const parsed = schema.safeParse(await bacaJson(request));
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const { kunci, ...metadata } = parsed.data;
    const { data: { user } } = await client.auth.getUser();
    if (!user || !pathPdfInvestasiSah(kunci.slice('investment-docs/'.length), user.id)) return galat('DILARANG', requestId);
    // PK dikonsumsi sebelum I/O: dua request, retry, dan PUT ulang tidak dapat memakai sumber yang sama.
    // Catatan tetap ada setelah dokumen dihapus maupun pendaftaran gagal.
    const klaim = await client.from('investment_pdf_claims').insert({ kunci }).select('kunci').single();
    if (klaim.error) return klaim.error.code === '23505' ? galat('KONFLIK_VERSI', requestId) : galatRpc(klaim.error, requestId);
    if (!klaim.data) return galat('GAGAL_INTERNAL', requestId);
    const id = crypto.randomUUID();
    const final = `investment-docs/${sumberFinal(id)}`;
    let tersimpan = false;
    try {
      const head = await headObject('private', kunci);
      if (!head) throw new Error('TIDAK_DITEMUKAN');
      if (head.size < 5 || head.size > MAKS_BYTE || head.contentType.split(';')[0].trim() !== 'application/pdf') throw new Error('INPUT_TIDAK_VALID');
      if (!head.etag) throw new Error('GAGAL_INTERNAL');
      // CopyObject bersyarat mengunci snapshot; parser memeriksa SALINAN yang dibaca seluruh batch render.
      await copyObject('private', kunci, 'private', final, head.etag);
      const pdf = await bukaPdf(await bacaPdf(final));
      const jumlah_halaman = pdf.doc.numPages;
      await pdf.tutup();
      const { data, error } = await client.from('investment_documents').insert({
        ...metadata, id, file_path: sumberFinal(id), status: 'diproses',
        jumlah_halaman, halaman_selesai: 0, halaman_gambar: [],
      }).select('id').single();
      if (error) return galatRpc(error, requestId);
      if (!data) return galat('GAGAL_INTERNAL', requestId);
      tersimpan = true;
      return Response.json({ id: data.id, jumlah_halaman }, { status: 201, headers: headersPrivat });
    } finally {
      await hapusAman(tersimpan ? [kunci] : [kunci, final], id);
    }
  });
}
