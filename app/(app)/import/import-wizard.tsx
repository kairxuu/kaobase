"use client";

import { useState, useTransition } from "react";
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
    <section className="card space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="account">Compte</label>
          <select className="input" id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="file">Fichier (.csv, .ofx)</label>
          <input
            className="input file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
            id="file"
            type="file"
            accept=".csv,.ofx,.qfx,.txt"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {file?.format === "csv" && preview && mapping && (
        <div className="space-y-4">
          <p className="text-sm">
            {preview.mapping ? "Colonnes détectées automatiquement — vérifie avant d'importer." : "Colonnes non reconnues : indique-les."}
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

      {file?.format === "ofx" && <p className="text-sm text-ink-2">Fichier OFX détecté : aucune configuration nécessaire.</p>}

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!file || pending || (file.format === "csv" && !mapping)} onClick={runImport}>
          {pending ? "Import en cours…" : "Importer"}
        </button>
        {error && <span className="text-sm text-neg">{error}</span>}
      </div>

      {result && (
        <div className="rounded-lg bg-accent-soft p-4 text-sm">
          <p className="font-medium">
            {result.imported} opération(s) importée(s) · {result.duplicates} doublon(s) ignoré(s) · {result.invalid} ligne(s) invalide(s)
          </p>
          <p className="mt-1 text-ink-2">
            Catégorisation : {result.categorization.byRule} par règles apprises, {result.categorization.byLlm} par l&apos;IA,{" "}
            {result.categorization.uncategorized} à classer.
            {result.categorization.llmError && " (IA indisponible : vérifie tes clés dans .env.local)"}
          </p>
          <p className="mt-1 text-ink-2">
            Abonnements : {result.subscriptions.created} nouveau(x) détecté(s), {result.subscriptions.updated} mis à jour.
          </p>
        </div>
      )}
    </section>
  );
}
