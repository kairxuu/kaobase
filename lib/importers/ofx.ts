import type { ParseResult, ParsedTransaction } from "./types";

// Parseur OFX minimal (v1 SGML et v2 XML) : on ne lit que les blocs <STMTTRN>,
// ce qui couvre les exports des banques françaises.

function tag(block: string, name: string): string | undefined {
  // SGML : <TAG>valeur (sans fermeture) ; XML : <TAG>valeur</TAG>
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m?.[1]?.trim() || undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function ofxDate(raw: string | undefined): string | null {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(mo) - 1) return null;
  return `${y}-${mo}-${d}`;
}

export function parseOfx(text: string): ParseResult {
  const rows: ParsedTransaction[] = [];
  const invalid: ParseResult["invalid"] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]);

  blocks.forEach((block, i) => {
    const bookedAt = ofxDate(tag(block, "DTPOSTED"));
    const amount = Number((tag(block, "TRNAMT") ?? "").replace(",", "."));
    const name = tag(block, "NAME");
    const memo = tag(block, "MEMO");
    const labelRaw = decodeEntities([name, memo && memo !== name ? memo : undefined].filter(Boolean).join(" "));
    const line = i + 1;
    if (!bookedAt) return invalid.push({ line, reason: "date illisible" });
    if (!Number.isFinite(amount) || amount === 0) return invalid.push({ line, reason: "montant illisible" });
    if (!labelRaw) return invalid.push({ line, reason: "libellé vide" });
    rows.push({ bookedAt, amount: Math.round(amount * 100) / 100, labelRaw });
  });

  return { rows, invalid };
}
