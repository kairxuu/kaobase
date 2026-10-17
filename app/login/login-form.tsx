'use client';
import { useActionState, useState } from 'react';
import { signIn, signUp, requestPasswordReset, verifyEmail, resendVerification, resetWithCode, type AuthState } from './actions';
type Mode='in'|'up'|'reset'|'verify'|'reset-code';
const ACTIONS={in:signIn,up:signUp,reset:requestPasswordReset,verify:verifyEmail,'reset-code':resetWithCode};
export function LoginForm({initialMode='in',notice}:{initialMode?:'in'|'up'|'reset'|'verify';notice?:string}) {
  const [mode,setMode]=useState<Mode>(initialMode);
  const [email,setEmail]=useState('');
  return <div className="space-y-5">
    {notice&&<p className="rounded-md bg-warn-soft px-3 py-2 text-sm" role="status">{notice}</p>}
    <ModeForm key={mode} mode={mode} setMode={setMode} email={email} setEmail={setEmail}/>
  </div>;
}
function ModeForm({mode,setMode,email,setEmail}:{mode:Mode;setMode:(v:Mode)=>void;email:string;setEmail:(v:string)=>void}) {
  const [state,action,pending]=useActionState<AuthState,FormData>(async(previous, form)=>{
    const result=await ACTIONS[mode](previous,form);
    setEmail(String(form.get('email')??''));
    if(result.step){setEmail(result.email??'');setMode(result.step);}
    return result;
  },{});
  const [resend,resendAction,resending]=useActionState<AuthState,FormData>(resendVerification,{});
  const code=mode==='verify'||mode==='reset-code';
  return <div className="space-y-4"><form action={action} className="space-y-5">
    {(mode==='in'||mode==='up')&&<div className="flex gap-6 border-b border-line text-sm">{(['in','up'] as const).map(m=><button type="button" key={m} aria-pressed={mode===m} onClick={()=>setMode(m)} className={`-mb-px border-b-2 pb-2 transition-colors ${mode===m?'border-accent font-semibold text-accent':'border-transparent text-ink-2 hover:text-ink'}`}>{m==='in'?"J'ai un compte":"Je découvre Kaobase"}</button>)}</div>}
    {mode==='reset'&&<div><h2 className="section-title">Mot de passe oublié</h2><p className="text-sm text-ink-2">Indique l’adresse de ton compte. Nous t’enverrons un code pour choisir un nouveau mot de passe.</p></div>}
    {code&&<div><h2 className="section-title">{mode==='verify'?'Confirmer ton adresse':'Choisir un nouveau mot de passe'}</h2><p className="text-sm text-ink-2">Saisis le code à 6 chiffres reçu par e-mail. Si tu ne le trouves pas, regarde dans les courriers indésirables.</p></div>}
    {mode==='up'&&<div><label className="label" htmlFor="name">Prénom</label><input className="input" id="name" name="name" autoComplete="given-name"/></div>}
    <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" required value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email"/></div>
    {code&&<div><label className="label" htmlFor="otp">Code reçu par email</label><input className="input" id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></div>}
    {['in','up','reset-code'].includes(mode)&&<div><label className="label" htmlFor="password">{mode==='reset-code'?'Nouveau mot de passe':'Mot de passe'}</label><input className="input" id="password" name="password" type="password" required minLength={mode==='in'?1:8} maxLength={128} autoComplete={mode==='in'?'current-password':'new-password'} aria-describedby={mode==='in'?undefined:'password-help'}/>{mode!=='in'&&<p id="password-help" className="mt-1 text-xs text-ink-2">Entre 8 et 128 caractères.</p>}</div>}
    {mode==='reset-code'&&<div><label className="label" htmlFor="confirm">Confirmer le mot de passe</label><input className="input" id="confirm" name="confirm" type="password" required autoComplete="new-password"/></div>}
    {state.error&&<p className="text-sm text-neg" role="alert">{state.error}</p>}
    {state.info&&<p className="text-sm text-pos" role="status">{state.info}</p>}
    <button className="btn-primary w-full py-2.5" disabled={pending}>{pending?'Un instant…':mode==='in'?'Se connecter':mode==='up'?'Créer mon compte':mode==='verify'?'Confirmer mon adresse':mode==='reset'?'Recevoir le code':'Enregistrer le mot de passe'}</button>
    {mode==='in'&&<button type="button" onClick={()=>setMode('reset')} className="w-full text-sm text-accent">Mot de passe oublié ?</button>}
    {mode!=='in'&&<button type="button" onClick={()=>setMode('in')} className="w-full text-sm text-ink-2">Revenir à la connexion</button>}
  </form>{mode==='verify'&&<form action={resendAction}><input type="hidden" name="email" value={email}/><button disabled={resending} className="text-sm text-accent">Renvoyer le code</button><p role="status" className="text-sm">{resend.error??resend.info}</p></form>}</div>;
}
