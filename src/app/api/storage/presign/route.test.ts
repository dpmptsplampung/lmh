// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {NextRequest} from 'next/server';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
vi.mock('@/lib/observability/logger',()=>({logServerEvent:vi.fn()}));
vi.mock('@/lib/storage/r2',()=>({r2Tersedia:vi.fn(()=>true),bucketTerpisah:vi.fn(()=>true),presignPut:vi.fn(async()=> 'https://r2.example/put'),headObject:vi.fn(async()=>({size:100,contentType:'image/jpeg'})),getObjectRange:vi.fn(async()=>Uint8Array.of(0xff,0xd8,0xff)),deleteObjects:vi.fn(),urlPublik:(k:string)=>`https://pub.example/${k}`}));
import {createClient} from '@/lib/supabase/server';
import {presignPut,headObject,bucketTerpisah} from '@/lib/storage/r2';
import {POST} from './route';
let role:string,flag:boolean,aktif:boolean|null,flagError:boolean,session:boolean,sessionError:boolean;
let rpc:ReturnType<typeof vi.fn>;
const req=(area='umkm-draf')=>new Request('http://localhost/api/storage/presign',{method:'POST',body:JSON.stringify({area,path:'foto.jpg',mime:'image/jpeg',ukuran:100})}) as NextRequest;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(bucketTerpisah).mockReturnValue(true);role='petugas';flag=true;aktif=true;flagError=false;session=true;sessionError=false;
 rpc=vi.fn(async()=>({data:session,error:sessionError?{code:'42501'}:null}));
 vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'u1'}}})},rpc,
 from:()=>({select:(columns:string)=>({eq:()=>({maybeSingle:async()=>columns.includes('pemeriksa_umkm')?{data:flagError?null:{role,aktif,pemeriksa_umkm:flag},error:flagError?{code:'42703'}:null}:{data:{role,aktif},error:null}})})})} as unknown as Awaited<ReturnType<typeof createClient>>);
});
describe('presign area draf UMKM dengan JWT pengguna',()=>{
 it.each([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']])(
   'path draf %s ditetapkan server sesuai MIME', async (mime, ext) => {
     const request = new Request('http://localhost/api/storage/presign', {
       method: 'POST', body: JSON.stringify({ area: 'umkm-draf', path: 'kontak.html', mime, ukuran: 100 }),
     }) as NextRequest;
     const response = await POST(request);
     expect(response.status).toBe(200);
     const body = await response.json();
     expect(body.kunci).toMatch(new RegExp(`^umkm-draf/[0-9a-f-]{36}\\.${ext}$`));
     expect(presignPut).toHaveBeenCalledWith('private', body.kunci, {
       contentType: mime, contentLength: 100, tandatanganiContentType: true,
     });
   },
 );
 it.each(['petugas','admin'])('pemeriksa %s aktif boleh mengunggah privat',async r=>{role=r;const res=await POST(req());expect(res.status).toBe(200);expect(rpc).toHaveBeenCalledWith('sesi_valid');expect(await res.json()).not.toHaveProperty('url');});
 it.each(['petugas','admin'])('%s tanpa flag ditolak sebelum R2',async r=>{role=r;flag=false;expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it('FO tetap ditolak meski flag true',async()=>{role='front_office';expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it('flag tidak terbaca/migrasi belum diterapkan ditolak',async()=>{flagError=true;expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it.each([false,null])('aktif %s tidak diterima sebagai pemeriksa aktif',async a=>{aktif=a;expect((await POST(req())).status).toBe(403);});
 it('sesi digantikan atau tidak terbaca ditolak',async()=>{session=false;expect((await POST(req())).status).toBe(403);session=true;sessionError=true;expect((await POST(req())).status).toBe(403);});
 it('bucket yang sama menolak draf sebelum memberi URL atau membaca objek', async () => {
   vi.mocked(bucketTerpisah).mockReturnValue(false);
   const res = await POST(req());
   expect(res.status).toBe(503);
   expect(await res.json()).not.toHaveProperty('url');
   expect(presignPut).not.toHaveBeenCalled();
   expect(headObject).not.toHaveBeenCalled();
 });
 it('area legacy tetap boleh tanpa flag atau cek sesi tambahan',async()=>{flag=false;session=false;const res=await POST(req('umkm-photos'));expect(res.status).toBe(200);expect(rpc).not.toHaveBeenCalled();});
});
