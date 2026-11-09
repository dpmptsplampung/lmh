// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
import {createClient} from '@/lib/supabase/server';
import {PATCH} from './route';
const id='660e8400-e29b-41d4-a716-446655440001',op='660e8400-e29b-41d4-a716-446655440002';
let rpc:ReturnType<typeof vi.fn>;
const ctx={params:Promise.resolve({id})};
const req=(body:unknown)=>new Request('http://localhost/api/admin/petugas/'+id+'/pemeriksa-umkm',{method:'PATCH',body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();rpc=vi.fn().mockResolvedValue({data:{id,pemeriksa_umkm:true},error:null});vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc} as unknown as Awaited<ReturnType<typeof createClient>>);});
describe('penanda pemeriksa UMKM melalui JWT Admin',()=>{
 it('mengirim flag dan kunci operasi tanpa service role',async()=>{const r=await PATCH(req({pemeriksa_umkm:true,operasi_id:op}),ctx);expect(r.status).toBe(200);expect(rpc).toHaveBeenCalledWith('umkm_atur_pemeriksa',{p_petugas_id:id,p_pemeriksa_umkm:true,p_operasi_id:op});});
 it('database menolak non-admin atau flag FO',async()=>{rpc.mockResolvedValue({data:null,error:{code:'42501',message:'DILARANG'}});expect((await PATCH(req({pemeriksa_umkm:true,operasi_id:op}),ctx)).status).toBe(403);});
 it('patch campuran ditolak',async()=>{expect((await PATCH(req({pemeriksa_umkm:true,operasi_id:op,role:'admin'}),ctx)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
 it('migrasi belum tersedia menjadi 503',async()=>{rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});expect((await PATCH(req({pemeriksa_umkm:true,operasi_id:op}),ctx)).status).toBe(503);});
});
