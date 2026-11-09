// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
vi.mock('@/lib/storage/r2',()=>({presignGet:vi.fn(),r2Tersedia:vi.fn(),bucketTerpisah:vi.fn()}));
import {createClient} from '@/lib/supabase/server';
import {presignGet,r2Tersedia,bucketTerpisah} from '@/lib/storage/r2';
import {GET} from './route';
const id='660e8400-e29b-41d4-a716-446655440001',fotoId='660e8400-e29b-41d4-a716-446655440002';
let rpc:ReturnType<typeof vi.fn>;
const req=new Request('http://localhost/api/admin/umkm-tugas/'+id+'/foto/'+fotoId);
const ctx={params:Promise.resolve({id,fotoId})};
beforeEach(()=>{vi.clearAllMocks();rpc=vi.fn().mockResolvedValue({data:{foto:[{id:fotoId,asal:'unggahan',r2_key:'umkm-draf/foto.jpg'}]},error:null});vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc} as unknown as Awaited<ReturnType<typeof createClient>>);vi.mocked(r2Tersedia).mockReturnValue(true);vi.mocked(bucketTerpisah).mockReturnValue(true);vi.mocked(presignGet).mockResolvedValue('https://private-r2.example/foto?signature=temporary');});
describe('preview foto UMKM privat',()=>{
 it('pratinjau selalu memaksa MIME gambar dan inline', async () => {
   const response = await GET(req, ctx);
   expect(response.status).toBe(307);
   expect(presignGet).toHaveBeenCalledWith('private', 'umkm-draf/foto.jpg', 60, {
     contentType: 'image/jpeg', contentDisposition: 'inline',
   });
 });
 it('ekstensi non-gambar tidak memperoleh URL pratinjau', async () => {
   rpc.mockResolvedValue({ data: { foto: [{ id: fotoId, asal: 'unggahan', r2_key: 'umkm-draf/foto.html' }] },
     error: null });
   expect((await GET(req, ctx)).status).toBe(404);
   expect(presignGet).not.toHaveBeenCalled();
 });
 it('mengalihkan ke signed URL 60 detik sesudah izin DB',async()=>{const r=await GET(req,ctx);expect(r.status).toBe(307);expect(r.headers.get('Location')).toBe('https://private-r2.example/foto?signature=temporary');expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
 it('foto milik profil lain tidak ditandatangani',async()=>{expect((await GET(req,{params:Promise.resolve({id,fotoId:'660e8400-e29b-41d4-a716-446655440003'})})).status).toBe(404);expect(presignGet).not.toHaveBeenCalled();});
 it('FO ditolak sebelum akses R2',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501',message:'DILARANG'}});expect((await GET(req,ctx)).status).toBe(403);expect(presignGet).not.toHaveBeenCalled();});
 it('path di area lain ditolak',async()=>{rpc.mockResolvedValue({data:{foto:[{id:fotoId,asal:'unggahan',r2_key:'absensi-foto/private.jpg'}]},error:null});expect((await GET(req,ctx)).status).toBe(404);expect(presignGet).not.toHaveBeenCalled();});
 it('R2 belum tersedia menghasilkan 503',async()=>{vi.mocked(r2Tersedia).mockReturnValue(false);expect((await GET(req,ctx)).status).toBe(503);});
});

it('bucket sama tidak memberikan URL pratinjau draf', async () => {
  vi.mocked(bucketTerpisah).mockReturnValue(false);
  expect((await GET(req, ctx)).status).toBe(503);
  expect(presignGet).not.toHaveBeenCalled();
});
