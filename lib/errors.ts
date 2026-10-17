// Traduit les erreurs techniques (Postgres, PostgREST, Neon Auth) en phrases que l'utilisateur
// peut comprendre et corriger. Le détail brut reste dans les journaux serveur.

type ErrorLike = { code?: string; message?: string; status?: number } | Error | unknown;

// Erreur rédigée pour l'utilisateur (validation, élément introuvable…) : affichée telle quelle.
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

const BY_CODE: Record<string, string> = {
  "23505": "Cet élément existe déjà.",
  "23503": "Cet élément est encore utilisé ailleurs, ou fait référence à un élément introuvable.",
  "23514": "Une des valeurs saisies n'est pas acceptée.",
  "23502": "Un champ obligatoire est vide.",
  "22P02": "Une valeur n'a pas le bon format (nombre, date ou identifiant).",
  "22007": "La date n'est pas valide.",
  "22003": "Le montant est trop grand.",
  PGRST116: "Élément introuvable : il a peut-être déjà été supprimé.",
  PGRST205: "Cette fonctionnalité n'est pas encore activée : une mise à jour de la base manque.",
  "42P01": "Cette fonctionnalité n'est pas encore activée : une mise à jour de la base manque.",
  invalid_credentials: "Email ou mot de passe incorrect.",
  email_not_confirmed: "Adresse pas encore confirmée : ouvre le lien reçu par email.",
  weak_password: "Mot de passe trop faible : 8 caractères minimum.",
  same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
  over_email_send_rate_limit: "Trop d'emails envoyés : réessaie dans quelques minutes.",
  session_not_found: "Ta session a expiré : reconnecte-toi.",
};

export function friendlyError(error: ErrorLike): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown };
    if (typeof e.code === "string" && BY_CODE[e.code]) return BY_CODE[e.code];
    const message = typeof e.message === "string" ? e.message : "";
    if (error instanceof UserError || (error as Error).name === "UserError") return message;
    if (/duplicate key/i.test(message)) return BY_CODE["23505"];
    if (/foreign key/i.test(message)) return BY_CODE["23503"];
    if (/check constraint/i.test(message)) return BY_CODE["23514"];
    if (/invalid input syntax/i.test(message)) return BY_CODE["22P02"];
    if (/JWT|session/i.test(message)) return BY_CODE.session_not_found;
  }
  return "Une erreur inattendue est survenue. Réessaie dans un instant.";
}
