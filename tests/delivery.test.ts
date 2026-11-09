import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DeliveryCommand, DeliverySnapshot} from '../app/src/delivery-contract';
import {GatewayConfig} from '../server/gateway';
import {DeliveryClient} from '../app/src/delivery';

const conversation = randomUUID();
const snapshot = {revision: 0, offer: {offer_id: 'pilot', title: 'Write docs', goal_text: 'Write docs', repository_id: 'owner/repo',
  base_commit: 'a'.repeat(40), policy_revision: 'b'.repeat(64), allowed_paths: ['docs/operator.md'], acceptance_id: 'docs-check',
  goal_ref: {project: 'forge', record_id: 'one', revision: '1', content_sha256: 'c'.repeat(64)}}, offer_sha256: 'd'.repeat(64),
  conversation_id: null, delivery_id: null, cancellation: 'none', command_ids: [], stage: {kind: 'awaiting_approval'}};

test('delivery parses typed shared snapshots and rejects forged authority', () => {
  assert.equal(DeliverySnapshot.parse(snapshot).stage.kind, 'awaiting_approval');
  assert.throws(() => DeliverySnapshot.parse({...snapshot, stage: {kind: 'draft_ready'}}));
  assert.throws(() => DeliveryCommand.parse({command_id: randomUUID(), expected_revision: 0, offer_sha256: 'd'.repeat(64), action: 'approve', principal: 'owner'}));
  assert.throws(() => GatewayConfig.parse({url: 'http://127.0.0.1:8000', tokens: {}, mode: 'approved-goal'}));
  assert.throws(() => GatewayConfig.parse({url: 'http://127.0.0.1:8000', tokens: {}, mode: 'approved-goal',
    delivery: {python: '/python', configuration: '/config'}, verification: {python: '/python', configuration: '/config'}}));
});

test('AG-UI delivery observation never executes an action and disconnect does not cancel', async () => {
  const paths: string[] = [];
  let ready: () => void = () => {};
  const observed = new Promise<void>(resolve => {ready = resolve;});
  const client = new DeliveryClient({url: 'http://127.0.0.1', token: 'private', conversationId: conversation,
    transport: async (url, init) => {
      paths.push(String(url));
      assert.equal(init?.method, 'POST');
      return new Response([
        {type: 'RUN_STARTED', threadId: conversation, runId: 'test'},
        {type: 'STATE_SNAPSHOT', snapshot: {delivery: snapshot}},
        {type: 'RUN_FINISHED', threadId: conversation, runId: 'test'},
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'Content-Type': 'text/event-stream'}});
    }});
  client.subscribe(() => {if (client.getSnapshot().snapshot) ready();});
  client.connect();
  await observed;
  client.disconnect();
  assert.equal(client.getSnapshot().snapshot?.stage.kind, 'awaiting_approval');
  assert.ok(paths.length > 0 && paths.every(path => path.endsWith('/delivery/events')));
});
