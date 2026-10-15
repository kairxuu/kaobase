import Papa from "papaparse";
import type { ParseResult, ParsedTransaction } from "./types";

// Mapping des colonnes : soit un montant signé, soit débit/crédit séparés (format courant des banques FR).
export type CsvMapping = {
  date: string;
  label: string;
  amount?: string;
  debit?: string;
  credit?: string;
  dateFormat: "dmy" | "ymd" | "mdy";
};

export type CsvPreview = {
  headers: string[];
  sample: Record<string, string>[];
  mapping: CsvMapping | null;
};

const DATE_HINTS = ["date operation", "date opération", "date", "date valeur", "booking date", "jour"];
const LABEL_HINTS = ["libelle", "libellé", "label", "description", "intitule", "intitulé", "détail", "detail", "memo"];
const AMOUNT_HINTS = ["montant", "amount", "valeur", "somme"];
const DEBIT_HINTS = ["debit", "débit", "sortie"];
const CREDIT_HINTS = ["credit", "crédit", "entree", "entrée"];

function readCsv(text: string) {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], data: result.data };
}

function findColumn(headers: string[], hints: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const normalized = headers.map((h) => [h, norm(h)] as const);
  for (const hint of hints.map(norm)) {
    const exact = normalized.find(([, n]) => n === hint);
    if (exact) return exact[0];
  }
  for (const hint of hints.map(norm)) {
    const partial = normalized.find(([, n]) => n.includes(hint));
    if (partial) return partial[0];
  }
  return undefined;
}

function guessDateFormat(samples: string[]): CsvMapping["dateFormat"] {
  for (const s of samples) {
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s.trim())) return "ymd";
    const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (m && Number(m[2]) > 12) return "mdy";
  }
  return "dmy";
}

export function detectMapping(headers: string[], sample: Record<string, string>[]): CsvMapping | null {
  const date = findColumn(headers, DATE_HINTS);
  const label = findColumn(headers, LABEL_HINTS);
  if (!date || !label) return null;
  const amount = findColumn(headers, AMOUNT_HINTS);
  const debit = findColumn(headers, DEBIT_HINTS);
  const credit = findColumn(headers, CREDIT_HINTS);
  if (!amount && !(debit && credit)) return null;
  const dateFormat = guessDateFormat(sample.map((r) => r[date] ?? ""));
  // Débit/crédit séparés prioritaires : beaucoup de banques n'ont alors pas de colonne montant.
  return debit && credit ? { date, label, debit, credit, dateFormat } : { date, label, amount, dateFormat };
}

export function previewCsv(text: string): CsvPreview {
  const { headers, data } = readCsv(text);
  const sample = data.slice(0, 8);
  return { headers, sample, mapping: detectMapping(headers, sample) };
}

// "1 234,56 €" / "-1,234.56" / "(12.00)" -> nombre
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim().replace(/[€$£\s ]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function parseDate(raw: string | undefined, format: CsvMapping["dateFormat"]): string | null {
  if (!raw) return null;
  const parts = raw.trim().split(/[\sT]/)[0].split(/[-/.]/).map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  let [y, m, d] = [0, 0, 0];
  if (format === "ymd") [y, m, d] = parts;
  else if (format === "dmy") [d, m, y] = parts;
  else [m, d, y] = parts;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

export function parseCsv(text: string, mapping: CsvMapping): ParseResult {
  const { data } = readCsv(text);
  const rows: ParsedTransaction[] = [];
  const invalid: ParseResult["invalid"] = [];

  data.forEach((row, i) => {
    const line = i + 2; // +1 en-tête, +1 base 1
    const bookedAt = parseDate(row[mapping.date], mapping.dateFormat);
    const labelRaw = (row[mapping.label] ?? "").trim();
    let amount: number | null = null;
    if (mapping.amount) {
      amount = parseAmount(row[mapping.amount]);
    } else if (mapping.debit && mapping.credit) {
      const debit = parseAmount(row[mapping.debit]);
      const credit = parseAmount(row[mapping.credit]);
      if (debit != null || credit != null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!bookedAt) return invalid.push({ line, reason: "date illisible" });
    if (!labelRaw) return invalid.push({ line, reason: "libellé vide" });
    if (amount == null || amount === 0) return invalid.push({ line, reason: "montant illisible" });
    rows.push({ bookedAt, amount: Math.round(amount * 100) / 100, labelRaw });
  });

  return { rows, invalid };
}
