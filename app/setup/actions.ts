"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { completeSetup, parseSetupForm } from "@/lib/data/onboarding";
import { friendlyError } from "@/lib/errors";
import { cookies } from "next/headers";
import { SPACE_COOKIE } from "@/lib/space-shared";

export async function finishSetup(_: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const { db } = await requireSession();
  try {
    const input = parseSetupForm(formData);
    await completeSetup(db, input);
    // Un second onglet peut terminer un formulaire déjà validé : afficher tous
    // les comptes évite qu'un ancien choix de filtre masque le compte configuré.
    (await cookies()).set(SPACE_COOKIE, "all", {
      path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365,
    });
  } catch (error) {
    console.error("[kaobase] configuration initiale :", error);
    return { error: friendlyError(error) };
  }
  revalidatePath("/", "layout");
  redirect("/");
}
