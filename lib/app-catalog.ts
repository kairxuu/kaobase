import type { AppCategory } from "@/lib/apps";

export type CatalogApp = {
  id: string;
  name: string;
  description: string;
  category: AppCategory;
  url: string | null;
  authMode: string;
  integrations: { id: string; name: string }[];
  source: "nango" | "local";
};
export type CatalogResult = {
  apps: CatalogApp[];
  configured: boolean;
  source: "nango" | "local";
  warning?: string;
};

// These are website shortcuts, never OAuth authorization endpoints. Unknown services
// deliberately require a website from the user instead of guessing one from API docs.
export const LOCAL_APPS: CatalogApp[] = [
  ["google-mail", "Gmail", "Messagerie Google", "communication", "https://mail.google.com/", "OAUTH2"],
  ["google-drive", "Google Drive", "Documents et fichiers", "work", "https://drive.google.com/", "OAUTH2"],
  ["google-calendar", "Google Agenda", "Calendrier Google", "work", "https://calendar.google.com/", "OAUTH2"],
  ["notion", "Notion", "Notes et organisation", "work", "https://www.notion.so/", "OAUTH2"],
  ["slack", "Slack", "Messagerie d'équipe", "communication", "https://slack.com/signin", "OAUTH2"],
  ["github", "GitHub", "Projets et code", "work", "https://github.com/login", "OAUTH2"],
  ["outlook", "Outlook", "Messagerie Microsoft", "communication", "https://outlook.live.com/", "OAUTH2"],
  ["one-drive", "OneDrive", "Fichiers Microsoft", "work", "https://onedrive.live.com/", "OAUTH2"],
  ["spotify", "Spotify", "Musique et podcasts", "entertainment", "https://open.spotify.com/", "OAUTH2"],
  ["dropbox", "Dropbox", "Stockage de fichiers", "work", "https://www.dropbox.com/login", "OAUTH2"],
  ["trello", "Trello", "Tableaux de projets", "work", "https://trello.com/login", "OAUTH2"],
  ["netflix", "Netflix", "Films et séries", "entertainment", "https://www.netflix.com/login", "NONE"],
  ["amazon-shopping", "Amazon", "Achats et commandes", "shopping", "https://www.amazon.fr/", "NONE"],
  ["paypal", "PayPal", "Paiements", "banking", "https://www.paypal.com/signin", "NONE"],
  ["canva", "Canva", "Création et présentations", "work", "https://www.canva.com/login", "OAUTH2"],
  ["figma", "Figma", "Design et collaboration", "work", "https://www.figma.com/login", "OAUTH2"],
].map(([id, name, description, category, url, authMode]) => ({
  id, name, description, category: category as AppCategory, url, authMode,
  integrations: [], source: "local",
}));

export function isOAuthMode(mode: string): boolean {
  return mode === "OAUTH1" || mode === "OAUTH2";
}

export function catalogCategory(categories: string[]): AppCategory {
  const values = categories.map((category) => category.toLowerCase());
  if (values.some((v) => /bank|accounting|finance|payment/.test(v))) return "banking";
  if (values.some((v) => /communication|messaging|email|chat/.test(v))) return "communication";
  if (values.some((v) => /ecommerce|e-commerce|shopping|commerce/.test(v))) return "shopping";
  if (values.some((v) => /music|video|entertainment|gaming/.test(v))) return "entertainment";
  if (values.some((v) => /productivity|storage|project|dev-tools|design|crm|marketing|support|hr|calendar|collaboration/.test(v))) return "work";
  return "other";
}
