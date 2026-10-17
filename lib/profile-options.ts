// Options communes à la configuration initiale et aux réglages.
export const CURRENCIES = [
  ["EUR", "Euro (€)"], ["USD", "Dollar américain ($)"], ["GBP", "Livre sterling (£)"],
  ["CHF", "Franc suisse"], ["CAD", "Dollar canadien"], ["MAD", "Dirham marocain"],
  ["XOF", "Franc CFA (BCEAO)"], ["XAF", "Franc CFA (BEAC)"],
  ["TND", "Dinar tunisien"], ["DZD", "Dinar algérien"],
] as const;

export const ACCOUNT_KINDS = ["checking", "savings", "card", "cash", "other"] as const;
