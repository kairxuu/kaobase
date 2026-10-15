// Garde serveur des suppressions : seul un accord explicite dans le message de l'utilisateur
// autorise un outil de suppression. Le modèle ne peut pas l'accorder à sa place.

const YES = [
  "oui", "ouais", "yes", "ok", "okay", "d'accord", "daccord", "dac", "vas-y", "vas y", "go",
  "confirme", "je confirme", "confirmé", "confirmer", "supprime", "supprime-la", "supprime-le",
  "supprime les", "supprimer", "efface", "efface-la", "efface-le", "c'est bon", "exact", "valide",
];
const NO = ["non", "pas", "annule", "stop", "attends", "surtout pas", "ne supprime"];

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExplicitConfirmation(message: string): boolean {
  const text = ` ${normalize(message)} `;
  if (NO.some((w) => text.includes(` ${normalize(w)} `))) return false;
  return YES.some((w) => text.includes(` ${normalize(w)} `));
}
