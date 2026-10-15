import { requireUser } from "@/lib/auth";
import { getAccounts } from "@/lib/data/finance";
import type { ImportRecord } from "@/lib/types";
import { shortDate } from "@/lib/ui/format";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  const { supabase } = await requireUser();
  const [accounts, { data: imports }] = await Promise.all([
    getAccounts(supabase),
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

      <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />

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
              </tr>
            ))}
            {(imports ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-3">Aucun relevé importé pour l&apos;instant.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
