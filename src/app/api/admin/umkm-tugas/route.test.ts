// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { GET, POST } from './route';
const op='660e8400-e29b-41d4-a716-446655440001';
const profile={nama:'Keripik',deskripsi:'Usaha lokal',jenis:'Pangan',kategori:'Olahan',kabupaten_kota:'Bandar Lampung',sumber:'kurasi'};
let rpc: ReturnType<typeof vi.fn>;
let user: {id:string}|null;
const req=(body?:unknown,url='http://localhost/api/admin/umkm-tugas')=>new Request(url,body===undefined?undefined:{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{ vi.clearAllMocks(); user={id:'user'}; rpc=vi.fn().mockResolvedValue({data:{items:[],next_cursor:null},error:null});
vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user}})},rpc} as unknown as Awaited<ReturnType<typeof createClient>>); });
describe('API daftar/simpan UMKM dengan JWT pengguna',()=>{
 it('menormalkan nomor tempelan sebelum dikirim ke DB', async () => {
   const res = await POST(req({ data: { ...profile, nomor: '+62 (812) 3456-7890.12' }, operasi_id: op }));
   expect(res.status).toBe(200);
   expect(rpc).toHaveBeenCalledWith('umkm_simpan_profil', expect.objectContaining({
     p_data: { ...profile, nomor: '+628123456789012' },
   }));
 });
 it('daftar terbatas dari RPC dan selalu private no-store',async()=>{const res=await GET(req()); expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('private, no-store'); expect(rpc).toHaveBeenCalledWith('umkm_daftar_tugas',{p_cursor:null}); expect(await res.json()).toMatchObject({data:{items:[]},meta:{request_id:expect.any(String)}});});
 it('menolak sesi kosong sebelum RPC',async()=>{user=null;expect((await GET(req())).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it('menolak cursor salah dan query asing',async()=>{for(const suffix of ['?cursor=salah','?nomor=rahasia']) expect((await GET(req(undefined,'http://localhost/api/admin/umkm-tugas'+suffix))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
 it('simpan mengirim field allowlist dan operasi',async()=>{expect((await POST(req({data:profile,operasi_id:op}))).status).toBe(200);expect(rpc).toHaveBeenCalledWith('umkm_simpan_profil',{p_data:profile,p_operasi_id:op,p_profil_id:null,p_expected_version:null});});
 it.each([{data:{...profile,status:'terbit'},operasi_id:op},{data:profile,operasi_id:op,aktor_id:op},{data:{...profile,tiktok:'https://evil.example/u'},operasi_id:op}])('input campuran ditolak',async body=>{expect((await POST(req(body))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
 it.each([['PGRST202','missing',503,'MODUL_BELUM_TERSEDIA'],['42501','private',403,'DILARANG'],['40001','KONFLIK_VERSI',409,'KONFLIK_VERSI'],['XX000','081234567890',500,'GAGAL_INTERNAL']])('galat %s aman',async(code,message,status,expected)=>{rpc.mockResolvedValue({data:null,error:{code,message}});const res=await GET(req()); expect(res.status).toBe(status); const body=await res.json();expect(body.error.code).toBe(expected);expect(JSON.stringify(body)).not.toContain('081234567890');});
 it('JSON rusak dan body terlalu besar ditolak',async()=>{for(const body of ['{',JSON.stringify({data:{...profile,deskripsi:'x'.repeat(66000)},operasi_id:op})]) expect((await POST(new Request('http://localhost/api/admin/umkm-tugas',{method:'POST',body}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
});
