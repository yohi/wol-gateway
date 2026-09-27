import test from 'node:test';
import assert from 'node:assert/strict';
import { listTargets, wakeTarget } from '../dist/api/targets.js';
import { listRelays } from '../dist/api/relays.js';

function fakeRelay({ relayStatus='online', targetStatus='offline', wakeResult={ status:'accepted' } } = {}) {
  return {
    id: 'home-gateway', type: 'gateway',
    statusCalls: 0, targetCalls: 0, wakeCalls: 0,
    async status() { this.statusCalls++; return relayStatus; },
    async getTargetStatus() { this.targetCalls++; return targetStatus; },
    async wake() { this.wakeCalls++; return wakeResult; },
  };
}

test('target online disables wake', async () => {
  const relay = fakeRelay({ targetStatus:'online' });
  const response = await listTargets(relay);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.targets[0].status, 'online');
  assert.equal(body.targets[0].wakeAvailable, false);
});

test('target offline enables wake when relay online', async () => {
  const body = await (await listTargets(fakeRelay())).json();
  assert.equal(body.targets[0].status, 'offline');
  assert.equal(body.targets[0].wakeAvailable, true);
});

test('relay unavailable maps target to unknown without probing target', async () => {
  const relay = fakeRelay({ relayStatus:'unavailable' });
  const body = await (await listTargets(relay)).json();
  assert.equal(body.targets[0].status, 'unknown');
  assert.equal(body.targets[0].wakeAvailable, false);
  assert.equal(relay.targetCalls, 0);
});

test('relay diagnostics expose home-gateway availability', async () => {
  const body = await (await listRelays(fakeRelay())).json();
  assert.deepEqual(body, { relays:[{ id:'home-gateway', type:'gateway', status:'online' }] });
});

test('unknown target returns 404 without touching relay', async () => {
  const relay = fakeRelay();
  const response = await wakeTarget('evil', relay);
  assert.equal(response.status, 404);
  assert.equal(relay.statusCalls, 0);
  assert.equal(relay.wakeCalls, 0);
});

test('wake maps online, unavailable, accepted and rate limited', async () => {
  assert.equal((await wakeTarget('ai-agent', fakeRelay({ targetStatus:'online' }))).status, 409);
  assert.equal((await wakeTarget('ai-agent', fakeRelay({ relayStatus:'unavailable' }))).status, 503);
  assert.equal((await wakeTarget('ai-agent', fakeRelay({ wakeResult:{status:'accepted'} }))).status, 202);
  const limited = await wakeTarget('ai-agent', fakeRelay({ wakeResult:{status:'rate_limited', retryAfter:7} }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '7');
});
