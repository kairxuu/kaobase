#!/usr/bin/env python3
"""Configure the public Kaobase website URL for iOS. No server secrets are copied."""
import argparse
from pathlib import Path
import plistlib
from urllib.parse import urlsplit
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--website',default='https://kaobase.vercel.app')
args=parser.parse_args()
u=urlsplit(args.website)
if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):
    raise SystemExit('Utilise une URL HTTPS publique, sans identifiants ni chemin.')
target=Path(__file__).parent/'Kaobase'/'Config.local.plist'
target.write_bytes(plistlib.dumps({'WebsiteURL':args.website.rstrip('/')}))
target.chmod(0o600)
print('Configuration iOS créée, sans clé ni secret serveur.')
