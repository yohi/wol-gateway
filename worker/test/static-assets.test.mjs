import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['index.html', 'app.js', 'style.css']) {
  test(`${file} does not leak private relay configuration`, async () => {
    const text = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    for (const forbidden of ['WOL_RELAY_SHARED_SECRET', '127.0.0.1:8088', 'localhost:8088', 'AA:BB:CC:DD:EE:FF', 'CLOUDFLARE_TUNNEL_ID']) {
      assert.ok(!text.includes(forbidden), `${file} leaked ${forbidden}`);
    }
  });
}


test('_headers hardens static UI responses', async () => {
  const text = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  for (const expected of [
    'X-Frame-Options: DENY',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: no-referrer',
    "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  ]) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
});
