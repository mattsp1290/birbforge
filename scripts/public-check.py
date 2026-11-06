import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

fixture = Path(sys.argv[1])
clients = json.loads((fixture / 'clients.json').read_text())
config = json.loads((fixture / 'config.json').read_text())
secrets = list(clients['tokens'].values()) + [urlparse(config['database_url']).password]
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).split(b'\0')
patterns = [rb'sk-ant-[A-Za-z0-9_-]{20,}', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'-----BEGIN (?:OPENSSH|RSA|EC|PRIVATE).*PRIVATE KEY-----']
checked = 0
for raw in paths:
    if not raw:
        continue
    path = Path(raw.decode())
    if not path.is_file():
        continue
    data = path.read_bytes()
    if any(secret and secret.encode() in data for secret in secrets) or any(re.search(pattern, data) for pattern in patterns):
        raise SystemExit(f'Public secret scan failed: {path}')
    checked += 1
print(f'Public credential scan passed for {checked} tracked and intended untracked files')
