import { managedRequest,authMessage } from '@/lib/auth/managed';
import { z } from 'zod';
export const runtime='nodejs';
const email=z.string().trim().email().max(254);
const password=z.string().min(8).max(128);
const schemas={
  'sign-in':z.object({email,password:z.string().min(1).max(128)}),
  'sign-up':z.object({email,password}),
  'verify':z.object({email,otp:z.string().regex(/^\d{6}$/)}),
  'resend':z.object({email}),
  'request-reset':z.object({email}),
  'reset':z.object({email,otp:z.string().regex(/^\d{6}$/),password}),
  'refresh':z.object({refresh_token:z.string().min(1).max(4096)}),
  'sign-out':z.object({refresh_token:z.string().min(1).max(4096)}),
};
function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request,context:{params:Promise<{action:string}>}) {
  const {action}=await context.params;
  if(!Object.hasOwn(schemas,action))return json({error:'Action inconnue.'},404);
  if(Number(request.headers.get('content-length')??0)>16384) return json({error:'Demande trop volumineuse.'},413);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin) return json({error:'Origine refusée.'},403);
  let input:Record<string,string>;
  try {input=schemas[action as keyof typeof schemas].parse(await request.json());}catch{return json({error:'Vérifie les informations saisies.'},400);}
  const paths:Record<string,string>={'sign-in':'sign-in/email','sign-up':'sign-up/email',verify:'email-otp/verify-email',resend:'email-otp/send-verification-otp','request-reset':'email-otp/request-password-reset',reset:'email-otp/reset-password','sign-out':'sign-out'};
  try {
    let sessionToken: string | undefined=input.refresh_token;
    if(action!=='refresh') {
      const body:Record<string,unknown>={...input};delete body.refresh_token;
      if(action==='sign-up') body.name=input.email.split('@')[0];
      if(action==='resend') body.type='email-verification';
      const {response,data}=await managedRequest(paths[action],body,sessionToken);
      if(!response.ok) return json({error:authMessage(data.code),code:data.code},response.status);
      if(['resend','request-reset','reset','sign-out'].includes(action))return json({ok:true});
      sessionToken=response.headers.getSetCookie().map(c=>c.split(';')[0]).find(c=>c.startsWith('__Secure-neon-auth.session_token='))?.slice('__Secure-neon-auth.session_token='.length);
      if(!sessionToken) return json({confirmation_required:true});
    }
    const [identity,token]=await Promise.all([managedRequest('get-session',undefined,sessionToken),managedRequest('token',undefined,sessionToken)]);
    if(!identity.response.ok||!identity.data?.user?.emailVerified||!token.response.ok||!token.data?.token) return json({error:'Ta session a expiré. Reconnecte-toi.',code:'SESSION_EXPIRED'},401);
    // Managed JWTs last 15 minutes; renew using the opaque, revocable session token.
    return json({access_token:token.data.token,refresh_token:sessionToken,expires_in:840,user:{id:identity.data.user.id,email:identity.data.user.email}});
  }catch{return json({error:'Le service de connexion est momentanément indisponible.'},503);}
}
