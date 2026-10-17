import{afterEach,beforeAll,beforeEach,describe,expect,it,vi}from'vitest';
import{generateKeyPair,exportJWK,SignJWT,createLocalJWKSet}from'jose';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({keys:undefined as unknown,identity:vi.fn(),fetch:vi.fn()}));
vi.mock('jose',async(importOriginal)=>({...await importOriginal<typeof import('jose')>(),createRemoteJWKSet:()=>mocks.keys}));
vi.mock('@/lib/data/identity',()=>({ensureAppIdentity:mocks.identity}));
import{mobileSession}from'@/lib/mobile/auth';
const origin='https://auth.example.test';const id='d83de24e-fcc0-48c6-aeea-f32d7199cf0e';
let pair:Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async()=>{pair=await generateKeyPair('EdDSA');mocks.keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'test'}]});});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEON_AUTH_BASE_URL',origin+'/neondb/auth');vi.stubEnv('NEON_DATA_API_URL','https://data.example.test/rest/v1');mocks.fetch.mockResolvedValue(Response.json([]));vi.stubGlobal('fetch',mocks.fetch);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function token(overrides:Record<string,unknown>={}){return new SignJWT({sub:id,email:'me@example.test',emailVerified:true,iss:origin,aud:origin,exp:Math.floor(Date.now()/1000)+300,...overrides}).setProtectedHeader({alg:'EdDSA',kid:'test'}).sign(pair.privateKey);}
const request=(jwt:string)=>new Request('https://app.test',{headers:{Authorization:'Bearer '+jwt}});
describe('session mobile Neon',()=>{
 it.each([undefined,'Basic token','Bearer ','Bearer a b','Bearer '+'x'.repeat(16385)])('refuse un en-tête invalide',async(header)=>{expect(await mobileSession(new Request('https://app.test',{headers:header?{Authorization:header}:{}}))).toBeNull();expect(mocks.identity).not.toHaveBeenCalled();});
 it.each([{iss:'https://wrong.test'},{aud:'wrong'},{exp:1},{sub:'not-a-uuid'}])('vérifie les propriétés signées %j',async(overrides)=>{expect(await mobileSession(request(await token(overrides)))).toBeNull();expect(mocks.identity).not.toHaveBeenCalled();});
 it('refuse un faux jeton avant toute lecture',async()=>{expect(await mobileSession(request('forged-token'))).toBeNull();expect(mocks.fetch).not.toHaveBeenCalled();});
 it('valide la signature et transmet le JWT à Neon',async()=>{const jwt=await token();const session=await mobileSession(request(jwt));expect(session?.userId).toBe(id);expect(mocks.identity).toHaveBeenCalledOnce();await session!.db.from('profiles').select('id');expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer '+jwt);});
});
