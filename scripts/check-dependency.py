import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
fixture = json.loads((Path(__file__).resolve().parents[1] / 'tests/fixtures/producer-source.json').read_text())
if (root / '.birbforge-revision').read_text().strip() != fixture['revision']:
    raise SystemExit('Producer revision mismatch')
for name, expected in fixture['source_hashes'].items():
    if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Pinned producer source mismatch: {name}')
print(f"Verified {len(fixture['source_hashes'])} pinned producer source hashes")
