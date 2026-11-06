"""Exercise the real gateway, queue and producer in a disposable Linux fixture."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from uuid import uuid4

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verification_runtime import VerificationRuntime


AGUI = """
import {HttpAgent} from '@ag-ui/client';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const observations = [];
for (let index = 0; index < 2; index++) {
  const agent = new HttpAgent({url: input.url, threadId: input.conversation,
    headers: {Authorization: `Bearer ${input.token}`}});
  const events = [];
  let snapshot;
  agent.subscribe({onEvent: ({event}) => {
    events.push(event.type);
    if (event.type === 'STATE_SNAPSHOT') snapshot = event.snapshot.verification;
  }});
  await agent.runAgent();
  observations.push({events, snapshot});
}
process.stdout.write(JSON.stringify(observations));
"""

PRODUCER = """
import json, sys
from pathlib import Path
from birbverify.target import rpc
command = json.load(sys.stdin)
print(json.dumps(rpc(Path(command['root']), command['method'], **command['data'])))
"""


class HTTPProof:
    def __init__(self, runtime):
        self.runtime = runtime
        self.conversation = str(uuid4())
        self.path = f'/api/conversations/{self.conversation}/verification'
        self.checks = []
        self.observations = []

    def record(self, name, **facts):
        self.checks.append({'check': name, **facts})

    def request(self, method, path=None, body=None, principal='owner', status=200, headers=None):
        auth = {'Authorization': f'Bearer {self.runtime.crew.tokens.get(principal, principal)}'}
        response = httpx.request(method, self.runtime.url + (path or self.path),
                                 headers={**auth, **(headers or {})}, json=body, timeout=25)
        value = response.json()
        self.observations.append({'method': method, 'path': path or self.path,
                                  'status': response.status_code, 'value': value})
        assert response.status_code == status, (method, path, status, response.status_code, response.text)
        return value

    def snapshot(self):
        return self.request('GET')

    def row(self, identity):
        return next((row for row in self.snapshot()['requests'] if row['request_id'] == identity), None)

    def wait(self, predicate, label, timeout=60):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            value = predicate()
            if value:
                return value
            failed = [name for name, process in self.runtime.processes.items() if process.poll() is not None]
            assert not failed, f'Fixture processes exited: {failed}'
            time.sleep(.2)
        raise AssertionError(f'Timed out waiting for {label}')

    def wait_row(self, identity, predicate, label):
        def ready():
            row = self.row(identity)
            return row if row and predicate(row) else None
        return self.wait(ready, label)

    def producer(self, method, **data):
        result = subprocess.run([str(self.runtime.python), '-I', '-c', PRODUCER],
                                input=json.dumps({'root': str(self.runtime.installation),
                                                  'method': method, 'data': data}),
                                capture_output=True, text=True, check=True, timeout=15)
        return json.loads(result.stdout)

    def installation(self):
        return json.loads((self.runtime.installation / 'installation.json').read_text())

    def configure(self, config):
        path = self.runtime.installation / 'installation.json'
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(config))
        temporary.chmod(0o600)
        temporary.replace(path)

    def admission(self):
        config = self.installation()
        return {'request_id': str(uuid4()), 'idempotency_key': str(uuid4()),
                'candidate_commit': config.get('current_candidate', config['passing']),
                'approved_plan_sha256': config['plan_sha256']}

    def observe(self):
        result = subprocess.run([str(self.runtime.repo / '.local/bin/node'), '--input-type=module', '-e', AGUI],
                                cwd=self.runtime.repo, input=json.dumps({
                                    'url': self.runtime.url + self.path + '/events',
                                    'conversation': self.conversation, 'token': self.runtime.crew.tokens['owner']}),
                                capture_output=True, text=True, check=True, timeout=55)
        observations = json.loads(result.stdout)
        self.observations.append({'official_agui': observations})
        for observation in observations:
            assert observation['events'] == ['RUN_STARTED', 'STATE_SNAPSHOT', 'RUN_FINISHED']
            assert observation['snapshot'] is not None
        fields = ('request_id', 'idempotency_key', 'request_sha256', 'attempt_id', 'manifest')
        identities = lambda observation: [{key: row[key] for key in fields} for row in observation['snapshot']['requests']]
        assert identities(observations[0]) == identities(observations[1])
        assert observations[1]['snapshot']['revision'] >= observations[0]['snapshot']['revision']
        assert observations[0]['snapshot']['observation_id'] != observations[1]['snapshot']['observation_id']
        return observations

    def check_access(self):
        self.request('POST', '/api/conversations', {'id': self.conversation})
        empty = self.snapshot()
        assert empty['requests'] == []
        self.observe()
        assert self.snapshot()['requests'] == []
        intent = self.admission()
        self.request('POST', body=intent, principal='invalid', status=401)
        self.request('GET', principal='stranger', status=404)
        self.request('POST', body=intent, principal='stranger', status=404)
        self.request('POST', body={**intent, 'principal': 'owner'}, status=400)
        self.request('POST', body={**intent, 'authority': {'principal': 'fixture-owner'}}, status=400)
        self.request('POST', body={**intent, 'outcome': 'passed'}, status=400)
        self.request('POST', body=intent, headers={'Origin': 'https://untrusted.invalid'}, status=403)
        observer = {'threadId': self.conversation, 'runId': str(uuid4()), 'messages': [],
                    'tools': [], 'context': [], 'state': {'admit': intent}, 'forwardedProps': {}}
        self.request('POST', self.path + '/events', observer, status=400)
        self.request('POST', self.path + '/release', {}, status=404)
        assert self.snapshot()['requests'] == []
        self.record('authenticated_owned_conversation_and_strict_command_boundary')
        self.record('official_agui_reconnect_is_observation_only', observations=2)

    def check_admission_and_restart(self):
        intent = self.admission()
        config = self.installation()
        self.runtime.stop('activity')
        self.configure({**config, 'lose_operation_reply': [intent['request_id']]})
        self.runtime.start_activity()
        encoded = json.dumps(intent).encode()
        with socket.create_connection(('127.0.0.1', self.runtime.port), timeout=10) as transport:
            header = (f'POST {self.path} HTTP/1.1\r\nHost: 127.0.0.1:{self.runtime.port}\r\n'
                      f'Authorization: Bearer {self.runtime.crew.tokens["owner"]}\r\n'
                      f'Content-Type: application/json\r\nContent-Length: {len(encoded)}\r\nConnection: close\r\n\r\n')
            transport.sendall(header.encode() + encoded)
            accepted = self.wait_row(intent['request_id'], lambda row: True, 'admission with unread response')
        replay = self.request('POST', body=intent)
        assert replay['request_id'] == accepted['request_id']
        assert replay['request_sha256'] == accepted['request_sha256']
        self.request('POST', body={**intent, 'candidate_commit': 'f' * 40}, status=409)
        self.request('POST', body={**intent, 'request_id': str(uuid4())}, status=409)
        self.request('POST', body={**intent, 'idempotency_key': str(uuid4())}, status=409)
        row = self.wait_row(intent['request_id'], lambda row: row['phase'] == 'terminal', 'passed producer manifest')
        assert row['outcome'] == 'passed' and row['eligibility'] == {'eligible': True, 'reason': 'eligible'}
        assert row['manifest']['request_id'] == intent['request_id']
        assert row['manifest']['attempt_id'] == row['attempt_id']
        other = str(uuid4())
        self.request('POST', '/api/conversations', {'id': other})
        other_path = f'/api/conversations/{other}/verification'
        assert self.request('GET', other_path)['requests'] == []
        self.request('POST', other_path, intent, status=409)
        self.request('POST', other_path + '/cancel', {
            'request_id': intent['request_id'], 'command_id': str(uuid4()),
            'expected_revision': row['revision']}, status=404)
        self.record('request_projection_and_cancellation_are_bound_to_owned_conversation', request_id=intent['request_id'])
        operations = [op for op in self.producer('inspect')['operations'] if op['request'] == intent['request_id']]
        assert len(operations) == 1
        diagnostics = [json.loads(line) for line in (self.runtime.installation / 'diagnostics.jsonl').read_text().splitlines()]
        assert any(row['request_id'] == intent['request_id'] and row['event'] == 'operation_reconciled' for row in diagnostics)
        self.runtime.stop('gateway')
        self.runtime.start_gateway()
        def gateway_ready():
            try:
                return httpx.get(self.runtime.url, timeout=2).status_code == 200
            except httpx.HTTPError:
                return False
        self.wait(gateway_ready, 'gateway restart')
        restarted = self.request('POST', body=intent)
        assert restarted['request_sha256'] == row['request_sha256']
        assert restarted['attempt_id'] == row['attempt_id']
        assert restarted['manifest'] == row['manifest']
        assert len(self.snapshot()['requests']) == 1
        self.observe()
        assert len([op for op in self.producer('inspect')['operations'] if op['request'] == intent['request_id']]) == 1
        self.record('unread_http_acknowledgement_retry_and_gateway_restart_preserve_one_request_one_effect',
                    request_id=intent['request_id'], attempt_id=row['attempt_id'], effects=1)
        self.record('real_target_lost_operation_reply_is_reconciled', request_id=intent['request_id'])
        self.configure(config)
        return intent, row

    def check_gate(self, intent, passed):
        config = self.installation()
        manifest = passed['manifest']
        cases = [('current_candidate', config['failing'], 'candidate_changed'),
                 ('plan_sha256', 'e' * 64, 'approval_changed'),
                 ('policy_revision', 'd' * 40, 'policy_changed')]
        for field, changed, reason in cases:
            self.configure({**config, field: changed})
            observed = self.row(intent['request_id'])
            assert observed['eligibility'] == {'eligible': False, 'reason': reason}
            assert observed['manifest'] == manifest
            replay = self.request('POST', body=intent)
            assert replay['request_sha256'] == passed['request_sha256']
            assert replay['manifest'] == manifest
            self.configure(config)
        artifact = manifest['checks'][0]['artifacts'][0]
        path = self.runtime.installation / 'artifacts' / artifact['id']
        original = path.read_bytes()
        for mutation in ('missing', 'digest', 'size'):
            if mutation == 'missing':
                path.unlink()
            elif mutation == 'digest':
                path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
            else:
                path.write_bytes(original + b'!')
            observed = self.row(intent['request_id'])
            assert observed['eligibility'] == {'eligible': False, 'reason': 'evidence_unavailable_or_invalid'}
            assert observed['manifest'] == manifest
            path.write_bytes(original)
        restored = self.row(intent['request_id'])
        assert restored['eligibility']['eligible'] is True
        assert restored['manifest'] == manifest
        self.record('current_candidate_approval_policy_and_artifact_freshness_invalidate_gate_without_rewriting_manifest',
                    request_id=intent['request_id'], invalidations=6)

    def check_cancellation(self):
        active = self.admission()
        queued = self.admission()
        config = self.installation()
        self.runtime.stop('activity')
        self.configure({**config, 'pause_after_effect': [active['request_id']]})
        self.runtime.start_activity()
        self.request('POST', body=active)

        def committed():
            row = self.row(active['request_id'])
            if row and row['attempt_id'] and (self.runtime.installation / f'{row["attempt_id"]}.effect-committed').exists():
                return row
            return None
        running = self.wait(committed, 'real target effect before cancellation')
        assert self.producer('inspect')['environment']['state'] == 'active'
        self.request('POST', body=queued)
        pending = self.wait_row(queued['request_id'], lambda row: row['phase'] == 'queued', 'queued follower')
        cancelled = {'request_id': queued['request_id'], 'command_id': str(uuid4()), 'expected_revision': pending['revision']}
        self.request('POST', self.path + '/cancel', cancelled)
        self.request('POST', self.path + '/cancel', cancelled)
        self.request('POST', self.path + '/cancel', {**cancelled, 'expected_revision': pending['revision'] + 1}, status=409)
        stale = {'request_id': active['request_id'], 'command_id': str(uuid4()), 'expected_revision': 0}
        self.request('POST', self.path + '/cancel', stale, status=409)
        running = self.row(active['request_id'])
        commands = [{'request_id': active['request_id'], 'command_id': str(uuid4()), 'expected_revision': running['revision']} for _ in range(2)]

        def race(command):
            return httpx.post(self.runtime.url + self.path + '/cancel', json=command,
                              headers={'Authorization': f'Bearer {self.runtime.crew.tokens["owner"]}'}, timeout=25)
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(race, commands))
        self.observations.append({'cancel_race': [
            {'body': command, 'status': response.status_code, 'value': response.json()}
            for command, response in zip(commands, responses)]})
        assert sorted(response.status_code for response in responses) == [200, 409]
        winning = commands[next(index for index, response in enumerate(responses) if response.status_code == 200)]
        self.request('POST', self.path + '/cancel', winning)
        self.request('POST', self.path + '/cancel', {**winning, 'expected_revision': winning['expected_revision'] + 1}, status=409)
        terminal = self.wait_row(active['request_id'], lambda row: row['phase'] == 'terminal', 'producer cancellation settled')
        assert terminal['cancellation'] == 'acknowledged'
        assert terminal['outcome'] == 'cancelled'
        assert terminal['manifest']['termination'] == 'confirmed'
        assert terminal['manifest']['cleanup'] == 'complete'
        assert terminal['manifest']['environment_release'] == 'released'
        follower = self.wait_row(queued['request_id'], lambda row: row['phase'] == 'cancelled_before_dispatch', 'queued cancellation settled')
        assert follower['attempt_id'] is None and follower['manifest'] is None
        assert follower['cancellation'] == 'acknowledged'
        observed = self.producer('inspect')
        assert observed['environment']['state'] == 'free'
        assert len([op for op in observed['operations'] if op['request'] == active['request_id']]) == 1
        assert [op for op in observed['operations'] if op['request'] == queued['request_id']] == []
        assert self.producer('current_attempt', request_id=queued['request_id']) is None
        self.request('POST', self.path + '/cancel', cancelled)
        self.request('POST', self.path + '/cancel', winning)
        self.record('queued_cancel_never_dispatches_and_running_cancel_waits_for_real_cleanup',
                    request_id=active['request_id'], attempt_id=terminal['attempt_id'],
                    queued_request_id=queued['request_id'], race_statuses=[200, 409])
        self.configure(config)

    def check_failure(self):
        config = self.installation()
        self.configure({**config, 'current_candidate': config['failing']})
        intent = self.admission()
        self.request('POST', body=intent)
        row = self.wait_row(intent['request_id'], lambda row: row['phase'] == 'terminal', 'real failing candidate')
        assert row['outcome'] == 'failed'
        assert row['eligibility'] == {'eligible': False, 'reason': 'not_passed'}
        assert any(check['outcome'] == 'failed' for check in row['manifest']['checks'])
        assert row['manifest']['termination'] == 'confirmed'
        assert row['manifest']['cleanup'] == 'complete'
        assert row['manifest']['environment_release'] == 'released'
        assert self.producer('inspect')['environment']['state'] == 'free'
        self.record('real_synthetic_assertion_failure_preserves_failed_outcome',
                    request_id=intent['request_id'], attempt_id=row['attempt_id'], outcome='failed')
        self.configure(config)

    def run(self):
        self.check_access()
        intent, row = self.check_admission_and_restart()
        self.check_gate(intent, row)
        late = {'request_id': intent['request_id'], 'command_id': str(uuid4()), 'expected_revision': self.row(intent['request_id'])['revision']}
        self.request('POST', self.path + '/cancel', late)
        assert self.row(intent['request_id'])['cancellation'] == 'too_late'
        self.request('POST', self.path + '/cancel', late)
        assert self.row(intent['request_id'])['manifest'] == row['manifest']
        self.record('terminal_cancel_is_too_late_and_preserves_passed_manifest', request_id=intent['request_id'])
        self.check_cancellation()
        self.check_failure()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args()
    os.umask(0o077)
    runtime = VerificationRuntime(args.repo)
    proof = HTTPProof(runtime)
    sources = sorted((runtime.repo / 'verification').glob('*.py')) + [
        runtime.repo / path for path in ('server/gateway.ts', 'server/verification.ts',
                                        'server/verification-contract.ts', 'app/src/verification-contract.ts',
                                        'scripts/verification_runtime.py', 'scripts/verification_http_proof.py')]
    hashes = lambda: {str(path.relative_to(runtime.repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'mode': 'real HTTP deterministic isolated fixture',
              'namespace': runtime.namespace, 'checks': proof.checks, 'observations': proof.observations,
              'source_sha256': hashes(), 'result': 'failed', 'cleanup': False}

    def interrupted(*_):
        raise TimeoutError('Bounded HTTP proof interrupted')
    signal.signal(signal.SIGALRM, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    signal.alarm(args.timeout)
    try:
        assert not (runtime.repo / '.local/verification-session.json').exists(), 'Another verification runtime owns the session'
        runtime.boot()
        report['versions'] = runtime.crew.report['versions']
        proof.run()
        assert hashes() == report['source_sha256'], 'Source changed during proof; rerun the final implementation'
        report['result'] = 'passed'
    except BaseException as error:
        report['failure_type'] = type(error).__name__
        raise
    finally:
        signal.alarm(0)
        processes = list(runtime.processes.values()) + list(runtime.crew.processes.values())
        runtime.close()
        report['cleanup'] = all(process.poll() is not None for process in processes)
        path = runtime.root / 'http-proof.json'
        path.write_text(json.dumps(report, indent=2) + '\n')
        path.chmod(0o600)
        print(json.dumps({'result': report['result'], 'mode': report['mode'], 'cleanup': report['cleanup'],
                          'checks': proof.checks, 'private_report': str(path)}), flush=True)


if __name__ == '__main__':
    main()
