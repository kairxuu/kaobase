export type ParsedTransaction = {
  bookedAt: string; // YYYY-MM-DD
  amount: number; // négatif = dépense
  labelRaw: string;
};

export type ParseResult = {
  rows: ParsedTransaction[];
  invalid: { line: number; reason: string }[];
  error?: string; // erreur globale : aucune ligne du fichier ne doit être importée
};
