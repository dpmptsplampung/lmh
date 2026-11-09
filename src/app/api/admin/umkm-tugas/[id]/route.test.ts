// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';
const id='660e8400-e29b-41d4-a716-446655440001';
let rpc:ReturnType<typeof vi.fn>;
const req=()=>new Request('http://localhost/api/admin/umkm-tugas/'+id,{method:'GET'});
beforeEach(()=>{vi.clearAllMocks();rpc=vi.fn().mockResolvedValue({data:{id,dipegang_saya:true},error:null});vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc} as unknown as Awaited<ReturnType<typeof createClient>>);});
describe('umkm_detail_tugas',()=>{
 it('membaca satu objek dengan JWT dan no-store',async()=>{const r=await GET(req(),{params:Promise.resolve({id})});expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(rpc).toHaveBeenCalledWith('umkm_detail_tugas',{p_profil_id:id});});
 it('FO atau pemegang lain ditolak oleh database',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501',message:'DILARANG'}});const r=await GET(req(),{params:Promise.resolve({id})});expect(r.status).toBe(403);expect(await r.json()).toMatchObject({error:{code:'DILARANG'}});});
 it('UUID salah tidak mencapai RPC',async()=>{expect((await GET(req(),{params:Promise.resolve({id:'salah'})})).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
});
