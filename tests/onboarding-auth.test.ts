import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({client:vi.fn(),session:vi.fn(),signIn:vi.fn(),signUp:vi.fn(),verify:vi.fn(),sendOtp:vi.fn(),identity:vi.fn(),onboarding:vi.fn(),redirect:vi.fn((p:string):never=>{throw new Error('redirect:'+p);})}));
vi.mock('next/navigation',()=>({redirect:mocks.redirect}));
vi.mock('@/lib/database/server',()=>({createClient:mocks.client}));
vi.mock('@/lib/auth/server',()=>({getAuth:()=>({getSession:mocks.session,signIn:{email:mocks.signIn},signUp:{email:mocks.signUp},emailOtp:{verifyEmail:mocks.verify,sendVerificationOtp:mocks.sendOtp}})}));
vi.mock('@/lib/data/identity',()=>({ensureAppIdentity:mocks.identity}));
vi.mock('@/lib/data/onboarding',()=>({getOnboardingStatus:mocks.onboarding}));
import {requireSession,requireUser,getUserForApi} from '@/lib/auth';
import {signIn,signUp,verifyEmail} from '@/app/login/actions';
const db={from:vi.fn()};const user={id:'user-id',email:'test@example.com',emailVerified:true};
function form(){const f=new FormData();f.set('email',user.email);f.set('password','password123');f.set('name','Camille');f.set('otp','123456');return f;}
beforeEach(()=>{
 vi.clearAllMocks();mocks.client.mockResolvedValue(db);mocks.session.mockResolvedValue({data:{user},error:null});mocks.identity.mockResolvedValue(user.id);mocks.onboarding.mockResolvedValue('pending');mocks.signIn.mockResolvedValue({data:{user},error:null});mocks.signUp.mockResolvedValue({data:{user},error:null});mocks.verify.mockResolvedValue({data:{user},error:null});mocks.sendOtp.mockResolvedValue({data:{success:true},error:null});
});
describe('accès Neon et configuration initiale',()=>{
 it('initialise uniquement une identité vérifiée',async()=>{expect(await requireSession()).toEqual({db,userId:user.id,email:user.email});expect(mocks.identity).toHaveBeenCalledWith(db);expect(mocks.onboarding).not.toHaveBeenCalled();});
 it.each([null,{user:{...user,emailVerified:false}}])('refuse une session absente ou non confirmée',async(data)=>{mocks.session.mockResolvedValue({data,error:null});expect(await getUserForApi()).toBeNull();expect(mocks.identity).not.toHaveBeenCalled();await expect(requireSession()).rejects.toThrow('redirect:/login');});
 it.each(['pending','unavailable'])('ouvre la configuration si %s',async(status)=>{mocks.onboarding.mockResolvedValue(status);await expect(requireUser()).rejects.toThrow('redirect:/setup');});
 it('retrouve l’accueil lorsque le profil est configuré',async()=>{mocks.onboarding.mockResolvedValue('complete');expect(await requireUser()).toMatchObject({userId:user.id});});
});
describe('inscription et confirmation Neon',()=>{
 it('attend le code après inscription',async()=>{expect(await signUp({},form())).toMatchObject({step:'verify',email:user.email});expect(mocks.signUp).toHaveBeenCalledWith({email:user.email,password:'password123',name:'Camille'});expect(mocks.identity).not.toHaveBeenCalled();});
 it('affiche une erreur sans consulter les données',async()=>{mocks.signIn.mockResolvedValue({error:{code:'INVALID_EMAIL_OR_PASSWORD'}});expect(await signIn({},form())).toHaveProperty('error');expect(mocks.identity).not.toHaveBeenCalled();});
 it('ouvre la saisie du code si l’adresse reste non confirmée',async()=>{mocks.signIn.mockResolvedValue({error:{code:'EMAIL_NOT_VERIFIED'}});expect(await signIn({},form())).toMatchObject({step:'verify',email:user.email});});
 it('ouvre la configuration après vérification',async()=>{await expect(verifyEmail({},form())).rejects.toThrow('redirect:/setup');expect(mocks.verify).toHaveBeenCalledWith({email:user.email,otp:'123456'});});
 it('refuse un mauvais code avant la lecture de données',async()=>{mocks.verify.mockResolvedValue({error:{code:'INVALID_OTP'}});expect(await verifyEmail({},form())).toHaveProperty('error');expect(mocks.identity).not.toHaveBeenCalled();});
 it('ouvre l’accueil à la connexion suivante',async()=>{mocks.onboarding.mockResolvedValue('complete');await expect(signIn({},form())).rejects.toThrow('redirect:/');});
});
