import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ConversationClient, ActionError} from '../app/src/controller';
import {Snapshot, dependencyRevision} from '../app/src/contract';

const session = JSON.parse(readFileSync(process.env.BIRBFORGE_SESSION_FILE ?? '.local/session.json', 'utf8'));
async function wait(predicate: () => boolean, label: string) {
  const until = Date.now() + 60_000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('pinned runtime accepts one decision and converges through real official AG-UI clients', async () => {
  const id = randomUUID();
  const a = new ConversationClient(session.url, session.tokens.owner, id);
  const b = new ConversationClient(session.url, session.tokens.owner, id);
  const stranger = new ConversationClient(session.url, session.tokens.stranger, id);
  const events: string[] = [];
  try {
    await a.create();
    const prompt = {request_id: randomUUID(), text: 'Add a regression test for reconnect in the disposable coding fixture.'};
    await a.submit(prompt);
    await wait(() => a.getSnapshot().conversation?.phase === 'waiting', 'human wait');
    const request = a.getSnapshot().conversation!.human!;
    events.push('client A received durable pending input over AG-UI');
    await b.connect();
    await wait(() => b.getSnapshot().conversation?.human?.id === request.id, 'client B same request');
    assert.deepEqual(a.getSnapshot().conversation, b.getSnapshot().conversation);
    events.push('client B attached to the same authoritative conversation');
    await a.submit(prompt);
    await a.refresh();
    assert.equal(a.getSnapshot().conversation?.inputs.length, 1);
    await assert.rejects(stranger.refresh(), error => error instanceof ActionError && error.status === 404);
    stranger.getSnapshot().conversation = a.getSnapshot().conversation;
    await assert.rejects(stranger.resolve({request_id: request.id, version: request.version, choice: 'inspect'}), error => error instanceof ActionError && error.status === 404);
    const invalid = new ConversationClient(session.url, 'invalid', id);
    await assert.rejects(invalid.request(`/${id}/decision`, {request_id: request.id, version: request.version, choice: 'test'}), error => error instanceof ActionError && error.status === 401);
    await assert.rejects(a.request(`/${id}/decision`, {request_id: request.id, version: request.version, choice: 'test', actor: 'owner'}), error => error instanceof ActionError && error.status === 400);
    events.push('stranger reads and decisions rejected; forged actor rejected');
    await assert.rejects(a.resolve({request_id: request.id, version: 0, choice: 'test'}), error => error instanceof ActionError && error.status === 409);
    const results = await Promise.allSettled([
      a.resolve({request_id: request.id, version: request.version, choice: 'inspect'}),
      b.resolve({request_id: request.id, version: request.version, choice: 'test'}),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof ActionError && rejected.reason.status === 409);
    events.push('racing answers produced exactly one acknowledgement and one HTTP 409');
    await wait(() => a.getSnapshot().conversation?.phase === 'idle' && a.getSnapshot().conversation?.decisions.length === 1, 'final decision');
    a.disconnect(); b.disconnect();
    await a.connect(); await b.connect();
    await wait(() => a.getSnapshot().connection === 'connected' && b.getSnapshot().connection === 'connected', 'fresh observations');
    const finalA = Snapshot.parse(await a.request(`/${id}`));
    const finalB = Snapshot.parse(await b.request(`/${id}`));
    assert.deepEqual(finalA, finalB);
    assert.equal(finalA.inputs.length, 1);
    assert.equal(finalA.decisions.length, 1);
    assert.equal(finalA.human, null);
    assert.equal(finalA.context.notes.length, 2);
    assert.ok(finalA.messages.length > 0);
    const winning = finalA.decisions[0];
    await a.resolve({request_id: winning.id, version: winning.version, choice: winning.resolution!});
    events.push('disconnect and reconnect preserved one input, one decision and finalized messages');
    const raw = await a.request(`/${id}`);
    assert.ok(typeof raw === 'object' && raw !== null && !('native_messages' in raw) && !('owner' in raw));
    writeFileSync(`${process.env.BIRBFORGE_EVIDENCE_DIR ?? 'docs/evidence'}/runtime-checks.json`, JSON.stringify({
      dependencyRevision, checkedAt: new Date().toISOString(), nodeVersion: process.version,
      producerVersions: JSON.parse(readFileSync(session.fixture_root + '/runtime-versions.json', 'utf8')),
      mode: 'deterministic fixture', target: 'Linux ARM64 Node official AG-UI clients',
      nativePhone: 'NOT VERIFIED', macBrowser: 'NOT VERIFIED', conversationId: id,
      requestId: request.id, version: request.version, decisions: finalA.decisions.length,
      inputs: finalA.inputs.length, messageIds: finalA.messages.map(message => message.id), transitions: events,
    }, null, 2) + '\n');
  } finally {a.disconnect(); b.disconnect(); stranger.disconnect();}
});

test('lost acknowledgements retain identity and failed refreshes do not undo accepted commands', async () => {
  const id = randomUUID();
  let dropInputAcknowledgement = true;
  let failNextGet = false;
  const client = new ConversationClient(session.url, session.tokens.owner, id, async (url, init) => {
    if (failNextGet && init.method === 'GET' && url.endsWith(`/${id}`)) {
      failNextGet = false;
      return new Response(JSON.stringify({code: 'fixture_refresh_failure'}), {status: 503});
    }
    const response = await fetch(url, init);
    if (dropInputAcknowledgement && url.endsWith('/inputs')) {
      dropInputAcknowledgement = false;
      await response.text();
      throw new TypeError('Fixture lost acknowledgement after server acceptance');
    }
    return response;
  });
  const prompt = {request_id: randomUUID(), text: 'Prove the disposable input acknowledgement is stable.'};
  try {
    await client.create();
    await assert.rejects(client.submit(prompt), error => error instanceof ActionError && error.status === 503);
    assert.deepEqual(client.getSnapshot().pendingPrompt, prompt);
    failNextGet = true;
    await client.submit(prompt);
    assert.equal(client.getSnapshot().pendingPrompt, null);
    assert.match(client.getSnapshot().notice, /Goal accepted/);
    assert.equal(failNextGet, false);
    assert.match(client.getSnapshot().notice, /State refresh unavailable/);
    await wait(() => client.getSnapshot().conversation?.phase === 'waiting', 'retained prompt human wait');
    const request = client.getSnapshot().conversation!.human!;
    failNextGet = true;
    await client.resolve({request_id: request.id, version: request.version, choice: 'test'});
    assert.match(client.getSnapshot().notice, /Decision accepted/);
    assert.equal(failNextGet, false);
    assert.match(client.getSnapshot().notice, /State refresh unavailable/);
    await wait(() => client.getSnapshot().conversation?.phase === 'idle', 'accepted decision after refresh fault');
    await client.refresh();
    assert.equal(client.getSnapshot().conversation?.inputs.length, 1);
    assert.equal(client.getSnapshot().conversation?.decisions.length, 1);
    await client.cancel();
    await wait(() => client.getSnapshot().conversation?.phase === 'cancelled', 'explicit persisted cancellation');
    await assert.rejects(client.submit({request_id: randomUUID(), text:'Rejected closed conversation input'}), error => error instanceof ActionError && error.status === 409);
    assert.equal(client.getSnapshot().pendingPrompt, null);
    assert.match(client.getSnapshot().notice, /Goal rejected/);
    writeFileSync(`${process.env.BIRBFORGE_EVIDENCE_DIR ?? 'docs/evidence'}/command-checks.json`, JSON.stringify({
      checkedAt: new Date().toISOString(), dependencyRevision, nodeVersion: process.version,
      mode: 'deterministic runtime with client transport fault injection',
      conversationId: id, inputs: client.getSnapshot().conversation?.inputs.length,
      decisions: client.getSnapshot().conversation?.decisions.length,
      finalPhase: client.getSnapshot().conversation?.phase,
      checks: ['lost accepted-input acknowledgement retained original request identity',
        'accepted input followed by failed GET remained accepted',
        'accepted decision followed by failed GET remained accepted',
        'explicit cancellation reached persisted cancelled phase',
        'definitively rejected goal released the pending editor'],
    }, null, 2) + '\n');
  } finally {client.disconnect();}
});

test('a stream transport failure and failed reconnect GET recover without resubmitting', async () => {
  let observations = 0;
  let inputs = 0;
  let failedGets = 0;
  let failGet = false;
  let cutStream: (() => void) | undefined;
  const id = randomUUID();
  const client = new ConversationClient(session.url, session.tokens.owner, id, async (url, init) => {
    if (init.method === 'GET' && failGet && url.endsWith(`/${id}`)) {
      failGet = false; failedGets++;
      return new Response(JSON.stringify({code:'fixture_gateway_unavailable'}), {status:503});
    }
    if (url.endsWith('/inputs')) inputs++;
    const response = await fetch(url, init);
    if (!url.endsWith(`/${id}/events`)) return response;
    observations++;
    if (observations !== 1 || !response.body) return response;
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        cutStream = () => {
          failGet = true;
          controller.error(new Error('Fixture connection interrupted'));
          void reader.cancel();
        };
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) return;
            controller.enqueue(chunk.value);
          }
        } catch {return;}
      },
      cancel() {return reader.cancel();},
    });
    return new Response(stream, {status:response.status, headers:response.headers});
  });
  try {
    await client.create();
    await client.submit({request_id:randomUUID(), text:'Check observation recovery for the disposable fixture.'});
    await wait(() => client.getSnapshot().conversation?.phase === 'waiting', 'pre-failure human wait');
    const before = client.getSnapshot().conversation;
    assert.ok(cutStream);
    cutStream();
    await wait(() => observations >= 2 && client.getSnapshot().connection === 'connected', 'automatic stream retry');
    assert.equal(failedGets, 1);
    assert.equal(inputs, 1);
    await client.refresh();
    assert.deepEqual(client.getSnapshot().conversation, before);
    writeFileSync(`${process.env.BIRBFORGE_EVIDENCE_DIR ?? 'docs/evidence'}/transport-checks.json`, JSON.stringify({
      checkedAt:new Date().toISOString(), dependencyRevision, nodeVersion:process.version,
      target:'Linux Node official AG-UI client with injected stream interruption and one failed GET',
      conversationId:id, observationRequests:observations, inputPostRequests:inputs,
      failedReconnectGets:failedGets, nativePhone:'NOT VERIFIED', macBrowser:'NOT VERIFIED',
      result:'same authoritative pending input after automatic retry; no prompt resubmission',
    }, null, 2) + '\n');
  } finally {client.disconnect();}
});
