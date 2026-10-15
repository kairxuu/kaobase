// Normalisation des libellés bancaires en « marchand » stable.
// C'est la clé partagée par les règles de catégorisation et la détection d'abonnements :
// "PRLV SEPA NETFLIX.COM 12/03 REF 8841" et "CB NETFLIX.COM 14/04" -> "NETFLIX".

const NOISE_PREFIXES = [
  "PRLV SEPA",
  "PRELEVEMENT SEPA",
  "PRELEVEMENT",
  "PRLV",
  "VIR SEPA RECU",
  "VIR SEPA EMIS",
  "VIREMENT SEPA",
  "VIREMENT",
  "VIR INST",
  "VIR",
  "CARTE",
  "PAIEMENT PAR CARTE",
  "PAIEMENT CB",
  "ACHAT CB",
  "CB",
  "FACTURE CARTE",
  "RETRAIT DAB",
  "ECHEANCE PRET",
];

const NOISE_TOKENS = new Set([
  "SAS", "SA", "SARL", "EURL", "LTD", "INC", "GMBH", "BV", "EU", "FR", "FRANCE",
  "PARIS", "SEPA", "REF", "MANDAT", "ECH", "PAYPAL", "WWW", "COM", "NET", "ORG",
]);

export function normalizeMerchant(label: string): string {
  let s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  for (const prefix of NOISE_PREFIXES) {
    if (s.startsWith(prefix + " ")) {
      s = s.slice(prefix.length + 1);
      break;
    }
  }

  // PayPal masque souvent le vrai marchand : "PAYPAL *SPOTIFY" -> "SPOTIFY".
  s = s.replace(/^PAYPAL\s*\*\s*/, "");

  s = s
    .replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, " ") // dates
    .replace(/\b(REF|RUM|MANDAT|ID|NO|N°)[:\s]*\S+/g, " ") // références
    .replace(/\b\d*X+\d{2,}\b/g, " ") // numéros de carte masqués (X4521, 4970XXXX1234)
    .replace(/\.(COM|FR|NET|IO|CO|EU)\b/g, " ")
    .replace(/[*#_/\\|:;,'"()[\]{}+]/g, " ")
    .replace(/\b\d+\b/g, " ") // nombres isolés
    .replace(/\s+/g, " ")
    .trim();

  // Un jeton avec 3 chiffres ou plus est une référence variable (P48213, CMD20260412), pas un nom.
  const tokens = s
    .split(" ")
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t) && (t.match(/\d/g)?.length ?? 0) < 3);
  const merchant = tokens.slice(0, 3).join(" ");
  return merchant || label.toUpperCase().trim().slice(0, 40);
}

// Hash déterministe pour le dédoublonnage des imports (même ligne importée deux fois = ignorée).
// FNV-1a 64 bits : suffisant ici, pas besoin d'un hash cryptographique.
export function dedupeHash(parts: {
  accountId: string | null;
  bookedAt: string;
  amount: number;
  labelRaw: string;
  occurrence?: number | string;
}): string {
  const input = [
    parts.accountId ?? "",
    parts.bookedAt,
    parts.amount.toFixed(2),
    parts.labelRaw.replace(/\s+/g, " ").trim().toUpperCase(),
    parts.occurrence ?? 0,
  ].join("|");
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
