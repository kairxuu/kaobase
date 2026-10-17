"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseAppForm } from "@/lib/apps";
import { defaultSpace, getSpaceFilter } from "@/lib/space";
import { createAppShortcut, deleteAppShortcut, pinAppShortcut, updateAppShortcut } from "@/lib/data/apps";
import { friendlyError, UserError } from "@/lib/errors";
import { getShortcutConnection } from "@/lib/data/app-connections";

export type AppActionResult = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

async function run(action: () => Promise<unknown>, message: string): Promise<AppActionResult> {
  try {
    await action();
    revalidatePath("/apps");
    revalidatePath("/");
    return { ok: true, message };
  } catch (error) {
    console.error("[kaobase] mes apps :", error);
    return { ok: false, error: friendlyError(error) };
  }
}

function checkedId(id: string) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new UserError("App introuvable.");
  return parsed.data;
}

export async function createAppAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => createAppShortcut(supabase, parseAppForm(formData, defaultSpace(await getSpaceFilter()))), "App ajoutée.");
}

export async function updateAppAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => updateAppShortcut(supabase, checkedId(id), parseAppForm(formData, defaultSpace(await getSpaceFilter()))), "App mise à jour.");
}

export async function deleteAppAction(id: string) {
  const { supabase } = await requireUser();
  return run(async () => {
    const appId = checkedId(id);
    if (await getShortcutConnection(supabase, appId)) throw new UserError("Déconnecte cette app avant de supprimer son raccourci.");
    return deleteAppShortcut(supabase, appId);
  }, "Raccourci supprimé.");
}

export async function pinAppAction(id: string, pinned: boolean) {
  const { supabase } = await requireUser();
  return run(async () => {
    if (typeof pinned !== "boolean") throw new UserError("Choix d'affichage invalide.");
    return pinAppShortcut(supabase, checkedId(id), pinned);
  }, pinned ? "App affichée sur l'accueil." : "App retirée de l'accueil.");
}
