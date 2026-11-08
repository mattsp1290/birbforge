import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse


class PublicSecretFound(Exception):
    pass


patterns = [rb'sk-ant-[A-Za-z0-9_-]{20,}', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----']


def check_file(path, secrets):
    data = path.read_bytes()
    if any(secret and secret.encode() in data for secret in secrets) or any(re.search(pattern, data) for pattern in patterns):
        raise PublicSecretFound(f'Public secret scan failed: {path}')


parser = argparse.ArgumentParser()
parser.add_argument('fixture', type=Path)
parser.add_argument('--report', type=Path)
args = parser.parse_args()
clients = json.loads((args.fixture / 'clients.json').read_text())
config = json.loads((args.fixture / 'config.json').read_text())
secrets = list(clients['tokens'].values()) + [urlparse(config['database_url']).password]
with tempfile.TemporaryDirectory(prefix='birbforge-scan-selftest-') as root:
    marker = Path(root) / 'synthetic-key'
    marker.write_bytes(b'-----BEGIN ' + b'PRIVATE KEY-----\nSynthetic scan probe\n')
    try:
        check_file(marker, secrets)
    except PublicSecretFound:
        pass
    else:
        raise SystemExit('Private-key marker self-test failed')
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).split(b'\0')
checked = 0
try:
    for raw in paths:
        if not raw:
            continue
        path = Path(raw.decode())
        if path.is_symlink():
            raise PublicSecretFound(f'Public scan refuses symbolic links: {path}')
        if not path.is_file():
            continue
        check_file(path, secrets)
        checked += 1
except PublicSecretFound as error:
    raise SystemExit(str(error)) from None
if args.report:
    args.report.write_text(json.dumps({
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'synthetic_pkcs8_marker_rejected': True,
        'fixture_credentials_absent_from_public_files': True,
        'filesChecked': checked,
        'scope': 'Produced by scripts/public-check.py; tracked and intended untracked files',
    }, indent=2) + '\n')
print(f'Public credential scan and private-key self-test passed for {checked} repository files')
