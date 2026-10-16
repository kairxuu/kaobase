import type { ParseResult, ParsedTransaction } from "./types";
import { parseAmount, parseDate } from "./csv";

// Parseur OFX minimal (v1 SGML et v2 XML) : on ne lit que les blocs <STMTTRN>,
// ce qui couvre les exports des banques françaises.

function tag(block: string, name: string): string | undefined {
  // SGML : <TAG>valeur (sans fermeture) ; XML : <TAG>valeur</TAG>
  const m = block.match(new RegExp(`<${name}\\s*>([^<\\r\\n]*)`, "i"));
  return m?.[1]?.trim() || undefined;
}

function decodeEntities(s: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return entities[code.toLowerCase()];
    const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
  });
}

function ofxDate(raw: string | undefined): string | null {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})(?:(?:[01]\d|2[0-3])[0-5]\d[0-5]\d(?:\.\d{1,9})?)?(?:\[[+-]?\d{1,2}(?:\.\d+)?:[^\]\r\n<>]+\])?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return parseDate(`${y}-${mo}-${d}`, "ymd");
}

export function parseOfx(text: string): ParseResult {
  const rows: ParsedTransaction[] = [];
  const invalid: ParseResult["invalid"] = [];
  // L'import choisit un seul compte cible. Ne jamais y fusionner plusieurs relevés.
  const statements = text.match(/<(?:STMTRS|CCSTMTRS)\b[^>]*>/gi) ?? [];
  const accounts = text.match(/<(?:BANKACCTFROM|CCACCTFROM)\b[^>]*>/gi) ?? [];
  const transactionLists = text.match(/<BANKTRANLIST\b[^>]*>/gi) ?? [];
  if (Math.max(statements.length, accounts.length, transactionLists.length) > 1) {
    return { rows, invalid, error: "Ce fichier OFX contient plusieurs relevés ou comptes. Exporte un seul compte par fichier." };
  }
  const blocks = text.split(/<STMTTRN\s*>/i).slice(1).map((b) => b.split(/<\/(?:STMTTRN|BANKTRANLIST)\s*>/i)[0]);

  blocks.forEach((block, i) => {
    const bookedAt = ofxDate(tag(block, "DTPOSTED"));
    const amount = parseAmount(tag(block, "TRNAMT"));
    const name = tag(block, "NAME");
    const memo = tag(block, "MEMO");
    const labelRaw = decodeEntities([name, memo && memo !== name ? memo : undefined].filter(Boolean).join(" "));
    const line = i + 1;
    if (!bookedAt) return invalid.push({ line, reason: "date illisible" });
    if (amount == null || amount === 0) return invalid.push({ line, reason: "montant illisible" });
    if (!labelRaw) return invalid.push({ line, reason: "libellé vide" });
    rows.push({ bookedAt, amount: Math.round(amount * 100) / 100, labelRaw });
  });

  return { rows, invalid };
}
