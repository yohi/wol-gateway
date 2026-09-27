import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../dist/index.js';

function envWith(fetchImpl) {
  return {
    HOME_NETWORK: { fetch: fetchImpl },
    WOL_RELAY_SHARED_SECRET: 'relay-secret',
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
  };
}

test('non-api requests delegate to assets', async () => {
  const response = await handleRequest(new Request('https://wol.y-ohi.com/'), envWith(async()=>new Response()));
  assert.equal(await response.text(), 'asset');
});

test('unsupported api method is rejected', async () => {
  const response = await handleRequest(new Request('https://wol.y-ohi.com/api/targets', { method:'POST' }), envWith(async()=>new Response()));
  assert.equal(response.status, 405);
});

test('gateway failure is sanitized', async () => {
  const response = await handleRequest(new Request('https://wol.y-ohi.com/api/targets'), envWith(async()=>{ throw new Error('http://localhost:8088 secret=abc'); }));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!text.includes('127.0.0.1'));
  assert.ok(!text.includes('relay-secret'));
  assert.ok(!text.includes('secret=abc'));
  assert.equal(JSON.parse(text).targets[0].status, 'unknown');
});


test('wake requires custom confirmation header before relay access', async () => {
  let calls = 0;
  const env = envWith(async()=>{ calls++; return new Response(); });
  const response = await handleRequest(new Request('https://wol.y-ohi.com/api/targets/ai-agent/wake', { method:'POST' }), env);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
