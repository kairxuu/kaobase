'use server';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/server';
import { managedRequest, authMessage } from '@/lib/auth/managed';
import { requireSession } from '@/lib/auth';
import { getOnboardingStatus } from '@/lib/data/onboarding';

export type AuthState = { error?: string; info?: string; email?: string; step?: 'verify' | 'reset-code' };
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
async function enter(): Promise<never> {
  const { db, userId } = await requireSession();
  redirect(await getOnboardingStatus(db,userId) === 'complete' ? '/' : '/setup');
}
export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email=field(form,'email');
  const auth=await getAuth();
  const { error }=await auth.signIn.email({email,password:String(form.get('password')??'')});
  if (error) {
    if (error.code==='EMAIL_NOT_VERIFIED') {
      return {error:authMessage(error.code),step:'verify',email};
    }
    return {error:authMessage(error.code)};
  }
  return enter();
}
export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const email=field(form,'email'), password=String(form.get('password')??'');
  if (password.length<8||password.length>128) return {error:'Mot de passe : entre 8 et 128 caractères.'};
  const auth=await getAuth();
  const {error}=await auth.signUp.email({email,password,name:field(form,'name')||email.split('@')[0]});
  if(error) return {error:authMessage(error.code)};
  return {step:'verify',email,info:'Compte créé. Saisis le code de confirmation reçu par email.'};
}
export async function verifyEmail(_: AuthState, form: FormData): Promise<AuthState> {
  const {error}=await (await getAuth()).emailOtp.verifyEmail({email:field(form,'email'),otp:field(form,'otp')});
  if(error) return {error:authMessage(error.code)};
  return enter();
}
export async function resendVerification(_: AuthState, form: FormData): Promise<AuthState> {
  const {error}=await (await getAuth()).emailOtp.sendVerificationOtp({email:field(form,'email'),type:'email-verification'});
  return error?{error:authMessage(error.code)}:{info:'Un nouveau code a été demandé. Vérifie aussi les courriers indésirables.'};
}
export async function requestPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email=field(form,'email');
  if(!email) return {error:'Indique ton adresse email.'};
  try {
    const {response,data}=await managedRequest('email-otp/request-password-reset',{email});
    if(!response.ok) return {error:authMessage(data.code)};
  } catch { return {error:'Le service de connexion est momentanément indisponible.'}; }
  return {step:'reset-code',email,info:'Si un compte existe, un code pour choisir un nouveau mot de passe a été envoyé.'};
}
export async function resetWithCode(_: AuthState, form: FormData): Promise<AuthState> {
  const email=field(form,'email'), password=String(form.get('password')??'');
  if(password.length<8||password.length>128) return {error:'Mot de passe : entre 8 et 128 caractères.'};
  if(password!==String(form.get('confirm')??'')) return {error:'Les deux mots de passe ne correspondent pas.'};
  const {response,data}=await managedRequest('email-otp/reset-password',{email,otp:field(form,'otp'),password});
  if(!response.ok) return {error:authMessage(data.code)};
  return {info:'Mot de passe enregistré. Tu peux maintenant te connecter.'};
}
export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  await requireSession();
  const newPassword=String(form.get('password')??'');
  if(newPassword.length<8||newPassword.length>128) return {error:'Mot de passe : entre 8 et 128 caractères.'};
  if(newPassword!==String(form.get('confirm')??'')) return {error:'Les deux mots de passe ne correspondent pas.'};
  const {error}=await (await getAuth()).changePassword({newPassword,currentPassword:String(form.get('currentPassword')??''),revokeOtherSessions:true});
  return error?{error:authMessage(error.code)}:{info:'Mot de passe modifié.'};
}
