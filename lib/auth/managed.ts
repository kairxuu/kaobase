import 'server-only';
// OTP reset endpoints in the installed SDK differ from the managed API schema.
// Use the documented managed endpoints while retaining the SDK for browser sessions.
export async function managedRequest(path: string, body?: Record<string, unknown>, sessionToken?: string) {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) throw new Error('NEON_AUTH_BASE_URL manquante.');
  const headers = new Headers({ 'Content-Type': 'application/json', Origin: process.env.APP_ORIGIN ?? 'https://kaobase.vercel.app' });
  if (sessionToken) {
    if (!/^[A-Za-z0-9_.%~=-]+$/.test(sessionToken)) throw new Error('Invalid session');
    headers.set('Cookie', `__Secure-neon-auth.session_token=${sessionToken}`);
  }
  const response = await fetch(`${base.replace(/\/$/,'')}/${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  return { response, data };
}
export function authMessage(code?: string) {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD': return 'Email ou mot de passe incorrect. Si ton compte existait avant la migration, choisis « Mot de passe oublié ».';
    case 'EMAIL_NOT_VERIFIED': return 'Confirme ton adresse avec le code reçu par email.';
    case 'USER_ALREADY_EXISTS': case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return 'Cette adresse possède déjà un compte. Connecte-toi ou réinitialise ton mot de passe.';
    case 'INVALID_OTP': case 'OTP_EXPIRED': case 'INVALID_TOKEN': return 'Ce code est incorrect ou expiré. Demande un nouveau code.';
    case 'TOO_MANY_REQUESTS': case 'TOO_MANY_ATTEMPTS': return 'Trop de tentatives. Réessaie dans quelques minutes.';
    default: return 'La demande a échoué. Vérifie tes informations et réessaie.';
  }
}
