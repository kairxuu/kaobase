// Local copies of the services' favicons keep common logos available offline.
const LOCAL_DOMAINS = new Set([
  'amazon.fr', 'mail.google.com', 'drive.google.com', 'calendar.google.com',
  'notion.so', 'slack.com', 'github.com', 'outlook.live.com', 'onedrive.live.com',
  'open.spotify.com', 'dropbox.com', 'trello.com', 'netflix.com', 'paypal.com',
  'canva.com', 'figma.com', 'proton.me',
]);
const ALIASES: Record<string, string> = {
  'amazon.com': 'amazon.fr', 'amazon.de': 'amazon.fr', 'amazon.co.uk': 'amazon.fr',
  'notion.com': 'notion.so', 'spotify.com': 'open.spotify.com',
  'gmail.com': 'mail.google.com', 'outlook.com': 'outlook.live.com',
  'onedrive.com': 'onedrive.live.com', 'protonmail.com': 'proton.me',
  'mail.proton.me': 'proton.me',
};

export function appIconSource(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    // Only public DNS names are sent to the icon provider, never paths or account details.
    if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /\.(?:local|localhost|internal|test|invalid|example)$/.test(host)) return null;
    const canonical = ALIASES[host] ?? host;
    if (LOCAL_DOMAINS.has(canonical)) return `/app-icons/${canonical}.png`;
    return `https://icon.horse/icon/${encodeURIComponent(host)}`;
  } catch {
    return null;
  }
}
