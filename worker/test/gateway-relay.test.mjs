import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayRelay } from '../dist/relays/gateway.js';
import { TARGETS } from '../dist/domain/target.js';

function fakeBinding(handler) {
  return { fetch: handler };
}

test('status uses fixed internal status URL and bearer secret', async () => {
  let seen;
  const relay = new GatewayRelay(fakeBinding(async (input, init) => {
    seen = { input: String(input), init };
    return new Response(JSON.stringify({ relay: 'online', targets: { 'ai-agent': { status: 'offline' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }), 's3cr3t');
  assert.equal(await relay.status(), 'online');
  assert.equal(seen.input, 'http://localhost:8088/internal/status');
  assert.equal(new Headers(seen.init.headers).get('authorization'), 'Bearer s3cr3t');
});

test('binding failure becomes unavailable and target unknown', async () => {
  const relay = new GatewayRelay(fakeBinding(async () => { throw new Error('private detail'); }), 's');
  assert.equal(await relay.status(), 'unavailable');
  assert.equal(await relay.getTargetStatus(TARGETS['ai-agent']), 'unknown');
});

test('malformed gateway payload becomes target unknown', async () => {
  const relay = new GatewayRelay(fakeBinding(async () => new Response('{}', { status: 200 })), 's');
  assert.equal(await relay.getTargetStatus(TARGETS['ai-agent']), 'unknown');
});

test('wake uses fixed target path and maps semantic statuses', async () => {
  const calls = [];
  const responses = [202, 409, 429];
  const relay = new GatewayRelay(fakeBinding(async (input, init) => {
    calls.push(String(input));
    const status = responses.shift();
    return new Response('', { status, headers: status === 429 ? { 'retry-after': '12' } : {} });
  }), 's');
  assert.deepEqual(await relay.wake(TARGETS['ai-agent']), { status: 'accepted' });
  assert.deepEqual(await relay.wake(TARGETS['ai-agent']), { status: 'already_online' });
  assert.deepEqual(await relay.wake(TARGETS['ai-agent']), { status: 'rate_limited', retryAfter: 12 });
  assert.ok(calls.every((url) => url === 'http://localhost:8088/internal/targets/ai-agent/wake'));
});
