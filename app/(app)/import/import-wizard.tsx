"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CsvMapping, CsvPreview } from "@/lib/importers/csv";
import { importFileAction, previewCsvAction } from "../actions";

type ImportResult = {
  imported: number;
  duplicates: number;
  invalid: number;
  categorization: { byRule: number; byLlm: number; uncategorized: number; llmError: string | null };
  subscriptions: { detected: number; created: number; updated: number };
};

export function ImportWizard({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; text: string; format: "csv" | "ofx" } | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(f: File | undefined) {
    setResult(null);
    setError(null);
    setPreview(null);
    setMapping(null);
    if (!f) return setFile(null);
    const buffer = await f.arrayBuffer();
    // Beaucoup de banques françaises exportent en Windows-1252 : on essaie UTF-8, sinon on bascule.
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    const format = /\.(ofx|qfx)$/i.test(f.name) || /<OFX>/i.test(text) ? "ofx" : "csv";
    setFile({ name: f.name, text, format });
    if (format === "csv") {
      start(async () => {
        const res = await previewCsvAction(text);
        if (!res.ok) return setError(res.error);
        setPreview(res.data);
        setMapping(
          res.data.mapping ?? { date: res.data.headers[0] ?? "", label: res.data.headers[1] ?? "", amount: res.data.headers[2], dateFormat: "dmy" },
        );
      });
    }
  }

  function runImport() {
    if (!file) return;
    start(async () => {
      const res = await importFileAction({
        text: file.text,
        filename: file.name,
        format: file.format,
        mapping: mapping ?? undefined,
        accountId: accountId || null,
      });
      if (!res.ok) return setError(res.error);
      setError(null);
      setResult(res.data as ImportResult);
    });
  }

  // Fichier choisi avant que la page soit interactive (téléphone lent) : on le traite dès qu'elle l'est.
  useEffect(() => {
    const pendingFile = fileInput.current?.files?.[0];
    if (pendingFile) void onFile(pendingFile);
  }, []);

  const headers = preview?.headers ?? [];
  const amountMode = mapping?.amount ? "signed" : "split";
  const columnSelect = (key: keyof CsvMapping, label: string) => (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={(mapping?.[key] as string) ?? ""}
        onChange={(e) => setMapping((m) => (m ? { ...m, [key]: e.target.value } : m))}
      >
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="card space-y-5 p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="account">Compte concerné</label>
          <select className="input" id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="file">Relevé (CSV ou OFX)</label>
          <input
            className="input file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
            id="file"
            ref={fileInput}
            type="file"
            accept=".csv,.ofx,.qfx,.txt"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {file?.format === "csv" && preview && mapping && (
        <div className="space-y-4">
          <p className="text-sm">
            {preview.mapping ? "Kaobase a reconnu les colonnes de ta banque. Vérifie-les avec l'aperçu avant d'importer." : "Kaobase n'a pas reconnu ces colonnes. Indique laquelle contient la date, le libellé et le montant."}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {columnSelect("date", "Date")}
            {columnSelect("label", "Libellé")}
            <div>
              <label className="label">Format de date</label>
              <select
                className="input"
                value={mapping.dateFormat}
                onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as CsvMapping["dateFormat"] })}
              >
                <option value="dmy">JJ/MM/AAAA</option>
                <option value="ymd">AAAA-MM-JJ</option>
                <option value="mdy">MM/JJ/AAAA</option>
              </select>
            </div>
            <div>
              <label className="label">Montants</label>
              <select
                className="input"
                value={amountMode}
                onChange={(e) =>
                  setMapping(
                    e.target.value === "signed"
                      ? { date: mapping.date, label: mapping.label, dateFormat: mapping.dateFormat, amount: headers[0] }
                      : { date: mapping.date, label: mapping.label, dateFormat: mapping.dateFormat, debit: headers[0], credit: headers[0] },
                  )
                }
              >
                <option value="signed">Une colonne signée</option>
                <option value="split">Débit / Crédit séparés</option>
              </select>
            </div>
            {amountMode === "signed" ? columnSelect("amount", "Montant") : (
              <>
                {columnSelect("debit", "Débit")}
                {columnSelect("credit", "Crédit")}
              </>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="table text-xs">
              <thead>
                <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.sample.slice(0, 5).map((row, i) => (
                  <tr key={i}>{headers.map((h) => <td key={h} className="whitespace-nowrap">{row[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {file?.format === "ofx" && <p className="text-sm text-ink-2">Relevé OFX : rien à régler, tu peux importer.</p>}

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!file || pending || (file.format === "csv" && !mapping)} onClick={runImport}>
          {pending ? "Import en cours…" : "Importer le relevé"}
        </button>
        {error && <span className="text-sm text-neg">{error}</span>}
      </div>

      {result && (
        <div className="reply space-y-1 rounded-md bg-accent-soft p-4 text-sm" role="status">
          <p className="font-medium">
            {result.imported} opérations ajoutées.
            {result.duplicates > 0 && ` ${result.duplicates} étaient déjà là et ont été ignorées.`}
            {result.invalid > 0 && ` ${result.invalid} lignes illisibles ont été écartées.`}
          </p>
          <p className="text-ink-2">
            {result.categorization.byRule} triées grâce à tes choix passés, {result.categorization.byLlm} par l&apos;IA
            {result.categorization.uncategorized > 0 ? `, ${result.categorization.uncategorized} restent à trier.` : "."}
            {result.categorization.llmError && " L'IA n'a pas répondu : les opérations restantes pourront être triées plus tard depuis Opérations."}
          </p>
          {result.subscriptions.created > 0 && (
            <p className="text-ink-2">
              {result.subscriptions.created} paiements réguliers repérés : confirme-les dans Abonnements.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
