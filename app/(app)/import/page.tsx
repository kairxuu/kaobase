import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSpaceFilter } from "@/lib/space";
import { getAccounts } from "@/lib/data/finance";
import type { ImportRecord } from "@/lib/types";
import { shortDate } from "@/lib/ui/format";
import { ImportWizard } from "./import-wizard";
import { undoImportAction } from "../actions";
import { ActionButton } from "../_components/action-button";

export default async function ImportPage() {
  const { supabase } = await requireUser();
  const [accounts, { data: imports }] = await Promise.all([
    getAccounts(supabase, await getSpaceFilter()),
    supabase
      .from("imports")
      .select("id, filename, format, rows_total, rows_imported, rows_duplicate, rows_invalid, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Importer un relevé</h1>
        <p className="page-lede">
          Télécharge un relevé CSV ou OFX depuis l&apos;espace client de ta banque, puis dépose-le ici. Tu peux importer
          deux fois la même période : les opérations déjà présentes sont ignorées.
        </p>
      </header>

      {accounts.length === 0 ? (
        <div className="slip text-sm">
          Aucun compte dans cet espace. Crée-en un dans <Link href="/settings" className="text-accent hover:underline">Réglages</Link>,
          ou repasse sur « Tout » dans la barre latérale.
        </div>
      ) : (
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />
      )}

      <section className="overflow-x-auto">
        <h2 className="section-title">Relevés déjà importés</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Fichier</th>
              <th>Date</th>
              <th className="text-right">Ajoutées</th>
              <th className="text-right">Déjà présentes</th>
              <th className="text-right">Illisibles</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {((imports ?? []) as ImportRecord[]).map((i) => (
              <tr key={i.id}>
                <td>
                  {i.filename}
                </td>
                <td className="text-ink-2">{shortDate(i.created_at)}</td>
                <td className="num text-right">{i.rows_imported}</td>
                <td className="num text-right text-ink-2">{i.rows_duplicate}</td>
                <td className={`num text-right ${i.rows_invalid ? "text-warn" : "text-ink-2"}`}>{i.rows_invalid}</td>
                <td className="text-right">
                  <ActionButton
                    action={undoImportAction.bind(null, i.id)}
                    confirm={`Annuler l'import « ${i.filename} » ? Ses ${i.rows_imported} opérations seront retirées, y compris celles que tu as recatégorisées.`}
                  >
                    Annuler cet import
                  </ActionButton>
                </td>
              </tr>
            ))}
            {(imports ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ink-3">Aucun relevé importé pour l&apos;instant.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
