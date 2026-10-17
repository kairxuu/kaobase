import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { AppShortcut } from "@/lib/apps";
import type { SpaceFilter } from "@/lib/space-shared";
import { parseAppForm } from "@/lib/apps";
import { UserError } from "@/lib/errors";

const COLUMNS = "id, name, url, account_label, category, space, pinned, created_at, updated_at";
type AppInput = ReturnType<typeof parseAppForm>;

export async function listAppShortcuts(supabase: Supabase, space: SpaceFilter = "all", options: { pinnedOnly?: boolean; limit?: number } = {}): Promise<AppShortcut[]> {
  const read = () => {
    let query = supabase.from("app_shortcuts").select(COLUMNS);
    if (space !== "all") query = query.eq("space", space);
    if (options.pinnedOnly) query = query.eq("pinned", true);
    return query.order("name").order("account_label").order("id");
  };
  if (options.limit != null) {
    const { data, error } = await read().limit(options.limit);
    if (error) throw error;
    return (data ?? []) as AppShortcut[];
  }
  const apps: AppShortcut[] = [];
  const batch = 200;
  for (let start = 0; ; start += batch) {
    const { data, error } = await read().range(start, start + batch - 1);
    if (error) throw error;
    const rows = (data ?? []) as AppShortcut[];
    apps.push(...rows);
    if (rows.length < batch) return apps;
  }
}

function row(input: AppInput) {
  return { name: input.name, url: input.url, account_label: input.accountLabel, category: input.category, space: input.space, pinned: input.pinned };
}

function checkError(error: { code?: string } | null) {
  if (error?.code === "23505") throw new UserError("Ce compte est déjà enregistré pour cette app dans cet espace.");
  if (error) throw error;
}

export async function createAppShortcut(supabase: Supabase, input: AppInput) {
  const { data, error } = await supabase.from("app_shortcuts").insert(row(input)).select(COLUMNS).single();
  checkError(error);
  if (!data) throw new UserError("L'app n'a pas pu être ajoutée.");
  return data as AppShortcut;
}

export async function updateAppShortcut(supabase: Supabase, id: string, input: AppInput) {
  const { data, error } = await supabase.from("app_shortcuts").update(row(input)).eq("id", id).select(COLUMNS).maybeSingle();
  checkError(error);
  if (!data) throw new UserError("App introuvable : elle a peut-être été supprimée.");
  return data as AppShortcut;
}

export async function pinAppShortcut(supabase: Supabase, id: string, pinned: boolean) {
  const { data, error } = await supabase.from("app_shortcuts").update({ pinned }).eq("id", id).select("id").maybeSingle();
  checkError(error);
  if (!data) throw new UserError("App introuvable : elle a peut-être été supprimée.");
}

export async function deleteAppShortcut(supabase: Supabase, id: string) {
  const { data, error } = await supabase.from("app_shortcuts").delete().eq("id", id).select("id").maybeSingle();
  checkError(error);
  if (!data) throw new UserError("App introuvable : elle a peut-être été supprimée.");
}
