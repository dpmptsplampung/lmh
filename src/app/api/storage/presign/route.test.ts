// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {NextRequest} from 'next/server';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
vi.mock('@/lib/observability/logger',()=>({logServerEvent:vi.fn()}));
vi.mock('@/lib/storage/r2',()=>({r2Tersedia:vi.fn(()=>true),bucketTerpisah:vi.fn(()=>true),presignPut:vi.fn(async()=> 'https://r2.example/put'),headObject:vi.fn(async()=>({size:100,contentType:'image/jpeg'})),getObjectRange:vi.fn(async()=>Uint8Array.of(0xff,0xd8,0xff)),deleteObjects:vi.fn(async()=>{}),urlPublik:(k:string)=>`https://pub.example/${k}`}));
import {createClient} from '@/lib/supabase/server';
import {presignPut,headObject,bucketTerpisah} from '@/lib/storage/r2';
import {POST} from './route';
describe('unggah IPRO memerlukan modul investasi', () => {
 const pathIpro = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';
 const kirimIpro = (ubah: Record<string, unknown> = {}) => new Request('http://localhost/api/storage/presign', {
   method: 'POST', body: JSON.stringify({ area: 'ipro-mentah', path: pathIpro, mime: 'image/png', ukuran: 100, ...ubah }),
 }) as NextRequest;
 it('tanpa user 401 sebelum R2', async () => {
   vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as Awaited<ReturnType<typeof createClient>>);
   expect((await POST(kirimIpro())).status).toBe(401); expect(headObject).not.toHaveBeenCalled(); expect(presignPut).not.toHaveBeenCalled();
 });
 it.each(['umkm', null])('modul %s ditolak sebelum R2', async m => {
   modul = m; expect((await POST(kirimIpro())).status).toBe(403); expect(headObject).not.toHaveBeenCalled(); expect(presignPut).not.toHaveBeenCalled();
 });
 it('FO dan area hasil server ditolak', async () => {
   modul = 'investasi'; role = 'front_office'; expect((await POST(kirimIpro())).status).toBe(403);
   role = 'admin'; expect((await POST(kirimIpro({ area: 'ipro-gambar' }))).status).toBe(403);
 });
 it('RPC gagal atau sesi tidak valid ditolak', async () => {
   modul = 'investasi'; modulError = true; expect((await POST(kirimIpro())).status).toBe(403);
   modulError = false; session = false; expect((await POST(kirimIpro())).status).toBe(403);
 });
 it('path dan JSON tak dikenal ditolak 400', async () => {
   modul = 'investasi'; expect((await POST(kirimIpro({ path: '../x.png' }))).status).toBe(400);
   expect((await POST(kirimIpro({ asing: true }))).status).toBe(400);
 });
 it('bucket mentah harus privat dan terpisah', async () => {
   modul = 'investasi'; vi.mocked(bucketTerpisah).mockReturnValue(false);
   expect((await POST(kirimIpro())).status).toBe(503);
 });
 it.each(['admin', 'petugas'])('%s investasi mendapat respons privat', async r => {
   role = r; modul = 'investasi';
   const res = await POST(kirimIpro());
   expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
   expect(await res.json()).not.toHaveProperty('url');
 });
});
let role:string,flag:boolean,aktif:boolean|null,modul:string|null,modulError:boolean,session:boolean,sessionError:boolean;
let rpc:ReturnType<typeof vi.fn>;
const req=(area='umkm-draf')=>new Request('http://localhost/api/storage/presign',{method:'POST',body:JSON.stringify({area,path:'foto.jpg',mime:'image/jpeg',ukuran:100})}) as NextRequest;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(bucketTerpisah).mockReturnValue(true);role='petugas';flag=false;aktif=true;modul='umkm';modulError=false;session=true;sessionError=false;
 rpc=vi.fn(async(nama:string)=>nama==='staf_modul'
   ? {data:modul,error:modulError?{code:'42883'}:null}
   : {data:session,error:sessionError?{code:'42501'}:null});
 vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}})},rpc,
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,aktif,pemeriksa_umkm:flag},error:null})})})})} as unknown as Awaited<ReturnType<typeof createClient>>);
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
 it.each(['petugas','admin'])('%s aktif boleh mengunggah privat tanpa flag lama',async r=>{role=r;const res=await POST(req());expect(res.status).toBe(200);expect(rpc).toHaveBeenCalledWith('sesi_valid');expect(await res.json()).not.toHaveProperty('url');});
 it.each(['investasi',null])('petugas modul %s ditolak walau flag lama true',async m=>{modul=m;flag=true;expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it('admin tetap boleh saat modul tidak tersedia dan tidak memanggil staf_modul',async()=>{role='admin';modul=null;modulError=true;expect((await POST(req())).status).toBe(200);expect(rpc).not.toHaveBeenCalledWith('staf_modul');});
 it('FO tetap ditolak meski flag true',async()=>{role='front_office';flag=true;expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it('RPC modul gagal/migrasi belum diterapkan ditolak sebelum R2',async()=>{modulError=true;expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
 it('RPC modul melempar ditolak sebelum R2',async()=>{rpc.mockRejectedValueOnce(new Error('jaringan'));expect((await POST(req())).status).toBe(403);expect(presignPut).not.toHaveBeenCalled();expect(headObject).not.toHaveBeenCalled();});
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

function akunBiasa(anonymous = false) {
  const id = '11111111-1111-4111-8111-111111111111';
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id, is_anonymous: anonymous } } }) },
    rpc: vi.fn(async () => ({ data: { diizinkan: false }, error: null })),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return id;
}
const reqAkun = () => new Request('http://localhost/api/storage/presign', { method: 'POST',
  body: JSON.stringify({ area: 'umkm-draf', path: 'akun/foto.jpg', mime: 'image/jpeg', ukuran: 100 }) }) as NextRequest;
it('akun biasa boleh presign ke akun/ dan mendapat folder ID akunnya', async () => {
  const id = akunBiasa();
  const response = await POST(reqAkun());
  expect(response.status).toBe(200);
  expect((await response.json()).kunci).toMatch(new RegExp(`^umkm-draf/${id}/[0-9a-f-]{36}\\.jpg$`));
});
it('akun anonim ditolak', async () => {
  akunBiasa(true);
  expect((await POST(reqAkun())).status).toBe(403);
  expect(presignPut).not.toHaveBeenCalled();
});

describe('presign PDF investasi', () => {
 const pdf = (ubah: Record<string, unknown> = {}) => new Request('http://localhost/api/storage/presign', { method: 'POST',
   body: JSON.stringify({ area: 'investment-docs', mime: 'application/pdf', ukuran: 12, ...ubah }),
 }) as NextRequest;
 it.each(['umkm', null])('petugas %s ditolak sebelum R2', async m => {
   modul = m; expect((await POST(pdf())).status).toBe(403); expect(presignPut).not.toHaveBeenCalled();
 });
 it('FO dan sesi tidak sah ditolak', async () => {
   role = 'front_office'; modul = 'investasi'; expect((await POST(pdf())).status).toBe(403);
   role = 'admin'; session = false; expect((await POST(pdf())).status).toBe(403);
 });
 it.each(['admin', 'petugas'])('%s mendapat PUT privat dengan MIME ditandatangani', async r => {
   role = r; modul = 'investasi'; const res = await POST(pdf());
   expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
   expect(presignPut).toHaveBeenCalledWith('private', expect.stringMatching(/^investment-docs\/raw\//), {
     contentType: 'application/pdf', contentLength: 12, tandatanganiContentType: true,
   });
 });
 it('tidak menandatangani ulang kunci siapa pun; setiap presign membuat kunci sendiri', async () => {
   role = 'admin';
   expect((await POST(pdf({ path: 'raw/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/11111111-1111-4111-8111-111111111111.pdf' }))).status).toBe(400);
   expect(presignPut).not.toHaveBeenCalled();
   const a = await (await POST(pdf())).json(); const b = await (await POST(pdf())).json();
   expect(a.kunci).toMatch(/^investment-docs\/raw\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/[0-9a-f-]{36}\.pdf$/);
   expect(b.kunci).not.toBe(a.kunci);
 });
 it('menolak lebih dari 50 MiB, path pages, dan bucket publik yang sama', async () => {
   role = 'admin'; expect((await POST(pdf({ ukuran: 50 * 1024 * 1024 + 1 }))).status).toBe(400);
   expect((await POST(pdf({ path: 'pages/11111111-1111-4111-8111-111111111111.pdf' }))).status).toBe(400);
   vi.mocked(bucketTerpisah).mockReturnValue(false); expect((await POST(pdf())).status).toBe(503);
   expect(presignPut).not.toHaveBeenCalled();
 });
});
