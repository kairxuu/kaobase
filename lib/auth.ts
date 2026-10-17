import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/server';
import { createClient } from '@/lib/database/server';
import { getOnboardingStatus } from '@/lib/data/onboarding';
import { ensureAppIdentity } from '@/lib/data/identity';

export const getUserForApi = async () => {
  const { data, error } = await (await getAuth()).getSession();
  if (error || !data?.user?.emailVerified) return null;
  const db = await createClient();
  const userId = await ensureAppIdentity(db);
  return { db, userId, email: data.user.email };
};
export const requireSession = cache(async () => {
  const session = await getUserForApi();
  if (!session) redirect('/login');
  return session;
});
export const requireUser = cache(async () => {
  const session = await requireSession();
  if (await getOnboardingStatus(session.db, session.userId) !== 'complete') redirect('/setup');
  return session;
});
export const getCurrency = cache(async () => {
  const { db, userId } = await requireUser();
  const { data } = await db.from('profiles').select('currency').eq('id', userId).single();
  return (data?.currency as string | undefined) ?? 'EUR';
});
