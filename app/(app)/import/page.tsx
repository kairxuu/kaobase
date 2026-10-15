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
        <h1 className="text-2xl font-semibold tracking-tight">Import de relevés</h1>
        <p className="text-sm text-ink-2">
          CSV ou OFX exporté depuis ta banque. Les doublons sont ignorés, les opérations catégorisées (règles puis IA) et
          les abonnements détectés automatiquement.
        </p>
      </header>

      <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} />

      <section className="card overflow-x-auto p-0">
        <h2 className="card-title px-5 pt-5">Historique</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Fichier</th>
              <th>Date</th>
              <th className="text-right">Importées</th>
              <th className="text-right">Doublons</th>
              <th className="text-right">Invalides</th>
            </tr>
          </thead>
          <tbody>
            {((imports ?? []) as ImportRecord[]).map((i) => (
              <tr key={i.id}>
                <td>
                  {i.filename} <span className="badge ml-1 uppercase">{i.format}</span>
                </td>
                <td className="text-ink-2">{shortDate(i.created_at)}</td>
                <td className="num text-right">{i.rows_imported}</td>
                <td className="num text-right text-ink-2">{i.rows_duplicate}</td>
                <td className={`num text-right ${i.rows_invalid ? "text-warn" : "text-ink-2"}`}>{i.rows_invalid}</td>
              </tr>
            ))}
            {(imports ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-3">Aucun import pour l&apos;instant.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
