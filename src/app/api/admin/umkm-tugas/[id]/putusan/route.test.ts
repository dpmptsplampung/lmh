// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';
const id='660e8400-e29b-41d4-a716-446655440001',op='660e8400-e29b-41d4-a716-446655440002';
const body={expected_version:2,operasi_id:op,keputusan:'ditolak',alasan:'Data perlu diperbaiki'};
const ctx={params:Promise.resolve({id})};
let rpc: ReturnType<typeof vi.fn>;
const req=(b:unknown)=>new Request('http://localhost/api/admin/umkm-tugas/'+id+'/putusan',{method:'POST',body:JSON.stringify(b)});
beforeEach(()=>{vi.clearAllMocks();rpc=vi.fn().mockResolvedValue({data:{id,versi:3,status:'diajukan'},error:null});vi.mocked(createClient).mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc} as unknown as Awaited<ReturnType<typeof createClient>>);});
describe('aksi putusan melalui JWT',()=>{
 it('mengirim versi/operasi dan hasil referensi tanpa nomor',async()=>{const r=await POST(req(body),ctx);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(rpc).toHaveBeenCalledWith('umkm_putuskan_profil', {p_profil_id:id,p_expected_version:2,p_operasi_id:op,p_keputusan:'ditolak',p_alasan:'Data perlu diperbaiki'});expect(await r.json()).toMatchObject({data:{id,versi:3}});});
 it('menolak aktor palsu dan versi kosong',async()=>{for(const b of [{...body,aktor_id:id},{...body,expected_version:null}]) expect((await POST(req(b),ctx)).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
 it('versi stale menjadi konflik tanpa rincian privat',async()=>{rpc.mockResolvedValue({data:null,error:{code:'40001',message:'KONFLIK_VERSI'}});const r=await POST(req(body),ctx);expect(r.status).toBe(409);expect(await r.json()).toMatchObject({error:{code:'KONFLIK_VERSI'}});});
 it('UUID tugas salah ditolak sebelum RPC',async()=>{expect((await POST(req(body),{params:Promise.resolve({id:'salah'})})).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
});
