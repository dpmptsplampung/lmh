// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/akun/server',()=>({requireAdmin:vi.fn(),json:(b:unknown,status=200)=>Response.json(b,{status}),audit:vi.fn(),generateTempPassword:vi.fn()}));
import {requireAdmin} from '@/lib/akun/server';
import {GET} from './route';
const id='660e8400-e29b-41d4-a716-446655440001';
let flag:{data:unknown;error:null|{code:string;message?:string}};
beforeEach(()=>{vi.clearAllMocks();flag={data:[{id,pemeriksa_umkm:true}],error:null};vi.mocked(requireAdmin).mockResolvedValue({actor:{id,role:'admin',aktif:true,auth_user_id:id},service:{rpc:async()=>({data:[{id,nama:'Petugas'}],error:null}),from:()=>({select:(columns:string)=>Promise.resolve(columns==='id, pemeriksa_umkm'?flag:{data:[{id,koordinator:false,operator_aktif:false}],error:null})})}} as unknown as Awaited<ReturnType<typeof requireAdmin>>);});
describe('GET petugas dengan penanda pemeriksa UMKM',()=>{
 it('flag per akun dan ketersediaan tersedia',async()=>{const res=await GET();expect(res.status).toBe(200);expect(await res.json()).toMatchObject({pemeriksa_umkm_tersedia:true,akun:[{id,pemeriksa_umkm:true}]});});
 it('migrasi belum diterapkan tetap memberi daftar tanpa saklar',async()=>{flag={data:null,error:{code:'42703'}};const res=await GET();expect(res.status).toBe(200);expect(await res.json()).toMatchObject({pemeriksa_umkm_tersedia:false,akun:[{id,pemeriksa_umkm:false}]});});
 it('galat akses lain tidak dianggap migrasi belum tersedia',async()=>{flag={data:null,error:{code:'42501',message:'nomor pribadi'}};const res=await GET();expect(res.status).toBe(500);expect(JSON.stringify(await res.json())).not.toContain('nomor pribadi');});
});
