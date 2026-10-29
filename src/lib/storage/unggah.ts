// Helper klien: presign -> PUT langsung ke R2 -> konfirmasi. Content-Length tidak diset manual (browser mengisinya dari
// ukuran body, yang harus sama dengan nilai yang ditandatangani).
import type { Area } from './area';

export async function unggahKeR2(area: Area, path: string, berkas: Blob): Promise<{ kunci: string; url?: string }> {
  const mime = berkas.type;
  const presign = await fetch('/api/storage/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area, path, mime, ukuran: berkas.size }),
  });
  if (!presign.ok) throw new Error(await pesanGalat(presign, 'Gagal menyiapkan unggahan'));
  const { uploadUrl, headers } = (await presign.json()) as { uploadUrl: string; headers: Record<string, string> };

  let put: Response;
  try {
    put = await fetch(uploadUrl, { method: 'PUT', headers, body: berkas });
  } catch {
    throw new Error('Unggah ke penyimpanan gagal. Periksa koneksi.');
  }
  if (!put.ok) throw new Error('Unggah ke penyimpanan gagal');

  const konfirmasi = await fetch('/api/storage/konfirmasi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area, path }),
  });
  if (!konfirmasi.ok) throw new Error(await pesanGalat(konfirmasi, 'Berkas tidak lolos pemeriksaan'));
  return (await konfirmasi.json()) as { kunci: string; url?: string };
}

async function pesanGalat(res: Response, cadangan: string): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? cadangan;
}
