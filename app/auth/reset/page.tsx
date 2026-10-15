import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function ResetPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <p className="font-display text-[1.7rem] leading-none tracking-tight">kaobase</p>
        {data?.claims ? (
          <>
            <div>
              <h1 className="page-title text-3xl">Nouveau mot de passe</h1>
              <p className="page-lede">Choisis-en un d&apos;au moins 8 caractères. Tu resteras connecté ensuite.</p>
            </div>
            <PasswordForm redirectHome />
          </>
        ) : (
          <div className="space-y-4">
            <h1 className="page-title text-3xl">Lien expiré</h1>
            <p className="page-lede">
              Ce lien de réinitialisation n&apos;est plus valable ou a été ouvert dans un autre navigateur. Demande-en un nouveau.
            </p>
            <Link href="/login?mode=reset" className="btn-primary">Recevoir un nouveau lien</Link>
          </div>
        )}
      </div>
    </main>
  );
}
