import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import httpx

from birbcrew.config import settings, write_private
from birbcrew.proof import Proof, wait_for

repo = Path(sys.argv[1]).resolve()
if (repo / '.local/session.json').exists():
    raise RuntimeError('A session file already exists. Stop the existing launcher before starting another.')
proof = Proof(argparse.Namespace(mode='test', attestation=None))

def stop(*_):
    raise KeyboardInterrupt

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    proof.boot()
    proof.stop('worker')
    proof.stop('gateway')
    config_path = proof.root / 'config.json'
    config = json.loads(config_path.read_text())
    config['interrupt_after_effect'] = False
    write_private(config_path, config)
    settings.cache_clear()
    proof.start_worker()
    proof.start_gateway()
    environment = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'BIRBFORGE_CLIENT_CONFIG': str(proof.root / 'clients.json'), 'TSX_TSCONFIG_PATH': str(repo / 'tsconfig.node.json')}
    environment.update(BIRBFORGE_BEANS_HUB=str(proof.root / 'beans' / 'hub'), BIRBFORGE_CHAT_PYTHON=sys.executable)
    environment.update({'DD_INJECTION_ENABLED': 'false', 'DD_TRACE_ENABLED': 'false', 'DD_INSTRUMENTATION_TELEMETRY_ENABLED': 'false'})
    ready_file = proof.root / 'birbforge-ready.json'
    environment['BIRBFORGE_READY_FILE'] = str(ready_file)
    if os.environ.get('BIRBFORGE_PROXY_CONFIG'):
        environment['BIRBFORGE_PROXY_CONFIG'] = os.environ['BIRBFORGE_PROXY_CONFIG']
    log = (proof.root / 'birbforge.log').open('w')
    gateway = subprocess.Popen([str(repo / '.local/bin/node'), '--import', 'tsx', 'server/main.ts'], cwd=repo, env=environment, stdout=log, stderr=log)
    def gateway_ready():
        if gateway.poll() is not None:
            raise RuntimeError('Birbforge gateway exited during startup')
        return ready_file.exists() and httpx.get('http://127.0.0.1:8787').status_code == 200
    wait_for(gateway_ready, 'Birbforge gateway')
    write_private(proof.root / 'runtime-versions.json', proof.report['versions'])
    write_private(repo / '.local/session.json', {
        'fixture_root': str(proof.root), 'url': 'http://127.0.0.1:8787',
        'tokens': proof.tokens,
        'proxy_origin': json.loads(ready_file.read_text())['proxyOrigin'],
    })
    print('Birbforge loopback UI at http://127.0.0.1:8787. Private credentials are in .local/session.json.', flush=True)
    while gateway.poll() is None:
        if any(process.poll() is not None for process in proof.processes.values()):
            raise RuntimeError('A disposable producer service exited')
        time.sleep(0.5)
    raise RuntimeError('Birbforge gateway exited; inspect private fixture log')
except KeyboardInterrupt:
    pass
finally:
    if 'gateway' in locals():
        gateway.terminate()
        try:
            gateway.wait(timeout=5)
        except subprocess.TimeoutExpired:
            gateway.kill()
            gateway.wait()
    for name in list(proof.processes):
        proof.stop(name)
    subprocess.run(['docker', 'rm', '-f', proof.container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (repo / '.local/session.json').unlink(missing_ok=True)
