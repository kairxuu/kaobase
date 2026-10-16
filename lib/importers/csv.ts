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
  const error = Object.keys(result.meta.renamedHeaders ?? {}).length > 0
    ? "Le fichier CSV contient des colonnes dupliquées. Renomme-les avant l'import."
    : result.errors.some((error) => error.type === "Quotes")
      ? "Le fichier CSV contient des guillemets mal fermés. Corrige le fichier avant l'import."
      : undefined;
  const invalidRows = new Set(result.errors.filter((error) => error.type === "FieldMismatch").map((error) => error.row));
  return { headers: result.meta.fields ?? [], data: result.data, invalidRows, error };
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
  const { headers, data, error } = readCsv(text);
  const sample = data.slice(0, 8);
  return { headers, sample, mapping: error ? null : detectMapping(headers, sample) };
}

// "1 234,56 €" / "-1,234.56" / "(12.00)" -> nombre
export function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim().replace(/−/g, "-");
  if (!s) return null;
  if ((s.match(/[€$£]/g)?.length ?? 0) > 1) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // Une devise peut précéder ou suivre le montant, jamais couper ses chiffres.
  s = s.replace(/^([+-]?)\s*[€$£]\s*/, "$1").replace(/\s*[€$£]$/, "").trim();
  if (s.endsWith("-")) {
    if (negative) return null;
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (/^[+-]/.test(s)) {
    if (negative) return null;
    negative = s[0] === "-";
    s = s.slice(1).trim();
  }

  if (/[ \u00a0\u202f]/.test(s)) {
    if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(s)) return null;
    s = s.replace(/[ \u00a0\u202f]/g, "");
  }

  if (s.includes(",") && s.includes(".")) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const [integer, fraction, extra] = s.split(decimal);
    if (extra !== undefined || !/^\d{1,2}$/.test(fraction) || !new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(integer)) return null;
    s = `${integer.split(grouping).join("")}.${fraction}`;
  } else if (/[.,]/.test(s)) {
    const separator = s.includes(",") ? "," : ".";
    const parts = s.split(separator);
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      s = parts.join(".");
    } else if (parts.length > 2 && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((part) => /^\d{3}$/.test(part))) {
      s = parts.join("");
    } else {
      // « 1,234 » peut être un millier ou un montant à trois décimales.
      return null;
    }
  } else {
    if (!/^\d+$/.test(s)) return null;
  }
  const n = Number(s);
  // Les colonnes monétaires sont numeric(14, 2) ; garder les centimes exacts.
  if (!Number.isFinite(n) || n > 999999999999.99) return null;
  return negative ? -n : n;
}

export function parseDate(raw: string | undefined, format: CsvMapping["dateFormat"]): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/);
  if (!match || !["dmy", "ymd", "mdy"].includes(format)) return null;
  const fields = match.slice(1, 4);
  const year = format === "ymd" ? fields[0] : fields[2];
  if (!(year.length === 4 || (format !== "ymd" && year.length === 2))) return null;
  if (format !== "ymd" && fields[0].length > 2) return null;
  if (format === "ymd" && fields[2].length > 2) return null;
  const parts = fields.map(Number);
  let [y, m, d] = [0, 0, 0];
  if (format === "ymd") [y, m, d] = parts;
  else if (format === "dmy") [d, m, y] = parts;
  else [m, d, y] = parts;
  if (year.length === 2) y += 2000;
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > days[m - 1]) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseCsv(text: string, mapping: CsvMapping): ParseResult {
  const { headers, data, invalidRows, error } = readCsv(text);
  const rows: ParsedTransaction[] = [];
  const invalid: ParseResult["invalid"] = [];
  if (error) return { rows, invalid, error };
  const selected = [mapping.date, mapping.label, ...(mapping.amount ? [mapping.amount] : [mapping.debit, mapping.credit])];
  if (selected.some((column) => !column || !headers.includes(column)) || new Set(selected).size !== selected.length || !["dmy", "ymd", "mdy"].includes(mapping.dateFormat)) {
    return { rows, invalid, error: "Le mapping CSV est invalide : sélectionne des colonnes distinctes pour la date, le libellé et les montants." };
  }

  data.forEach((row, i) => {
    const line = i + 2; // +1 en-tête, +1 base 1
    if (invalidRows.has(i)) return invalid.push({ line, reason: "nombre de colonnes incorrect" });
    const bookedAt = parseDate(row[mapping.date], mapping.dateFormat);
    const labelRaw = (row[mapping.label] ?? "").trim();
    let amount: number | null = null;
    if (mapping.amount) {
      amount = parseAmount(row[mapping.amount]);
    } else if (mapping.debit && mapping.credit) {
      const debit = parseAmount(row[mapping.debit]);
      const credit = parseAmount(row[mapping.credit]);
      const badDebit = Boolean(row[mapping.debit]?.trim()) && debit == null;
      const badCredit = Boolean(row[mapping.credit]?.trim()) && credit == null;
      // Un champ illisible n'est pas un zéro ; une ligne débit ET crédit est ambiguë.
      if (!badDebit && !badCredit && !(debit && credit) && (debit != null || credit != null) && (credit == null || credit >= 0)) {
        amount = (credit ?? 0) - Math.abs(debit ?? 0);
      }
    }
    if (!bookedAt) return invalid.push({ line, reason: "date illisible" });
    if (!labelRaw) return invalid.push({ line, reason: "libellé vide" });
    if (amount == null || amount === 0) return invalid.push({ line, reason: "montant illisible" });
    rows.push({ bookedAt, amount: Math.round(amount * 100) / 100, labelRaw });
  });

  return { rows, invalid };
}
