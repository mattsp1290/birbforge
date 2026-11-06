import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

import httpx

from birbcrew.config import settings, write_private
from birbcrew.proof import Proof, free_port, wait_for


class VerificationRuntime:
    def __init__(self, repo: Path):
        self.repo = repo.resolve()
        setup = json.loads(Path((repo / '.local/guest-setup-path').read_text().strip()).read_text())
        self.producer = Path(setup['exports']['birbverify'])
        self.python = self.producer / '.venv/bin/python'
        self.crew = Proof(argparse.Namespace(mode='test', attestation=None))
        self.root = Path(tempfile.mkdtemp(prefix='bfq-'))
        self.installation = self.root / 'target'
        self.processes = {}
        self.generations = {}
        self.port = free_port()
        self.url = f'http://127.0.0.1:{self.port}'
        self.config_path = self.root / 'queue.json'
        self.namespace = f'bfq-{uuid4().hex}'
        self.source_hashes = self.running_source()

    def running_source(self):
        paths = [*self.repo.glob('verification/*.py'), *self.repo.glob('server/**/*.ts'),
                 *self.repo.glob('server/**/*.json'), *self.repo.glob('app/**/*.ts'),
                 *self.repo.glob('app/**/*.tsx'), *self.repo.glob('dist/**/*')]
        paths += [self.repo / name for name in ['package.json', 'package-lock.json', 'scripts/verification_runtime.py', 'scripts/verification-browser.mjs']]
        return {str(path.relative_to(self.repo)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(paths) if path.is_file()}

    def start(self, name, arguments, extra=None):
        generation = self.generations.get(name, 0) + 1
        self.generations[name] = generation
        environment = {
            'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8',
            'DD_INJECTION_ENABLED': 'false', 'DD_TRACE_ENABLED': 'false',
            'DD_INSTRUMENTATION_TELEMETRY_ENABLED': 'false',
            'OTEL_SDK_DISABLED': 'true',
            'PYTHONNOUSERSITE': '1', 'PYTHONUNBUFFERED': '1',
        }
        environment.update(extra or {})
        with (self.root / f'{name}-{generation}.log').open('w') as log:
            process = subprocess.Popen(arguments, cwd=self.repo, env=environment, stdout=log, stderr=log)
        self.processes[name] = process
        return process

    def stop(self, name, kill=False):
        process = self.processes.pop(name, None)
        if process is None:
            return None
        if process.poll() is None:
            process.send_signal(signal.SIGKILL if kill else signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        return process.returncode

    def start_gateway(self):
        return self.start('gateway', [str(self.repo / '.local/bin/node'), '--import', 'tsx', 'server/main.ts'], {
            'BIRBFORGE_CLIENT_CONFIG': str(self.root / 'clients.json'),
            'BIRBFORGE_PORT': str(self.port), 'TSX_TSCONFIG_PATH': str(self.repo / 'tsconfig.node.json'),
        })

    def start_queue(self):
        return self.start('queue', [str(self.python), '-m', 'verification', 'worker', str(self.config_path)])

    def start_activity(self):
        return self.start('activity', [str(self.python), '-m', 'verification', 'activity-worker', str(self.config_path)])

    def boot(self):
        self.crew.boot()
        self.crew.stop('worker')
        self.crew.stop('gateway')
        config_path = self.crew.root / 'config.json'
        config = json.loads(config_path.read_text())
        config['interrupt_after_effect'] = False
        write_private(config_path, config)
        settings.cache_clear()
        self.crew.start_worker()
        self.crew.start_gateway()
        write_private(self.crew.root / 'runtime-versions.json', self.crew.report['versions'])
        subprocess.run([str(self.python), '-m', 'birbverify.fixture', str(self.installation)],
                       stdout=subprocess.DEVNULL, check=True, timeout=30)
        self.start('target', [str(self.python), '-m', 'birbverify.target', str(self.installation)])
        wait_for(lambda: (self.installation / 'target.sock').exists(), 'verification target')
        address = f'127.0.0.1:{self.crew.temporal_port}'
        temporal = self.producer / '.proof/bin/temporal'
        subprocess.run([str(temporal), '--address', address, 'operator', 'namespace', 'create',
                        '--namespace', self.namespace], check=True, capture_output=True, timeout=30)
        write_private(self.config_path, {
            'installation_root': str(self.installation), 'temporal_address': address,
            'namespace': self.namespace, 'workflow_id': 'environment-fixture-local',
            'workflow_task_queue': f'queue-{self.namespace}', 'activity_task_queue': f'activity-{self.namespace}',
            'owner_principal': 'owner', 'max_requests': 128, 'continue_threshold': 100,
        })
        self.start_queue()
        self.start_activity()
        subprocess.run([str(self.python), '-m', 'verification', 'install', str(self.config_path)],
                       cwd=self.repo, check=True, capture_output=True, timeout=30)
        write_private(self.root / 'clients.json', {
            'url': self.crew.url, 'tokens': self.crew.tokens,
            'verification': {'python': str(self.python), 'configuration': str(self.config_path)},
        })
        self.start_gateway()

        def ready():
            if any(process.poll() is not None for process in self.processes.values()):
                raise RuntimeError(f'A fixture process exited; inspect {self.root}')
            return httpx.get(self.url).status_code == 200

        wait_for(ready, 'verification gateway')
        if self.running_source() != self.source_hashes:
            raise RuntimeError('Source or web build changed during fixture startup')
        session = {'fixture_root': str(self.root), 'producer_fixture_root': str(self.crew.root), 'url': self.url, 'tokens': self.crew.tokens,
                   'queue_config': str(self.config_path), 'installation_root': str(self.installation),
                   'producer_python': str(self.python), 'namespace': self.namespace,
                   'running_source_sha256': self.source_hashes}
        write_private(self.repo / '.local/verification-session.json', session)
        return session

    def close(self):
        for name in list(self.processes):
            self.stop(name)
        for context in self.installation.glob('*.context.json'):
            attempt = json.loads(context.read_text())['owner']['attempt_id']
            subprocess.run(['docker', 'rm', '-f', f'birbverify-{attempt}'], capture_output=True)
        for name in list(self.crew.processes):
            self.crew.stop(name)
        subprocess.run(['docker', 'rm', '-f', self.crew.container], capture_output=True)
        session_path = self.repo / '.local/verification-session.json'
        if session_path.exists() and json.loads(session_path.read_text())['fixture_root'] == str(self.root):
            session_path.unlink()


def main():
    os.umask(0o077)
    repo = Path(sys.argv[1]).resolve()
    if sys.argv[2:] == ['--stop']:
        stop_launcher(repo)
        return
    if sys.argv[2:]:
        raise ValueError('Only --stop is supported')
    if (repo / '.local/verification-session.json').exists():
        raise RuntimeError('A verification session exists. Stop its owning launcher first.')
    runtime = VerificationRuntime(repo)

    def stopping(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    try:
        session = runtime.boot()
        session['launcher'] = {
            'pid': os.getpid(),
            'start_ticks': process_start(os.getpid()),
            'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        }
        write_private(repo / '.local/verification-session.json', session)
        print(f'Fresh verification UI at {runtime.url}. Credentials are private in .local/verification-session.json.', flush=True)
        while all(process.poll() is None for process in runtime.processes.values()):
            time.sleep(0.5)
        raise RuntimeError(f'A fixture process exited; inspect {runtime.root}')
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close()


def process_start(pid):
    return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]


def stop_launcher(repo):
    path = repo / '.local/verification-session.json'
    if not path.exists():
        return
    session = json.loads(path.read_text())
    identity = session['launcher']
    pid = int(identity['pid'])
    if (identity['boot_id'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            or identity['start_ticks'] != process_start(pid)):
        raise RuntimeError('Launcher identity no longer matches. Inspect the private session before cleanup.')
    arguments = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    if str(repo / 'scripts/verification_runtime.py').encode() not in arguments or str(repo).encode() not in arguments:
        raise RuntimeError('Launcher command does not match this checkout')
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 45
    while path.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    if path.exists():
        raise RuntimeError('Launcher cleanup did not finish. Inspect its private fixture logs.')
    print('Owned verification runtime stopped and session removed.')


if __name__ == '__main__':
    main()
