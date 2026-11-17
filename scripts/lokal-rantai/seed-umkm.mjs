// Seed lokal PGlite: akun auth.users dibuat oleh pemanggil.
import { randomUUID } from 'node:crypto';

export async function buatPetugasUmkm(db, { authUserId, id = randomUUID(), nama = 'Pemeriksa UMKM' }) {
  const layananId = randomUUID();
  await db.query(`INSERT INTO public.layanan(id,nama,tipe,modul)
    VALUES ($1,$2,'konsultatif','umkm')`, [layananId, `UMKM ${layananId}`]);
  await db.query(`INSERT INTO public.petugas(id,auth_user_id,nama,role,aktif,layanan_id)
    VALUES ($1,$2,$3,'petugas',true,$4)`, [id, authUserId, nama, layananId]);
  return { id, layananId };
}
