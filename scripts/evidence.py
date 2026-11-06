import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

paths = ['package.json', 'package-lock.json', 'app.json', 'tsconfig.json', 'tsconfig.node.json']
for directory in ['app', 'server', 'scripts', 'tests']:
    paths += [str(path) for path in Path(directory).rglob('*') if path.is_file() and '__pycache__' not in path.parts]
report = {
    'checked_at': datetime.now(timezone.utc).isoformat(),
    'scope': 'Source hashes computed after the successful scripts/verify checks. Target acceptance is separately recorded.',
    'node': subprocess.check_output(['.local/bin/node', '--version'], text=True).strip(),
    'source_hashes': {path: hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in sorted(paths)},
    'required_native_phone': 'NOT VERIFIED',
    'required_mac_browser': 'NOT VERIFIED',
}
Path('docs/evidence/source-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
