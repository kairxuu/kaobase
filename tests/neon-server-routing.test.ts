import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({token:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/auth/server',()=>({getAuth:()=>({token:mocks.token})}));
import {createClient} from '@/lib/database/server';
beforeEach(()=>{
 vi.stubEnv('NEON_DATA_API_URL','https://endpoint.apirest.neon.tech/neondb/rest/v1');
 mocks.token.mockResolvedValue({data:{token:'neon-jwt'},error:null});
 mocks.fetch.mockReset().mockImplementation(()=>Promise.resolve(Response.json([])));vi.stubGlobal('fetch',mocks.fetch);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('session Neon et Data API',()=>{
 it('utilise le JWT Neon pour les tables, RPC et schémas',async()=>{
  const client=await createClient();await client.from('accounts').select('id');await client.rpc('ensure_app_user');await client.schema('public').from('profiles').select('id');
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  for(const [url,init]of mocks.fetch.mock.calls){expect(new URL(String(url)).hostname).toBe('endpoint.apirest.neon.tech');expect(new Headers(init.headers).get('Authorization')).toBe('Bearer neon-jwt');}
 });
 it('refuse les données quand la session a expiré',async()=>{
  mocks.token.mockResolvedValue({data:null,error:{code:'UNAUTHORIZED'}});
  const result=await(await createClient()).from('profiles').select('id');expect(result.status).toBe(401);expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('ne propose aucun ancien fournisseur de secours',async()=>{
  vi.stubEnv('NEON_DATA_API_URL','');await expect(createClient()).rejects.toThrow('NEON_DATA_API_URL');expect(mocks.fetch).not.toHaveBeenCalled();
 });
});
