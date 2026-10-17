#!/usr/bin/env python3
"""Copy only public Auth settings into the iOS bundle; no database/server secrets."""
import argparse
import base64
import json
from pathlib import Path
import plistlib
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--env", type=Path, default=ROOT / ".env.local")
parser.add_argument("--website", default="https://kaobase.vercel.app")
args = parser.parse_args()
values = {}
for line in args.env.read_text().splitlines():
    line = line.strip()
    if line.startswith("export "):
        line = line[7:]
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key in ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"):
        values[key] = value.strip().strip("\"'")

def origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise SystemExit("Utilise une URL HTTPS publique, sans identifiants ni chemin.")
    return value.rstrip("/")

key = values.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
if key.startswith("sb_publishable_"):
    pass
elif key.count(".") == 2:
    try:
        payload = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims.get("role") != "anon":
            raise ValueError()
    except Exception:
        raise SystemExit("Seule la clé publique anon est autorisée dans l’app iOS.") from None
else:
    raise SystemExit("La clé publique Supabase manque ou n’est pas reconnue.")
target = Path(__file__).parent / "Kaobase" / "Config.local.plist"
target.write_bytes(plistlib.dumps({"WebsiteURL": origin(args.website), "SupabaseURL": origin(values.get("NEXT_PUBLIC_SUPABASE_URL", "")), "SupabasePublicKey": key}))
target.chmod(0o600)
print("Configuration publique iOS créée. Aucun secret serveur ni mot de passe copié.")
