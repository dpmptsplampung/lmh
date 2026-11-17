import { getServiceClient } from '@/lib/akun/server';

/** Berkas hanya boleh dikirim setelah jejak audit tersimpan. Detail tidak memuat PII atau teks pencarian. */
export async function catatAuditEkspor(
  actorId: string, role: string, aksi: 'export_xlsx' | 'export_csv', entitas: string, detail: Record<string, unknown>,
): Promise<void> {
  const service = getServiceClient();
  if (!service) throw new Error('AUDIT_GAGAL');
  const { error } = await service.from('audit_log').insert({ actor_id: actorId, actor_role: role, aksi, entitas, detail });
  if (error) throw new Error('AUDIT_GAGAL');
}
